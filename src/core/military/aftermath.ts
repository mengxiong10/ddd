import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import { randInt } from '../shared/rng'
import { applyBattleDamage } from '../world/city'
import { discover, holdByCity } from '../world/item'
import { citiesOfLord, effectiveOfficer, itemsOfOfficer } from '../world/queries'
import { successionCandidates, pickSuccessor, promoteLord } from '../world/succession'

/**
 * 完整战后处理（`14-campaign-aftermath`）一次性入参，由 battle.concludeBattle 从 BattleState 组装。
 */
export interface CampaignOutcome {
  readonly attackerWins: boolean
  readonly attackerLord: OfficerId
  readonly defenderLord: OfficerId
  readonly targetCityId: CityId
  /** 攻方参战武将。 */
  readonly attackerIds: readonly OfficerId[]
  /** 守方参战武将（concludeBattle 由 units.side 派生）。 */
  readonly defenderIds: readonly OfficerId[]
  /** 覆盖式粮草合并值 = 双方剩余战场粮草之和。 */
  readonly mergedFood: number
}

/**
 * 完整战后处理（消耗 state.rng）。唯一调用方 battle.concludeBattle。顺序：
 * 1) 胜方存活单位 cityId→目标城；
 * 2) attackerWins → 占城（仅 city.lordId=攻方君主，sourced keep 模型，不动守军）；
 * 3) 败方参战武将逐人命运（processDefeatedArmy，耗 RNG），收集遭劫君主；
 * 4) 对每个遭劫君主 resolveStrickenLord（AI 自动换主 / 玩家挂起 / 灭亡）；
 * 5) 目标城 applyBattleDamage（无条件战损）；
 * 6) 目标城 food=mergedFood（覆盖式粮草合并）。
 * 占城（2）在败军处理（3）之前——故败方「逃跑」只能逃向其势力其余存活城。
 */
export function resolveCampaignOutcome(state: GameState, o: CampaignOutcome): GameState {
  let next = state

  // 1. 胜方回城：胜方全部参战单位 cityId→目标城（含战中 0 兵未战死者）。
  const winnerIds = o.attackerWins ? o.attackerIds : o.defenderIds
  const officers = { ...next.officers }
  for (const id of winnerIds) {
    if (officers[id]) officers[id] = { ...officers[id]!, cityId: o.targetCityId }
  }
  next = { ...next, officers }

  // 2. 占城（攻方胜）：仅翻 city.lordId。
  if (o.attackerWins) {
    next = {
      ...next,
      cities: {
        ...next.cities,
        [o.targetCityId]: { ...next.cities[o.targetCityId]!, lordId: o.attackerLord },
      },
    }
  }

  // 3. 败军逐人命运。
  const loserIds = o.attackerWins ? o.defenderIds : o.attackerIds
  const defeated = processDefeatedArmy(next, loserIds, o.targetCityId)
  next = defeated.state

  // 4. 遭劫君主（按 id 定序）。
  for (const lordId of [...defeated.strickenLords].sort()) {
    next = resolveStrickenLord(next, lordId)
  }

  // 5. 城市战损 + 6. 粮草合并（覆盖）。
  const damaged = applyBattleDamage(next.cities[o.targetCityId]!)
  next = {
    ...next,
    cities: { ...next.cities, [o.targetCityId]: { ...damaged, food: o.mergedFood } },
  }
  return next
}

/**
 * 败军处理（耗 RNG，按 officerId 字典序）：每名 loser 逐一——
 * ① RandInt(0,99) > 有效智力 → 被俘；
 * ② 否则取 citiesOfLord(其 lordId)（占城后、按 id 排序）随机一座 → 逃跑成功（cityId=该城、保留兵）；
 * ③ 无城 → 逃跑失败：RandInt(0,99)===0 → 战死，否则 → 被俘。
 * 被俘：cityId=目标城、troops=0、lordId 不变（派生成俘虏）。
 * 战死：道具 discover(holdByCity(item,目标城))、officer 从 officers 删除。
 * 返回新 state 与遭劫（被俘∪战死）君主 id 集合。
 */
function processDefeatedArmy(
  state: GameState,
  loserIds: readonly OfficerId[],
  targetCityId: CityId
): { state: GameState; strickenLords: ReadonlySet<OfficerId> } {
  let next = state
  const strickenLords = new Set<OfficerId>()

  for (const id of [...loserIds].sort()) {
    const officer = next.officers[id]
    if (!officer) continue
    const isLord = officer.lordId === officer.id

    const [r1, rng1] = randInt(next.rng, 0, 99)
    next = { ...next, rng: rng1 }
    const intel = effectiveOfficer(next, id).intelligence

    let fate: 'capture' | 'escape' | 'death'
    let escapeCityId: CityId | null = null
    if (r1 > intel) {
      fate = 'capture'
    } else {
      const cityIds =
        officer.lordId === null
          ? []
          : citiesOfLord(next, officer.lordId)
              .map((c) => c.id)
              .sort()
      if (cityIds.length > 0) {
        const [idx, rng2] = randInt(next.rng, 0, cityIds.length - 1)
        next = { ...next, rng: rng2 }
        fate = 'escape'
        escapeCityId = cityIds[idx]!
      } else {
        const [r2, rng2] = randInt(next.rng, 0, 99)
        next = { ...next, rng: rng2 }
        fate = r2 === 0 ? 'death' : 'capture'
      }
    }

    if (fate === 'escape') {
      next = {
        ...next,
        officers: { ...next.officers, [id]: { ...officer, cityId: escapeCityId! } },
      }
    } else if (fate === 'capture') {
      next = {
        ...next,
        officers: { ...next.officers, [id]: { ...officer, cityId: targetCityId, troops: 0 } },
      }
      if (isLord) strickenLords.add(id)
    } else {
      // 战死：道具入目标城仓库（已发现）、officer 永久删除。
      const items = { ...next.items }
      for (const item of itemsOfOfficer(next, id)) {
        items[item.id] = discover(holdByCity(item, targetCityId))
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _removed, ...officers } = next.officers
      next = { ...next, items, officers }
      if (isLord) strickenLords.add(id)
    }
  }
  return { state: next, strickenLords }
}

/**
 * 遭劫君主处置（读 playerLordId 的显式游戏规则例外）：
 * 无城 或 无候选 → 灭亡（原样返回）；
 * lordId===playerLordId → 挂起 pendingSuccession（不换主，等玩家手动选）；
 * 否则（AI）→ promoteLord(pickSuccessor)。
 */
function resolveStrickenLord(state: GameState, lordId: OfficerId): GameState {
  if (citiesOfLord(state, lordId).length === 0) return state
  if (successionCandidates(state, lordId).length === 0) return state
  if (lordId === state.playerLordId) {
    return { ...state, pendingSuccession: { lordId } }
  }
  return promoteLord(state, lordId, pickSuccessor(state, lordId)!)
}
