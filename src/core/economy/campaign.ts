import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { CommandCheck } from '../shared/command'
import { commandOk, commandFail, type WithCheck } from '../shared/outcome'
import { spendFood } from '../world/city'
import { areAdjacent } from '../world/adjacency'
import { isBusy, isCaptive } from '../world/queries'

/** 单次出征武将上限（量纲上限，规则身份，内联常量）。 */
const MAX_CAMPAIGN_OFFICERS = 10

/**
 * 校验出征前置（不改状态）。本城 = 选中武将共同所在城。
 * 武将数 1~10 且不重复 → 全部存在、在任(非占用/非俘虏)、共处同一本城
 * → 本城城粮 ≥ 1 → 随军粮草为整数且 ∈ [1, 城粮]
 * → 目标城存在、非本城、非己方（target.lordId ≠ 本城 lordId）、与本城相邻。
 */
export function canCampaign(
  state: GameState,
  officerIds: readonly OfficerId[],
  targetCityId: CityId,
  provisions: number
): CommandCheck {
  if (officerIds.length < 1 || officerIds.length > MAX_CAMPAIGN_OFFICERS) {
    return { ok: false, reason: 'invalid-campaign-size' }
  }
  if (new Set(officerIds).size !== officerIds.length)
    return { ok: false, reason: 'duplicate-officers' }

  const officers = officerIds.map((id) => state.officers[id])
  if (officers.some((o) => !o)) return { ok: false, reason: 'officer-not-found' }
  const sourceCityId = officers[0]!.cityId
  if (sourceCityId === null) return { ok: false, reason: 'officer-not-available' }
  if (officers.some((o) => o!.cityId !== sourceCityId))
    return { ok: false, reason: 'officers-not-same-city' }
  if (officers.some((o) => isBusy(state, o!.id) || isCaptive(state, o!.id)))
    return { ok: false, reason: 'officer-not-available' }

  const source = state.cities[sourceCityId]
  if (!source) return { ok: false, reason: 'city-not-found' }
  if (source.food < 1) return { ok: false, reason: 'food-insufficient' }
  if (!Number.isInteger(provisions) || provisions < 1 || provisions > source.food) {
    return { ok: false, reason: 'invalid-provisions' }
  }

  const target = state.cities[targetCityId]
  if (!target) return { ok: false, reason: 'target-city-not-found' }
  if (targetCityId === sourceCityId) return { ok: false, reason: 'target-is-self-city' }
  if (target.lordId === source.lordId) return { ok: false, reason: 'target-is-friendly-city' }
  if (!areAdjacent(state.adjacency, sourceCityId, targetCityId))
    return { ok: false, reason: 'target-not-adjacent' }
  return { ok: true }
}

/**
 * 下令出征：效果延到月末（玩家进攻→交互式战斗，战后处理见 military/aftermath）。下令当下扣本城城粮（随军粮草）、
 * 入队 campaign（占用由队列派生，见 queries.isBusy）；不动目标城/RNG。前置不满足时为 no-op。
 */
export function campaign(
  state: GameState,
  officerIds: readonly OfficerId[],
  targetCityId: CityId,
  provisions: number
): WithCheck<GameState> {
  const check = canCampaign(state, officerIds, targetCityId, provisions)
  if (!check.ok) return commandFail(check, state)

  const sourceCityId = state.officers[officerIds[0]!]!.cityId!

  return commandOk({
    ...state,
    cities: { ...state.cities, [sourceCityId]: spendFood(state.cities[sourceCityId]!, provisions) },
    pendingCommands: [
      ...state.pendingCommands,
      { type: 'campaign', officerIds, targetCityId, provisions },
    ],
  })
}
