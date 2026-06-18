import type { GameState, PendingCommand } from '../game-state'
import type { GameConfig } from '../shared/config'
import type { OfficerId } from '../shared/ids'
import { settle } from '../economy/settle'
import { aiTakeTurn } from '../ai/ai'
import { recoverStamina, setBusy } from '../world/officer'
import { runDebuts } from '../world/debut'
import { runDisasters } from '../world/disaster'
import { runNonCampaignPending } from './pending'
import { initBattle, startDay, concludeBattle } from '../military/battle'
import { promoteLord, canChooseSuccessor } from '../world/succession'

type CampaignPending = Extract<PendingCommand, { type: 'campaign' }>

/**
 * 推进一个月（可重入）：
 * AI 下令(本切片空步) → 执行非 campaign 待执行指令 → 逐条处理 campaign：
 * 玩家参与者**挂起为交互式战斗**并提前返回（activeBattle 非空），由 resumeMonth 续跑；
 * 非玩家者走速算 fallback；全部 campaign 处理完进入月末尾段。
 * 活动战斗中（activeBattle 非空）调用 endMonth 为 no-op（应改用 resumeMonth）。
 */
export function endMonth(state: GameState, config: GameConfig): GameState {
  if (state.activeBattle || state.pendingSuccession) return state
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

/** 逐条处理队列中的 campaign：玩家进攻必挂起战斗返回（AI 不出征故无非玩家 campaign）；无 campaign→尾段。 */
function advanceCampaigns(state: GameState, config: GameConfig): GameState {
  const idx = state.pendingCommands.findIndex((c) => c.type === 'campaign')
  if (idx < 0) return finishMonthTail(state, config)
  const c = state.pendingCommands[idx] as CampaignPending
  // 装好单位后跑第 1 天开头（刷天气/状态/重置行动），与后续每日 endDay 同构。
  return startDay({
    ...state,
    activeBattle: initBattle(state, c.officerIds, c.targetCityId, c.provisions),
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
