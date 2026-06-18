import type { Rng } from '../shared/rng'
import { randInt } from '../shared/rng'

/**
 * 战斗天气（晴/阴/风/雨/雹）。纯规则叶模块，唯一收敛处。
 * 影响技能可用性与威力（见 battle-skill 的天气倍率列），开战=风、每日开头刷新。
 */
export type Weather = 'clear' | 'overcast' | 'wind' | 'rain' | 'hail'

/** 天气倍率维序：晴/阴/风/雨/雹（对应技能 weatherMul 的第 0..4 维）。 */
export const WEATHER_ORDER: readonly Weather[] = ['clear', 'overcast', 'wind', 'rain', 'hail']

/** 开战初始天气（第 1 天开头会先刷新一次）。 */
export const INITIAL_WEATHER: Weather = 'wind'

/** 刷新天气（消耗 rng）：均匀 randInt(0,4) → WEATHER_ORDER。天变技能复用此机制。 */
export function refreshWeather(rng: Rng): readonly [Weather, Rng] {
  const [i, next] = randInt(rng, 0, WEATHER_ORDER.length - 1)
  return [WEATHER_ORDER[i]!, next]
}
