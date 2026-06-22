import { describe, it, expect } from 'vitest'
import { createInitialState } from './fixture'
import { pickRandomCity } from './placement'
import { randInt } from '../shared/rng'

describe('pickRandomCity', () => {
  it('在全部城中按 RNG 选一座，并推进 rng（与 randInt 同源、可复现）', () => {
    const s = createInitialState(7)
    const cityIds = Object.keys(s.cities)
      .map(Number)
      .sort((a, b) => a - b)
    const [expectedIdx, expectedRng] = randInt(s.rng, 0, cityIds.length - 1)

    const [cityId, next] = pickRandomCity(s)
    expect(cityId).toBe(cityIds[expectedIdx])
    expect(next).toEqual(expectedRng)
    expect(next).not.toEqual(s.rng)
  })

  it('选中的城恒为某座实际存在的城', () => {
    const s = createInitialState(99)
    const [cityId] = pickRandomCity(s)
    expect(s.cities[cityId]).toBeDefined()
  })
})
