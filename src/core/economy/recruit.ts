import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import type { City } from '../world/city'
import { addReserveTroops, spendGold } from '../world/city'
import { spendStamina } from '../world/officer'
import { isBusy } from '../world/queries'

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
 * 作用城 = 武将所在城（officer.cityId）。武将存在且未占用 → 城金 ≥ 1 → 体力 ≥ recruitStaminaCost → 1 ≤ amount ≤ 可征上限。
 */
export function canRecruit(
  state: GameState,
  officerId: OfficerId,
  amount: number,
  config: GameConfig
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: '武将不存在' }
  if (isBusy(state, officerId)) return { ok: false, reason: '武将本月已被占用' }
  const city = state.cities[officer.cityId]
  if (!city) return { ok: false, reason: '城不存在' }

  if (city.gold < 1) return { ok: false, reason: '城金不足' }
  if (officer.stamina < config.recruitStaminaCost) return { ok: false, reason: '体力不足' }
  if (amount < 1) return { ok: false, reason: '征兵数须为正' }
  if (amount > recruitMaxTroops(city)) return { ok: false, reason: '超过可征上限' }
  return { ok: true }
}

/**
 * 执行征兵：效果在下令当下立即结算（后备兵 += N + 扣金扣体力），不推进 RNG。
 * 占用武将由入队 recruit 命令派生（queries.isBusy），出队即释放；月末分支无效果。
 * 前置条件不满足时为 no-op，原样返回 state。
 */
export function recruit(
  state: GameState,
  officerId: OfficerId,
  amount: number,
  config: GameConfig
): GameState {
  if (!canRecruit(state, officerId, amount, config).ok) return state

  const officer = state.officers[officerId]!
  const city = state.cities[officer.cityId]!

  const nextCity = spendGold(addReserveTroops(city, amount), recruitGoldCost(amount))
  const nextOfficer = spendStamina(officer, config.recruitStaminaCost)

  return {
    ...state,
    cities: { ...state.cities, [officer.cityId]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
    pendingCommands: [...state.pendingCommands, { type: 'recruit', officerId }],
  }
}
