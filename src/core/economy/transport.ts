import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
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
  if (!officer) return { ok: false, reason: '武将不存在' }
  if (isBusy(state, officerId)) return { ok: false, reason: '武将本月已被占用' }
  if (isCaptive(state, officerId)) return { ok: false, reason: '俘虏不可输送' }
  const city = state.cities[officer.cityId]
  if (!city) return { ok: false, reason: '城不存在' }
  if (officer.stamina < config.transportStaminaCost) return { ok: false, reason: '体力不足' }
  const target = state.cities[targetCityId]
  if (!target) return { ok: false, reason: '目标城不存在' }
  if (targetCityId === officer.cityId) return { ok: false, reason: '目标城不能是本城' }
  if (target.lordId !== officer.lordId) return { ok: false, reason: '只能输送到己方城' }
  for (const v of [food, gold, troops]) {
    if (!Number.isInteger(v) || v < 0) return { ok: false, reason: '输送量非法' }
  }
  if (food > city.food) return { ok: false, reason: '城粮不足' }
  if (gold > city.gold) return { ok: false, reason: '城金不足' }
  if (troops > city.reserveTroops) return { ok: false, reason: '后备兵不足' }
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
): GameState {
  if (!canTransport(state, officerId, targetCityId, food, gold, troops, config).ok) return state

  const officer = state.officers[officerId]!
  const city0 = state.cities[officer.cityId]!
  const nextCity = addReserveTroops(spendGold(spendFood(city0, food), gold), -troops)
  const nextOfficer = spendStamina(officer, config.transportStaminaCost)

  return {
    ...state,
    cities: { ...state.cities, [officer.cityId]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
    pendingCommands: [
      ...state.pendingCommands,
      { type: 'transport', officerId, targetCityId, food, gold, troops },
    ],
  }
}

/**
 * 月末执行输送（供 turn 分派，非 campaign 趟）：消费 RNG 判 80% 送达。
 * 送达 → 目标城 += food/gold/后备兵；失败 → 资源永损（不退回）。无论成败都推进 RNG。
 * 执行人 cityId 不变；占用随该命令出队即释放（派生 isBusy）。
 */
export function executeTransport(
  state: GameState,
  _officerId: OfficerId,
  targetCityId: CityId,
  food: number,
  gold: number,
  troops: number
): GameState {
  const [roll, nextRng] = randInt(state.rng, 1, 100)
  if (roll > TRANSPORT_SUCCESS_PERCENT) return { ...state, rng: nextRng }

  const target = state.cities[targetCityId]!
  const nextTarget = addReserveTroops(addGold(addFood(target, food), gold), troops)
  return { ...state, rng: nextRng, cities: { ...state.cities, [targetCityId]: nextTarget } }
}
