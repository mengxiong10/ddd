import type { GameState, PendingCommand } from '../game-state'
import type { GameConfig } from '../shared/config'
import type { OfficerId } from '../shared/ids'
import type { CommandCheck } from '../shared/command'
import { settle } from '../economy/settle'
import { aiTakeTurn } from '../ai/ai'
import { recoverStamina, setBusy } from '../world/officer'
import { runDebuts } from '../world/debut'
import { runDisasters } from '../world/disaster'
import { runNonCampaignPending } from './pending'
import { initBattle, startDay, concludeBattle } from '../military/battle'
import { quickResolveCampaign } from '../military/quick-battle'
import { promoteLord, canChooseSuccessor } from '../world/succession'
import { defendingOfficers } from '../world/queries'

/** 玩家防守可选守军上限（与战斗单位上限同量纲）。 */
const MAX_DEFENDERS = 10

type CampaignPending = Extract<PendingCommand, { type: 'campaign' }>

/**
 * 推进一个月（可重入）：
 * AI 下令(本切片空步) → 执行非 campaign 待执行指令 → 逐条处理 campaign：
 * 玩家参与者**挂起为交互式战斗**并提前返回（activeBattle 非空），由 resumeMonth 续跑；
 * 非玩家者走速算 fallback；全部 campaign 处理完进入月末尾段。
 * 活动战斗中（activeBattle 非空）调用 endMonth 为 no-op（应改用 resumeMonth）。
 */
export function endMonth(state: GameState, config: GameConfig): GameState {
  if (state.activeBattle || state.pendingSuccession || state.pendingDefense) return state
  const afterAi = aiTakeTurn(state, config)
  const afterPending = runNonCampaignPending(afterAi, config)
  return advanceCampaigns(afterPending, config)
}

/**
 * 战斗分胜负后续跑月末：写回（concludeBattle，含完整战后处理）→ 移除已结算的 campaign →
 * 若战后处理挂起了玩家「待选新君」(pendingSuccession 非空) 则提前返回（等 chooseSuccessor）；
 * 否则继续处理剩余 campaign/尾段。要求 state.activeBattle 已有 outcome；否则 no-op。
 */
export function resumeMonth(state: GameState, config: GameConfig): GameState {
  if (!state.activeBattle || !state.activeBattle.outcome) return state
  const concluded = concludeBattle(state) // 写回 + 完整战后处理 + 清空 activeBattle
  const dropped = dropFirstCampaign(concluded)
  if (dropped.pendingSuccession) return dropped // 玩家君主遭劫，挂起等手动选新君
  return advanceCampaigns(dropped, config)
}

/**
 * 玩家选定新君后兑现并续跑月末：promoteLord（势力城+武将归新君、忠诚 100、playerLordId 迁移）→
 * 清空 pendingSuccession → 继续处理剩余 campaign/尾段。非法（canChooseSuccessor 不过）即 no-op。
 */
export function chooseSuccessor(
  state: GameState,
  officerId: OfficerId,
  config: GameConfig
): GameState {
  if (!state.pendingSuccession) return state
  if (!canChooseSuccessor(state, officerId).ok) return state
  const promoted = promoteLord(state, state.pendingSuccession.lordId, officerId)
  return advanceCampaigns({ ...promoted, pendingSuccession: null }, config)
}

/**
 * 逐条处理队列中首个 campaign（`16-ai-campaign` 三类分流）；无 campaign→尾段。
 * 也是 resumeMonth/chooseSuccessor/chooseDefenders 的续跑入口（导出供测试直接驱动分流）：
 * - 目标城无守军（攻方 AI/玩家皆然）→ quickResolveCampaign 直接占城 → 丢弃该 campaign → 递归；
 * - 玩家进攻有守军敌城 → 挂起交互式战斗（activeBattle）返回；
 * - AI 进攻有守军玩家城 → 挂起 pendingDefense（待玩家选守军）返回；
 * - AI vs AI 有守军 → quickResolveCampaign 速算 → 丢弃 → 递归。
 */
export function advanceCampaigns(state: GameState, config: GameConfig): GameState {
  const idx = state.pendingCommands.findIndex((c) => c.type === 'campaign')
  if (idx < 0) return finishMonthTail(state, config)
  const c = state.pendingCommands[idx] as CampaignPending
  const defenders = defendingOfficers(state, c.targetCityId)
  const attackerLord = state.officers[c.officerIds[0]!]?.lordId
  const defenderLord = state.cities[c.targetCityId]?.lordId

  if (defenders.length === 0) {
    const resolved = quickResolveCampaign(state, c.officerIds, [], c.targetCityId, c.provisions)
    return advanceCampaigns(dropFirstCampaign(resolved), config)
  }
  if (attackerLord === state.playerLordId) {
    // 玩家进攻：装好单位后跑第 1 天开头，挂起战斗。
    return startDay({
      ...state,
      activeBattle: initBattle(state, c.officerIds, c.targetCityId, c.provisions),
    })
  }
  if (defenderLord === state.playerLordId) {
    return { ...state, pendingDefense: { targetCityId: c.targetCityId } }
  }
  // AI vs AI：速算后续跑。
  const resolved = quickResolveCampaign(
    state,
    c.officerIds,
    defenders.map((o) => o.id),
    c.targetCityId,
    c.provisions
  )
  return advanceCampaigns(dropFirstCampaign(resolved), config)
}

/** 校验玩家选守军（供 canApply）：pendingDefense 非空 + 去重 + ≤10 + 全属该城守军。空数组合法（弃守）。 */
export function canChooseDefenders(
  state: GameState,
  officerIds: readonly OfficerId[]
): CommandCheck {
  const pd = state.pendingDefense
  if (!pd) return { ok: false, reason: '当前无待守军选择' }
  if (new Set(officerIds).size !== officerIds.length) return { ok: false, reason: '守军重复' }
  if (officerIds.length > MAX_DEFENDERS)
    return { ok: false, reason: `守军最多 ${MAX_DEFENDERS} 名` }
  const pool = new Set(defendingOfficers(state, pd.targetCityId).map((o) => o.id))
  if (!officerIds.every((id) => pool.has(id))) return { ok: false, reason: '守军须为该城在城武将' }
  return { ok: true }
}

/**
 * 玩家选定守军后兑现并续跑月末（chooseDefenders action 委派）。非法（canChooseDefenders 不过）→ no-op。
 * 清空 pendingDefense 后：选 0 名=弃守 → quickResolveCampaign 直接占城 → 续跑；
 * 否则以显式守军开战（initBattle defend 模式 + startDay 挂起）。
 */
export function chooseDefenders(
  state: GameState,
  officerIds: readonly OfficerId[],
  config: GameConfig
): GameState {
  if (!canChooseDefenders(state, officerIds).ok) return state
  const idx = state.pendingCommands.findIndex((c) => c.type === 'campaign')
  if (idx < 0) return state
  const c = state.pendingCommands[idx] as CampaignPending
  const cleared: GameState = { ...state, pendingDefense: null }
  if (officerIds.length === 0) {
    const resolved = quickResolveCampaign(cleared, c.officerIds, [], c.targetCityId, c.provisions)
    return advanceCampaigns(dropFirstCampaign(resolved), config)
  }
  return startDay({
    ...cleared,
    activeBattle: initBattle(cleared, c.officerIds, c.targetCityId, c.provisions, officerIds),
  })
}

/** 移除队列中第一条 campaign（resumeMonth 结算后用）。 */
function dropFirstCampaign(state: GameState): GameState {
  const idx = state.pendingCommands.findIndex((c) => c.type === 'campaign')
  if (idx < 0) return state
  return { ...state, pendingCommands: state.pendingCommands.filter((_, i) => i !== idx) }
}

/**
 * 月末尾段（所有 campaign 处理完后）：收粮/收税 → 占用武将回城 + 体力恢复 → 月份 +1（跨年）→ 登场 → 灾害。
 * 清空待执行队列（campaign 均已结算/速算）。
 */
function finishMonthTail(state: GameState, config: GameConfig): GameState {
  const settled = settle({ ...state, pendingCommands: [] })
  const officers: Record<OfficerId, GameState['officers'][OfficerId]> = { ...settled.officers }
  for (const id of Object.keys(officers)) {
    officers[id] = setBusy(recoverStamina(officers[id]!, config.staminaRecoveryPerMonth), false)
  }
  const month = settled.month === 12 ? 1 : settled.month + 1
  const year = settled.month === 12 ? settled.year + 1 : settled.year
  const debuted = runDebuts({ ...settled, officers, month, year })
  return runDisasters(debuted)
}
