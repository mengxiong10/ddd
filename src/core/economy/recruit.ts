import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import type { City } from '../world/city'
import { addReserveTroops, spendGold } from '../world/city'
import { setBusy, spendStamina } from '../world/officer'

/**
 * 征兵转化率（规则身份，内联常量，不入 config）：
 * 可征上限 = min(民忠 × TROOPS_PER_LOYALTY, 金 × TROOPS_PER_GOLD)；
 * 扣金 = ceil(N / TROOPS_PER_GOLD)（与金转化率同源）。改它就是改游戏规则。
 */
const TROOPS_PER_LOYALTY = 20
const TROOPS_PER_GOLD = 10

/** 可征上限 = min(民忠 × 20, 金 × 10)。 */
export function recruitMaxTroops(city: City): number {
  return Math.min(city.loyalty * TROOPS_PER_LOYALTY, city.gold * TROOPS_PER_GOLD)
}

/** 征兵扣金 = ceil(N / 10)（不足一档也按 1 起收，杜绝零成本征兵）。 */
export function recruitGoldCost(amount: number): number {
  return Math.ceil(amount / TROOPS_PER_GOLD)
}

/**
 * 校验征兵前置条件（不修改状态），供 UI 置灰/提示与 recruit 内部守卫复用。
 * 城/武将存在 → 武将在该城且未占用 → 城金 ≥ 1 → 体力 ≥ recruitStaminaCost → 1 ≤ amount ≤ 可征上限。
 */
export function canRecruit(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  amount: number,
  config: GameConfig,
): CommandCheck {
  const city = state.cities[cityId]
  if (!city) return { ok: false, reason: '城不存在' }
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: '武将不存在' }
  if (officer.cityId !== cityId) return { ok: false, reason: '武将不在该城' }
  if (officer.busy) return { ok: false, reason: '武将本月已被占用' }

  if (city.gold < 1) return { ok: false, reason: '城金不足' }
  if (officer.stamina < config.recruitStaminaCost) return { ok: false, reason: '体力不足' }
  if (amount < 1) return { ok: false, reason: '征兵数须为正' }
  if (amount > recruitMaxTroops(city)) return { ok: false, reason: '超过可征上限' }
  return { ok: true }
}

/**
 * 执行征兵：效果在下令当下立即结算（后备兵 += N + 扣金扣体力 + 占用武将），不推进 RNG。
 * 占人武将由月末 endMonth 统一回城。前置条件不满足时为 no-op，原样返回 state。
 */
export function recruit(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  amount: number,
  config: GameConfig,
): GameState {
  if (!canRecruit(state, cityId, officerId, amount, config).ok) return state

  const city = state.cities[cityId]!
  const officer = state.officers[officerId]!

  const nextCity = spendGold(addReserveTroops(city, amount), recruitGoldCost(amount))
  const nextOfficer = setBusy(spendStamina(officer, config.recruitStaminaCost), true)

  return {
    ...state,
    cities: { ...state.cities, [cityId]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
  }
}
