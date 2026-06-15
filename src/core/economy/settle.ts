import type { GameState } from '../game-state'
import type { GameConfig } from '../shared/config'
import type { CityId } from '../shared/ids'
import { addFood, addGold } from '../world/city'

/** 单座城本次收粮量 = floor(农业 / harvestDivisor)。 */
export function harvestAmount(agriculture: number, config: GameConfig): number {
  return Math.floor(agriculture / config.harvestDivisor)
}

/** 单座城本次收税量 = floor(商业 / taxDivisor)。 */
export function taxAmount(commerce: number, config: GameConfig): number {
  return Math.floor(commerce / config.taxDivisor)
}

/**
 * 月末结算：按当前月份对所有城（含 AI 城）收粮/收税。
 * 非结算月直接原样返回，避免无谓的对象重建。
 */
export function settle(state: GameState, config: GameConfig): GameState {
  const isHarvest = config.harvestMonths.includes(state.month)
  const isTax = config.taxMonths.includes(state.month)
  if (!isHarvest && !isTax) return state

  const cities: Record<CityId, GameState['cities'][CityId]> = { ...state.cities }
  for (const id of Object.keys(cities)) {
    let c = cities[id]!
    if (isHarvest) c = addFood(c, harvestAmount(c.agriculture, config))
    if (isTax) c = addGold(c, taxAmount(c.commerce, config))
    cities[id] = c
  }
  return { ...state, cities }
}
