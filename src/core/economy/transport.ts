import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import {
  withEvents,
  commandOk,
  commandFail,
  type WithEvents,
  type WithCheck,
} from '../shared/outcome'
import { randInt } from '../shared/rng'
import { addFood, addGold, addReserveTroops, spendFood, spendGold } from '../world/city'
import { spendStamina } from '../world/officer'
import { isBusy, isCaptive } from '../world/queries'

/** 送达概率（规则身份，内联常量，不入 config）：月末 randInt(1,100) ≤ 80 即送达，否则永损。 */
const TRANSPORT_SUCCESS_PERCENT = 80

/**
 * 校验输送前置（不改状态）。出发城 = 执行人所在城；「兵」指后备兵。
 * 武将存在、未占用、非俘虏 → 体力 ≥ transportStaminaCost → 目标城存在、非本城、同势力（己方城）
 * → food/gold/troops 均为非负整数且不超出发城对应资源。
 */
export function canTransport(
  state: GameState,
  officerId: OfficerId,
  targetCityId: CityId,
  food: number,
  gold: number,
  troops: number,
  config: GameConfig
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  if (isCaptive(state, officerId)) return { ok: false, reason: 'is-captive' }
  const city = state.cities[officer.cityId!]
  if (!city) return { ok: false, reason: 'city-not-found' }
  if (officer.stamina < config.transportStaminaCost)
    return { ok: false, reason: 'stamina-insufficient' }
  const target = state.cities[targetCityId]
  if (!target) return { ok: false, reason: 'target-city-not-found' }
  if (targetCityId === officer.cityId!) return { ok: false, reason: 'target-is-self-city' }
  if (target.lordId !== officer.lordId) return { ok: false, reason: 'target-not-friendly-city' }
  for (const v of [food, gold, troops]) {
    if (!Number.isInteger(v) || v < 0) return { ok: false, reason: 'invalid-amount' }
  }
  if (food > city.food) return { ok: false, reason: 'food-insufficient' }
  if (gold > city.gold) return { ok: false, reason: 'gold-insufficient' }
  if (troops > city.reserveTroops) return { ok: false, reason: 'reserve-troops-insufficient' }
  return { ok: true }
}

/**
 * 下令输送：扣体力、立即从出发城扣 food/gold/troops（后备兵）、入队（占用由队列派生）。不耗 RNG。
 * 前置不满足时为 no-op。
 */
export function transport(
  state: GameState,
  officerId: OfficerId,
  targetCityId: CityId,
  food: number,
  gold: number,
  troops: number,
  config: GameConfig
): WithCheck<GameState> {
  const check = canTransport(state, officerId, targetCityId, food, gold, troops, config)
  if (!check.ok) return commandFail(check, state)

  const officer = state.officers[officerId]!
  const city0 = state.cities[officer.cityId!]!
  const nextCity = addReserveTroops(spendGold(spendFood(city0, food), gold), -troops)
  const nextOfficer = spendStamina(officer, config.transportStaminaCost)

  return commandOk({
    ...state,
    cities: { ...state.cities, [officer.cityId!]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
    pendingCommands: [
      ...state.pendingCommands,
      { type: 'transport', officerId, targetCityId, food, gold, troops },
    ],
  })
}

/**
 * 月末执行输送（供 turn 分派，非 campaign 趟）：消费 RNG 判 80% 送达。
 * 送达 → 目标城 += food/gold/后备兵；失败 → 资源永损（不退回）。无论成败都推进 RNG。
 * 执行人 cityId 不变；占用随该命令出队即释放（派生 isBusy）。
 */
export function executeTransport(
  state: GameState,
  officerId: OfficerId,
  targetCityId: CityId,
  food: number,
  gold: number,
  troops: number
): WithEvents<GameState> {
  const [roll, nextRng] = randInt(state.rng, 1, 100)
  if (roll > TRANSPORT_SUCCESS_PERCENT)
    return withEvents({ ...state, rng: nextRng }, [
      { kind: 'transport-robbed', officerId, targetCityId },
    ])

  const target = state.cities[targetCityId]!
  const nextTarget = addReserveTroops(addGold(addFood(target, food), gold), troops)
  return withEvents(
    { ...state, rng: nextRng, cities: { ...state.cities, [targetCityId]: nextTarget } },
    [{ kind: 'transport-delivered', officerId, targetCityId, food, gold, troops }]
  )
}
