import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import { canSuborn, suborn, executeSuborn } from './suborn'
import { isBusy, isCaptive } from '../world/queries'
import { randInt } from '../shared/rng'

const cfg = DEFAULT_CONFIG

/** 占用某武将（占用为派生：入队一条引用该武将的命令）。 */
function occupy(s: GameState, id: number): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, { type: 'reclaim', officerId: id }] }
}

function withOfficer(
  s: GameState,
  id: number,
  patch: Partial<GameState['officers'][number]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}
function withCity(
  s: GameState,
  id: number,
  patch: Partial<GameState['cities'][number]>
): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}
function setCityLord(s: GameState, cityId: number, lordId: number): GameState {
  return { ...s, cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId } } }
}

/** 许昌被刘备占（曹操/荀彧/郭嘉成俘虏），关羽进许昌当执行人。 */
function setup(seed: number): GameState {
  let s = createInitialState(seed)
  s = setCityLord(s, 3, 1)
  s = withOfficer(s, 4, { cityId: 3 })
  return s
}

describe('canSuborn', () => {
  it('满足条件时通过', () => {
    expect(canSuborn(setup(1), 4, 6, cfg).ok).toBe(true)
  })
  it('目标不是俘虏 -> 拒绝', () => {
    const s = createInitialState(1) // 未占领，曹操非俘虏
    expect(canSuborn(withOfficer(s, 4, { cityId: 3 }), 4, 6, cfg).ok).toBe(false)
  })
  it('执行人已占用 -> 拒绝', () => {
    expect(canSuborn(occupy(setup(1), 4), 4, 6, cfg).ok).toBe(false)
  })
  it('执行人体力不足 -> 拒绝', () => {
    expect(canSuborn(withOfficer(setup(1), 4, { stamina: 10 }), 4, 6, cfg).ok).toBe(false)
  })
  it('城金不足 -> 拒绝', () => {
    expect(canSuborn(withCity(setup(1), 3, { gold: 50 }), 4, 6, cfg).ok).toBe(false)
  })
  it('俘虏不在执行人所在城 -> 拒绝', () => {
    const s = setup(1) // 关羽在许昌，把关羽移回江陵则俘虏不同城
    expect(canSuborn(withOfficer(s, 4, { cityId: 2 }), 4, 6, cfg).ok).toBe(false)
  })
})

describe('suborn 下令', () => {
  it('扣体力15/城金100、占用(入队 suborn)，不动 RNG', () => {
    const s = setup(1)
    const next = suborn(s, 4, 6, cfg).state
    expect(next.officers[4]!.stamina).toBe(s.officers[4]!.stamina - 15)
    expect(isBusy(next, 4)).toBe(true)
    expect(next.cities[3]!.gold).toBe(s.cities[3]!.gold - 100)
    expect(next.pendingCommands).toContainEqual({
      type: 'suborn',
      officerId: 4,
      captiveId: 6,
    })
    expect(next.rng).toEqual(s.rng)
  })
  it('前置不满足 -> no-op（state 不变、自报告失败 reason）', () => {
    const s = withCity(setup(1), 3, { gold: 0 })
    const res = suborn(s, 4, 6, cfg)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('gold-insufficient')
  })
})

describe('executeSuborn 四关', () => {
  it('智力差关失败：忠诚不变、仍俘虏、仅消耗 R1', () => {
    let s = setup(1)
    s = withOfficer(s, 4, { intelligence: 1 })
    s = withOfficer(s, 6, { intelligence: 100, loyalty: 50 })
    const [, rng1] = randInt(s.rng, 0, 99)
    const next = executeSuborn(s, 4, 6).state
    expect(next.officers[6]!.loyalty).toBe(50)
    expect(isCaptive(next, 6)).toBe(true)
    expect(next.rng).toEqual(rng1) // 仅消耗一次
  })

  it('降之前忠诚 > 60 直接失败，但扣减持久化', () => {
    let s = setup(1)
    s = withOfficer(s, 4, { intelligence: 100 }) // 智力关必过
    s = withOfficer(s, 6, { intelligence: 1, loyalty: 80 })
    const next = executeSuborn(s, 4, 6).state
    expect(next.officers[6]!.loyalty).toBe(72) // 80 - floor(80/10)=8
    expect(isCaptive(next, 6)).toBe(true)
    expect(next.officers[6]!.lordId).toBe(6)
  })

  it('忠诚为 0 时终判必成功（失败阈值=0）：归己 + 忠诚 RandInt(40,79)', () => {
    let s = setup(1)
    s = withOfficer(s, 4, { intelligence: 100 })
    s = withOfficer(s, 6, { intelligence: 1, loyalty: 0, personality: 0 })
    const next = executeSuborn(s, 4, 6).state
    expect(next.officers[6]!.lordId).toBe(1) // 归执行人君主
    expect(isCaptive(next, 6)).toBe(false)
    expect(next.officers[6]!.loyalty).toBeGreaterThanOrEqual(40)
    expect(next.officers[6]!.loyalty).toBeLessThanOrEqual(79)
  })

  it('终判与公式 R2 < floor((L0−drop)/S) 一致', () => {
    let s = setup(3)
    s = withOfficer(s, 4, { intelligence: 100 })
    s = withOfficer(s, 6, { intelligence: 1, loyalty: 50, personality: 0 }) // S=1
    const [, rng1] = randInt(s.rng, 0, 99) // 智力关过
    const [r2] = randInt(rng1, 0, 99)
    const lowered = 50 - Math.floor(50 / 10) // 45
    const failThreshold = Math.floor(lowered / 1) // 45
    const next = executeSuborn(s, 4, 6).state
    if (r2 < failThreshold) {
      expect(isCaptive(next, 6)).toBe(true)
      expect(next.officers[6]!.loyalty).toBe(45) // 失败也持久化扣减
    } else {
      expect(isCaptive(next, 6)).toBe(false)
    }
  })

  it('守卫：目标已非俘虏 -> 原样返回、不动 RNG', () => {
    let s = setup(1)
    s = withOfficer(s, 6, { lordId: 1 }) // 已归己，不再是俘虏
    expect(executeSuborn(s, 4, 6).state).toBe(s)
  })

  it('成功/失败产出 suborn-result 事件', () => {
    let win = setup(1)
    win = withOfficer(win, 4, { intelligence: 100 })
    win = withOfficer(win, 6, { intelligence: 1, loyalty: 0, personality: 0 })
    expect(executeSuborn(win, 4, 6).events).toEqual([
      { kind: 'suborn-result', officerId: 4, captiveId: 6, success: true },
    ])

    let lose = setup(1)
    lose = withOfficer(lose, 4, { intelligence: 1 })
    lose = withOfficer(lose, 6, { intelligence: 100, loyalty: 50 })
    expect(executeSuborn(lose, 4, 6).events).toEqual([
      { kind: 'suborn-result', officerId: 4, captiveId: 6, success: false },
    ])
  })
})
