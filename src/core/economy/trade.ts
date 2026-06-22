import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import { commandOk, commandFail, type WithCheck } from '../shared/outcome'
import { addFood, addGold, spendFood, spendGold } from '../world/city'
import { spendStamina } from '../world/officer'
import { isBusy, isCaptive } from '../world/queries'

export type TradeMode = 'buy' | 'sell'

/**
 * 交易单价（规则身份，内联常量，不入 config）：
 * 买入 TRADE_BUY_GOLD_PER_FOOD 金 = 1 粮；卖出 1 粮 = TRADE_SELL_GOLD_PER_FOOD 金（差价即规则）。
 */
const TRADE_BUY_GOLD_PER_FOOD = 5
const TRADE_SELL_GOLD_PER_FOOD = 2

/** 买入粮食的数量上限：floor(城金 / 单价)。 */
export function buyMaxFood(gold: number): number {
  return Math.floor(gold / TRADE_BUY_GOLD_PER_FOOD)
}

/**
 * 校验交易前置（不改状态）。作用城 = 武将所在城。
 * 武将存在、未占用、非俘虏 → 本城存在 → 体力 ≥ tradeStaminaCost → amount 为非负整数且不超对应上限。
 */
export function canTrade(
  state: GameState,
  officerId: OfficerId,
  mode: TradeMode,
  amount: number,
  config: GameConfig
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  if (isCaptive(state, officerId)) return { ok: false, reason: 'is-captive' }
  const city = state.cities[officer.cityId!]
  if (!city) return { ok: false, reason: 'city-not-found' }
  if (officer.stamina < config.tradeStaminaCost)
    return { ok: false, reason: 'stamina-insufficient' }
  if (!Number.isInteger(amount) || amount < 0) return { ok: false, reason: 'invalid-amount' }
  if (mode === 'buy' && amount > buyMaxFood(city.gold))
    return { ok: false, reason: 'gold-insufficient' }
  if (mode === 'sell' && amount > city.food) return { ok: false, reason: 'food-insufficient' }
  return { ok: true }
}

/**
 * 执行交易：即时结算、不耗 RNG。
 * 买入：城粮 += amount、城金 -= amount×5；卖出：城粮 -= amount、城金 += amount×2。
 * 占用武将由入队 trade 命令派生（queries.isBusy），出队即释放；月末分支无效果。前置不满足时为 no-op。
 */
export function trade(
  state: GameState,
  officerId: OfficerId,
  mode: TradeMode,
  amount: number,
  config: GameConfig
): WithCheck<GameState> {
  const check = canTrade(state, officerId, mode, amount, config)
  if (!check.ok) return commandFail(check, state)

  const officer = state.officers[officerId]!
  const city0 = state.cities[officer.cityId!]!
  const nextCity =
    mode === 'buy'
      ? spendGold(addFood(city0, amount), amount * TRADE_BUY_GOLD_PER_FOOD)
      : addGold(spendFood(city0, amount), amount * TRADE_SELL_GOLD_PER_FOOD)
  const nextOfficer = spendStamina(officer, config.tradeStaminaCost)

  return commandOk({
    ...state,
    cities: { ...state.cities, [officer.cityId!]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
    pendingCommands: [...state.pendingCommands, { type: 'trade', officerId }],
  })
}
