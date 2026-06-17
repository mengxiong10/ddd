import type { GameState } from '../game-state'
import type { CityId } from '../shared/ids'
import type { Rng } from '../shared/rng'
import { randInt } from '../shared/rng'

/**
 * 在全部城中等概率随机选一座（可能含来源城），消耗给定 rng。返回选中城与推进后的 rng。
 * debut（登场随机落城）与 banish（流放随机落城）共用此唯一选城处。
 * 确定性依赖 Object.keys(state.cities) 插入序稳定（fixture 按 CITY_SEEDS 序插入）。
 */
export function pickRandomCityWithRng(state: GameState, rng: Rng): readonly [cityId: CityId, next: Rng] {
  const cityIds = Object.keys(state.cities)
  const [idx, next] = randInt(rng, 0, cityIds.length - 1)
  return [cityIds[idx]!, next]
}

/** 便捷重载：消耗 state.rng 选城。返回选中城与推进后的 rng（调用方负责写回 state）。 */
export function pickRandomCity(state: GameState): readonly [cityId: CityId, next: Rng] {
  return pickRandomCityWithRng(state, state.rng)
}
