import { describe, it, expect } from 'vitest'
import { createInitialState } from './fixture'
import { randInt } from '../shared/rng'
import type { GameState } from '../game-state'
import type { City } from './city'
import { applyDisasterDamage } from './city'
import { runDisasters } from './disaster'

/** 单城 GameState（runDisasters 只读写 cities/rng，officers/adjacency 无关）。 */
function oneCity(seed: number, patch: Partial<City>): GameState {
  const s = createInitialState(seed)
  const base = s.cities[1]!
  return { ...s, cities: { 1: { ...base, id: 1, ...patch } } }
}

describe('runDisasters · 破坏（异常城）', () => {
  it('旱灾城按破坏表扣减（防灾=0 不恢复，破坏后仍 drought）', () => {
    const s = oneCity(1, {
      status: 'drought',
      disasterPrevention: 0,
      food: 401,
      reserveTroops: 101,
      population: 30001,
      agriculture: 301,
      commerce: 200,
    })
    const expected = applyDisasterDamage(s.cities[1]!, 'drought')
    const c = runDisasters(s).state.cities[1]!
    expect(c.status).toBe('drought')
    expect(c.food).toBe(expected.food)
    expect(c.reserveTroops).toBe(expected.reserveTroops)
    expect(c.population).toBe(expected.population)
    expect(c.agriculture).toBe(expected.agriculture)
    expect(c.commerce).toBe(200) // 旱灾不碰商业
  })

  it('正常城（防灾=100）永不发灾、状态不变', () => {
    const s = oneCity(1, { status: 'normal', disasterPrevention: 100 })
    expect(runDisasters(s).state.cities[1]!.status).toBe('normal')
  })
})

describe('runDisasters · 生成（正常城）', () => {
  it('防灾=100 任何 seed 都不发灾', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = oneCity(seed, { status: 'normal', disasterPrevention: 100 })
      expect(runDisasters(s).state.cities[1]!.status).toBe('normal')
    }
  })

  it('防灾=-1 必进灾种判定，按灾种值映射（0旱/1水/2看民忠暴动/3、4无事）', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = oneCity(seed, { status: 'normal', disasterPrevention: -1, loyalty: 50 })
      const [, rng1] = randInt(s.rng, 0, 99) // R > -1 恒成立
      const [kind, rng2] = randInt(rng1, 0, 4)
      const out = runDisasters(s).state.cities[1]!.status
      if (kind === 0) expect(out).toBe('drought')
      else if (kind === 1) expect(out).toBe('flood')
      else if (kind === 2) {
        const [r2] = randInt(rng2, 0, 99)
        expect(out).toBe(r2 > 50 ? 'riot' : 'normal')
      } else expect(out).toBe('normal')
    }
  })
})

describe('runDisasters · 恢复（异常城）', () => {
  it('饥荒：粮>0 即恢复，不耗 RNG', () => {
    const s = oneCity(1, { status: 'famine', food: 10 })
    const out = runDisasters(s).state
    expect(out.cities[1]!.status).toBe('normal')
    expect(out.rng.seed).toBe(s.rng.seed)
  })

  it('饥荒：粮=0 不恢复，不耗 RNG', () => {
    const s = oneCity(1, { status: 'famine', food: 0 })
    const out = runDisasters(s).state
    expect(out.cities[1]!.status).toBe('famine')
    expect(out.rng.seed).toBe(s.rng.seed)
  })

  it('旱灾：防灾=100 必恢复 / 防灾=0 不恢复', () => {
    expect(
      runDisasters(oneCity(1, { status: 'drought', disasterPrevention: 100 })).state.cities[1]!
        .status
    ).toBe('normal')
    expect(
      runDisasters(oneCity(1, { status: 'drought', disasterPrevention: 0 })).state.cities[1]!.status
    ).toBe('drought')
  })

  it('水灾：防灾=100 必恢复 / 防灾=0 不恢复', () => {
    expect(
      runDisasters(oneCity(1, { status: 'flood', disasterPrevention: 100 })).state.cities[1]!.status
    ).toBe('normal')
    expect(
      runDisasters(oneCity(1, { status: 'flood', disasterPrevention: 0 })).state.cities[1]!.status
    ).toBe('flood')
  })

  it('暴动：randInt < 破坏后民忠 则恢复（边界 <，用破坏后民忠）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = oneCity(seed, { status: 'riot', loyalty: 80, disasterPrevention: 50 })
      const damagedLoyalty = applyDisasterDamage(s.cities[1]!, 'riot').loyalty
      const [r] = randInt(s.rng, 0, 99)
      const out = runDisasters(s).state.cities[1]!.status
      expect(out).toBe(r < damagedLoyalty ? 'normal' : 'riot')
    }
  })
})

describe('runDisasters · 事件', () => {
  it('正常→异常 产 city-disaster 事件（携灾种）', () => {
    const s = oneCity(1, { status: 'normal', disasterPrevention: -1, loyalty: 50 })
    const { state, events } = runDisasters(s)
    const status = state.cities[1]!.status
    if (status !== 'normal') {
      expect(events).toContainEqual({ kind: 'city-disaster', cityId: 1, status })
    } else {
      expect(events.some((e) => e.kind === 'city-disaster')).toBe(false)
    }
  })

  it('异常→正常 产 city-recovered 事件', () => {
    const s = oneCity(1, { status: 'famine', food: 10 })
    const { events } = runDisasters(s)
    expect(events).toContainEqual({ kind: 'city-recovered', cityId: 1 })
  })

  it('维持异常（不恢复）不产事件', () => {
    const s = oneCity(1, { status: 'famine', food: 0 })
    const { events } = runDisasters(s)
    expect(events).toEqual([])
  })
})

describe('runDisasters · 确定性 & 全局', () => {
  it('相同 seed 两次结果一致', () => {
    const s = createInitialState(7)
    expect(runDisasters(s)).toEqual(runDisasters(s))
  })

  it('对所有城（含 AI）生效：全 normal 局面推进 RNG', () => {
    const s = createInitialState(3)
    expect(runDisasters(s).state.rng.seed).not.toBe(s.rng.seed)
  })

  it('空城跳过灾害且不消费 RNG', () => {
    const s = oneCity(3, { lordId: null, status: 'normal', disasterPrevention: -1 })
    const result = runDisasters(s)
    expect(result.state.cities[1]).toEqual(s.cities[1])
    expect(result.state.rng).toEqual(s.rng)
    expect(result.events).toEqual([])
  })
})
