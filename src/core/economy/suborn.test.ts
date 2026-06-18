import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import { canSuborn, suborn, executeSuborn } from './suborn'
import { isCaptive } from '../world/queries'
import { randInt } from '../shared/rng'

const cfg = DEFAULT_CONFIG

function withOfficer(
  s: GameState,
  id: string,
  patch: Partial<GameState['officers'][string]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}
function withCity(
  s: GameState,
  id: string,
  patch: Partial<GameState['cities'][string]>
): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}
function setCityLord(s: GameState, cityId: string, lordId: string): GameState {
  return { ...s, cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId } } }
}

/** 许昌被刘备占（曹操/荀彧/郭嘉成俘虏），关羽进许昌当执行人。 */
function setup(seed: number): GameState {
  let s = createInitialState(seed)
  s = setCityLord(s, 'xuchang', 'liubei')
  s = withOfficer(s, 'guanyu', { cityId: 'xuchang' })
  return s
}

describe('canSuborn', () => {
  it('满足条件时通过', () => {
    expect(canSuborn(setup(1), 'guanyu', 'caocao', cfg).ok).toBe(true)
  })
  it('目标不是俘虏 -> 拒绝', () => {
    const s = createInitialState(1) // 未占领，曹操非俘虏
    expect(
      canSuborn(withOfficer(s, 'guanyu', { cityId: 'xuchang' }), 'guanyu', 'caocao', cfg).ok
    ).toBe(false)
  })
  it('执行人已占用 -> 拒绝', () => {
    expect(
      canSuborn(withOfficer(setup(1), 'guanyu', { busy: true }), 'guanyu', 'caocao', cfg).ok
    ).toBe(false)
  })
  it('执行人体力不足 -> 拒绝', () => {
    expect(
      canSuborn(withOfficer(setup(1), 'guanyu', { stamina: 10 }), 'guanyu', 'caocao', cfg).ok
    ).toBe(false)
  })
  it('城金不足 -> 拒绝', () => {
    expect(canSuborn(withCity(setup(1), 'xuchang', { gold: 50 }), 'guanyu', 'caocao', cfg).ok).toBe(
      false
    )
  })
  it('俘虏不在执行人所在城 -> 拒绝', () => {
    const s = setup(1) // 关羽在许昌，把关羽移回江陵则俘虏不同城
    expect(
      canSuborn(withOfficer(s, 'guanyu', { cityId: 'jiangling' }), 'guanyu', 'caocao', cfg).ok
    ).toBe(false)
  })
})

describe('suborn 下令', () => {
  it('扣体力15/城金100、busy、入队，不动 RNG', () => {
    const s = setup(1)
    const next = suborn(s, 'guanyu', 'caocao', cfg)
    expect(next.officers.guanyu!.stamina).toBe(s.officers.guanyu!.stamina - 15)
    expect(next.officers.guanyu!.busy).toBe(true)
    expect(next.cities.xuchang!.gold).toBe(s.cities.xuchang!.gold - 100)
    expect(next.pendingCommands).toContainEqual({
      type: 'suborn',
      officerId: 'guanyu',
      captiveId: 'caocao',
    })
    expect(next.rng).toEqual(s.rng)
  })
  it('前置不满足 -> no-op', () => {
    const s = withCity(setup(1), 'xuchang', { gold: 0 })
    expect(suborn(s, 'guanyu', 'caocao', cfg)).toBe(s)
  })
})

describe('executeSuborn 四关', () => {
  it('智力差关失败：忠诚不变、仍俘虏、仅消耗 R1', () => {
    let s = setup(1)
    s = withOfficer(s, 'guanyu', { intelligence: 1 })
    s = withOfficer(s, 'caocao', { intelligence: 100, loyalty: 50 })
    const [, rng1] = randInt(s.rng, 0, 99)
    const next = executeSuborn(s, 'guanyu', 'caocao')
    expect(next.officers.caocao!.loyalty).toBe(50)
    expect(isCaptive(next, 'caocao')).toBe(true)
    expect(next.rng).toEqual(rng1) // 仅消耗一次
  })

  it('降之前忠诚 > 60 直接失败，但扣减持久化', () => {
    let s = setup(1)
    s = withOfficer(s, 'guanyu', { intelligence: 100 }) // 智力关必过
    s = withOfficer(s, 'caocao', { intelligence: 1, loyalty: 80 })
    const next = executeSuborn(s, 'guanyu', 'caocao')
    expect(next.officers.caocao!.loyalty).toBe(72) // 80 - floor(80/10)=8
    expect(isCaptive(next, 'caocao')).toBe(true)
    expect(next.officers.caocao!.lordId).toBe('caocao')
  })

  it('忠诚为 0 时终判必成功（失败阈值=0）：归己 + 忠诚 RandInt(40,79)', () => {
    let s = setup(1)
    s = withOfficer(s, 'guanyu', { intelligence: 100 })
    s = withOfficer(s, 'caocao', { intelligence: 1, loyalty: 0, personality: 0 })
    const next = executeSuborn(s, 'guanyu', 'caocao')
    expect(next.officers.caocao!.lordId).toBe('liubei') // 归执行人君主
    expect(isCaptive(next, 'caocao')).toBe(false)
    expect(next.officers.caocao!.loyalty).toBeGreaterThanOrEqual(40)
    expect(next.officers.caocao!.loyalty).toBeLessThanOrEqual(79)
  })

  it('终判与公式 R2 < floor((L0−drop)/S) 一致', () => {
    let s = setup(3)
    s = withOfficer(s, 'guanyu', { intelligence: 100 })
    s = withOfficer(s, 'caocao', { intelligence: 1, loyalty: 50, personality: 0 }) // S=1
    const [, rng1] = randInt(s.rng, 0, 99) // 智力关过
    const [r2] = randInt(rng1, 0, 99)
    const lowered = 50 - Math.floor(50 / 10) // 45
    const failThreshold = Math.floor(lowered / 1) // 45
    const next = executeSuborn(s, 'guanyu', 'caocao')
    if (r2 < failThreshold) {
      expect(isCaptive(next, 'caocao')).toBe(true)
      expect(next.officers.caocao!.loyalty).toBe(45) // 失败也持久化扣减
    } else {
      expect(isCaptive(next, 'caocao')).toBe(false)
    }
  })

  it('守卫：目标已非俘虏 -> 原样返回、不动 RNG', () => {
    let s = setup(1)
    s = withOfficer(s, 'caocao', { lordId: 'liubei' }) // 已归己，不再是俘虏
    expect(executeSuborn(s, 'guanyu', 'caocao')).toBe(s)
  })
})
