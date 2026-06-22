import type { GameState } from '../game-state'
import type { CityId } from '../shared/ids'
import type { Rng } from '../shared/rng'
import { randInt } from '../shared/rng'

/**
 * 在全部城中等概率随机选一座（可能含来源城），消耗给定 rng。返回选中城与推进后的 rng。
 * debut（登场随机落城）与 banish（流放随机落城）共用此唯一选城处。
 * 候选按数字 CityId 升序，确保 JSON/fixture 插入顺序不影响 RNG 结果。
 */
export function pickRandomCityWithRng(
  state: GameState,
  rng: Rng
): readonly [cityId: CityId, next: Rng] {
  const cityIds = Object.keys(state.cities)
    .map(Number)
    .sort((a, b) => a - b)
  const [idx, next] = randInt(rng, 0, cityIds.length - 1)
  return [cityIds[idx]!, next]
}

/** 便捷重载：消耗 state.rng 选城。返回选中城与推进后的 rng（调用方负责写回 state）。 */
export function pickRandomCity(state: GameState): readonly [cityId: CityId, next: Rng] {
  return pickRandomCityWithRng(state, state.rng)
}
