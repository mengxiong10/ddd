import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import { canDevelop, develop } from './develop'
import { holdByOfficer } from '../world/item'
import { isBusy } from '../world/queries'

const cfg = DEFAULT_CONFIG

/** 占用某武将（占用为派生：入队一条引用该武将的命令）。 */
function occupy(s: GameState, id: number): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, { type: 'develop', officerId: id }] }
}

function withCity(
  s: GameState,
  id: number,
  patch: Partial<GameState['cities'][number]>
): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}
function withOfficer(
  s: GameState,
  id: number,
  patch: Partial<GameState['officers'][number]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

describe('canDevelop 前置校验', () => {
  it('满足条件时通过', () => {
    const s = createInitialState(1)
    expect(canDevelop(s, 2, 'agriculture', cfg).ok).toBe(true)
  })

  it('武将已占用 -> 拒绝', () => {
    const s = occupy(createInitialState(1), 2)
    expect(canDevelop(s, 2, 'agriculture', cfg).ok).toBe(false)
  })

  it('属性达上限 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 1, { agriculture: 1000 })
    expect(canDevelop(s, 2, 'agriculture', cfg).ok).toBe(false)
  })

  it('城金不足 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 1, { gold: 10 })
    expect(canDevelop(s, 2, 'agriculture', cfg).ok).toBe(false)
  })

  it('体力不足 -> 拒绝', () => {
    const s = withOfficer(createInitialState(1), 2, { stamina: 5 })
    expect(canDevelop(s, 2, 'agriculture', cfg).ok).toBe(false)
  })
})

describe('develop 开垦/招商', () => {
  it('开垦增长农业（floor(智力/5)+[0,30]），扣金扣体力，占用武将', () => {
    const s = createInitialState(1)
    const next = develop(s, 2, 'agriculture', cfg).state
    const base = 300 + Math.floor(100 / 5) // 320
    expect(next.cities[1]!.agriculture).toBeGreaterThanOrEqual(base)
    expect(next.cities[1]!.agriculture).toBeLessThanOrEqual(base + 30)
    expect(next.cities[1]!.gold).toBe(450)
    expect(next.officers[2]!.stamina).toBe(92)
    expect(isBusy(next, 2)).toBe(true)
    expect(next.cities[1]!.commerce).toBe(200)
  })

  it('招商增长商业', () => {
    const s = createInitialState(1)
    const next = develop(s, 2, 'commerce', cfg).state
    expect(next.cities[1]!.commerce).toBeGreaterThanOrEqual(200 + 20)
    expect(next.cities[1]!.agriculture).toBe(300)
  })

  it('按城级上限截断', () => {
    const s = withCity(createInitialState(1), 1, { agriculture: 995 })
    const next = develop(s, 2, 'agriculture', cfg).state
    expect(next.cities[1]!.agriculture).toBe(1000)
  })

  it('确定性：相同 seed 相同结果', () => {
    const s = createInitialState(7)
    const a = develop(s, 2, 'agriculture', cfg).state
    const b = develop(s, 2, 'agriculture', cfg).state
    expect(a.cities[1]!.agriculture).toBe(b.cities[1]!.agriculture)
    expect(a.rng.seed).toBe(b.rng.seed)
  })

  it('非法下令 no-op（返回原状态）', () => {
    const s = occupy(createInitialState(1), 2)
    expect(develop(s, 2, 'agriculture', cfg).state).toBe(s)
  })

  it('产出 develop-done 事件（attr/newValue/delta 与城属性一致）', () => {
    const s = createInitialState(1)
    const { state, events } = develop(s, 2, 'agriculture', cfg)
    const newValue = state.cities[1]!.agriculture
    expect(events).toEqual([
      {
        kind: 'develop-done',
        officerId: 2,
        cityId: 1,
        attr: 'agriculture',
        newValue,
        delta: newValue - 300,
      },
    ])
  })

  it('非法下令不产事件', () => {
    const s = occupy(createInitialState(1), 2)
    expect(develop(s, 2, 'agriculture', cfg).events).toEqual([])
  })

  it('开垦增量吃道具加成（有效智力）', () => {
    const s = createInitialState(7)
    // 孟德新书 智力+10 给诸葛亮：floor(110/5) − floor(100/5) = 22 − 20 = 2，RNG 同种子抵消
    const withItem = {
      ...s,
      items: {
        ...s.items,
        2: holdByOfficer(s.items[2]!, 2),
      },
    }
    const a = develop(s, 2, 'agriculture', cfg).state.cities[1]!.agriculture
    const b = develop(withItem, 2, 'agriculture', cfg).state.cities[1]!.agriculture
    expect(b - a).toBe(2)
  })
})
