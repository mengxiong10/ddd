import type { GameState } from '../game-state'
import type { CityId } from '../shared/ids'
import { addFood, addGold } from '../world/city'

/**
 * 收粮/收税规则（规则身份，内联常量，不入 config）：
 * 收粮 = floor(农业 / HARVEST_DIVISOR)，每年 HARVEST_MONTHS 各结算一次；
 * 收税 = floor(商业 / TAX_DIVISOR)，每年 TAX_MONTHS 各结算一次。
 * 平衡通过城属性/上限等其它参数调，而非改公式与日历本身。
 */
const HARVEST_DIVISOR = 4
const TAX_DIVISOR = 2
const HARVEST_MONTHS: readonly number[] = [6, 10]
const TAX_MONTHS: readonly number[] = [3, 6, 9, 12]

/** 单座城本次收粮量 = floor(农业 / HARVEST_DIVISOR)。 */
export function harvestAmount(agriculture: number): number {
  return Math.floor(agriculture / HARVEST_DIVISOR)
}

/** 单座城本次收税量 = floor(商业 / TAX_DIVISOR)。 */
export function taxAmount(commerce: number): number {
  return Math.floor(commerce / TAX_DIVISOR)
}

/**
 * 月末结算：按当前月份对所有城（含 AI 城）收粮/收税。
 * 非结算月直接原样返回，避免无谓的对象重建。
 */
export function settle(state: GameState): GameState {
  const isHarvest = HARVEST_MONTHS.includes(state.month)
  const isTax = TAX_MONTHS.includes(state.month)
  if (!isHarvest && !isTax) return state

  const cities: Record<CityId, GameState['cities'][CityId]> = { ...state.cities }
  for (const id of Object.keys(cities)) {
    let c = cities[id]!
    if (isHarvest) c = addFood(c, harvestAmount(c.agriculture))
    if (isTax) c = addGold(c, taxAmount(c.commerce))
    cities[id] = c
  }
  return { ...state, cities }
}
