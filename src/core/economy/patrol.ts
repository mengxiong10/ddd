import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import { commandOk, commandFail, type WithCheck } from '../shared/outcome'
import { randInt } from '../shared/rng'
import { addPopulation, gainLoyalty, spendGold } from '../world/city'
import { spendStamina } from '../world/officer'
import { isBusy } from '../world/queries'

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
export function canPatrol(
  state: GameState,
  officerId: OfficerId,
  config: GameConfig
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  const city = state.cities[officer.cityId]
  if (!city) return { ok: false, reason: 'city-not-found' }
  if (officer.lordId !== city.lordId) return { ok: false, reason: 'is-captive' }
  if (city.gold < config.patrolGoldCost) return { ok: false, reason: 'gold-insufficient' }
  if (officer.stamina < config.patrolStaminaCost)
    return { ok: false, reason: 'stamina-insufficient' }
  return { ok: true }
}

/**
 * 执行出巡：效果在下令当下立即结算（民忠回升 + 人口增长 + 扣金扣体力 + 推进 RNG）。
 * 占用武将由入队 patrol 命令派生（queries.isBusy），出队即释放；月末分支无效果。
 * 前置条件不满足时为 no-op，原样返回 state。
 */
export function patrol(
  state: GameState,
  officerId: OfficerId,
  config: GameConfig
): WithCheck<GameState> {
  const check = canPatrol(state, officerId, config)
  if (!check.ok) return commandFail(check, state)

  const officer = state.officers[officerId]!
  const city = state.cities[officer.cityId]!
  const [loyaltyGain, nextRng] = randInt(
    state.rng,
    PATROL_LOYALTY_RAND_MIN,
    PATROL_LOYALTY_RAND_MAX
  )

  const nextCity = spendGold(
    addPopulation(gainLoyalty(city, loyaltyGain), PATROL_POPULATION_GAIN),
    config.patrolGoldCost
  )
  const nextOfficer = spendStamina(officer, config.patrolStaminaCost)

  const next: GameState = {
    ...state,
    rng: nextRng,
    cities: { ...state.cities, [officer.cityId]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
    pendingCommands: [...state.pendingCommands, { type: 'patrol', officerId }],
  }
  return commandOk(next, [
    {
      kind: 'patrol-done',
      officerId,
      cityId: officer.cityId,
      newLoyalty: nextCity.loyalty,
      loyaltyDelta: nextCity.loyalty - city.loyalty,
    },
  ])
}
