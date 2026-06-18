import { describe, it, expect } from 'vitest'
import { createRng } from '../shared/rng'
import { WEATHER_ORDER, INITIAL_WEATHER, refreshWeather } from './battle-weather'

describe('battle-weather', () => {
  it('初始天气=风、维序为晴阴风雨雹', () => {
    expect(INITIAL_WEATHER).toBe('wind')
    expect(WEATHER_ORDER).toEqual(['clear', 'overcast', 'wind', 'rain', 'hail'])
  })

  it('refreshWeather 落在 5 种天气、推进 rng', () => {
    let rng = createRng(7)
    for (let i = 0; i < 200; i++) {
      const [w, next] = refreshWeather(rng)
      expect(WEATHER_ORDER).toContain(w)
      expect(next.seed).not.toBe(rng.seed)
      rng = next
    }
  })

  it('确定性：同 seed 同结果', () => {
    expect(refreshWeather(createRng(42))[0]).toBe(refreshWeather(createRng(42))[0])
  })
})
