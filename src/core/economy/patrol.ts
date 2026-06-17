import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import { randInt } from '../shared/rng'
import { addPopulation, gainLoyalty, spendGold } from '../world/city'
import { setBusy, spendStamina } from '../world/officer'

/**
 * 出巡效果（规则身份，内联常量，不入 config）：
 * 民忠 += RandInt(PATROL_LOYALTY_RAND_MIN, PATROL_LOYALTY_RAND_MAX)（封顶 100）；人口 += PATROL_POPULATION_GAIN。
 */
const PATROL_LOYALTY_RAND_MIN = 1
const PATROL_LOYALTY_RAND_MAX = 4
const PATROL_POPULATION_GAIN = 100

/**
 * 校验出巡前置条件（不修改状态）。作用城 = 武将所在城（officer.cityId）。
 * 武将存在、未占用、非俘虏 → 本城金 ≥ patrolGoldCost → 体力 ≥ patrolStaminaCost。
 */
export function canPatrol(state: GameState, officerId: OfficerId, config: GameConfig): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: '武将不存在' }
  if (officer.busy) return { ok: false, reason: '武将本月已被占用' }
  const city = state.cities[officer.cityId]
  if (!city) return { ok: false, reason: '城不存在' }
  if (officer.lordId !== city.lordId) return { ok: false, reason: '俘虏不可出巡' }
  if (city.gold < config.patrolGoldCost) return { ok: false, reason: '城金不足' }
  if (officer.stamina < config.patrolStaminaCost) return { ok: false, reason: '体力不足' }
  return { ok: true }
}

/**
 * 执行出巡：效果在下令当下立即结算（民忠回升 + 人口增长 + 扣金扣体力 + 占用武将 + 推进 RNG）。
 * 不入 pendingCommands；前置条件不满足时为 no-op，原样返回 state。
 */
export function patrol(state: GameState, officerId: OfficerId, config: GameConfig): GameState {
  if (!canPatrol(state, officerId, config).ok) return state

  const officer = state.officers[officerId]!
  const city = state.cities[officer.cityId]!
  const [loyaltyGain, nextRng] = randInt(state.rng, PATROL_LOYALTY_RAND_MIN, PATROL_LOYALTY_RAND_MAX)

  const nextCity = spendGold(addPopulation(gainLoyalty(city, loyaltyGain), PATROL_POPULATION_GAIN), config.patrolGoldCost)
  const nextOfficer = setBusy(spendStamina(officer, config.patrolStaminaCost), true)

  return {
    ...state,
    rng: nextRng,
    cities: { ...state.cities, [officer.cityId]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
  }
}
