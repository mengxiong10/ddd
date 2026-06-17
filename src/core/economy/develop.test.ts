import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import { canDevelop, develop } from './develop'
import { holdByOfficer } from '../world/item'

const cfg = DEFAULT_CONFIG

function withCity(s: GameState, id: string, patch: Partial<GameState['cities'][string]>): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}
function withOfficer(s: GameState, id: string, patch: Partial<GameState['officers'][string]>): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

describe('canDevelop 前置校验', () => {
  it('满足条件时通过', () => {
    const s = createInitialState(1)
    expect(canDevelop(s, 'zhugeliang', 'agriculture', cfg).ok).toBe(true)
  })

  it('武将已占用 -> 拒绝', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { busy: true })
    expect(canDevelop(s, 'zhugeliang', 'agriculture', cfg).ok).toBe(false)
  })

  it('属性达上限 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 'chengdu', { agriculture: 1000 })
    expect(canDevelop(s, 'zhugeliang', 'agriculture', cfg).ok).toBe(false)
  })

  it('城金不足 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 'chengdu', { gold: 10 })
    expect(canDevelop(s, 'zhugeliang', 'agriculture', cfg).ok).toBe(false)
  })

  it('体力不足 -> 拒绝', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { stamina: 5 })
    expect(canDevelop(s, 'zhugeliang', 'agriculture', cfg).ok).toBe(false)
  })
})

describe('develop 开垦/招商', () => {
  it('开垦增长农业（floor(智力/5)+[0,30]），扣金扣体力，占用武将', () => {
    const s = createInitialState(1)
    const next = develop(s, 'zhugeliang', 'agriculture', cfg)
    const base = 300 + Math.floor(100 / 5) // 320
    expect(next.cities.chengdu!.agriculture).toBeGreaterThanOrEqual(base)
    expect(next.cities.chengdu!.agriculture).toBeLessThanOrEqual(base + 30)
    expect(next.cities.chengdu!.gold).toBe(450)
    expect(next.officers.zhugeliang!.stamina).toBe(92)
    expect(next.officers.zhugeliang!.busy).toBe(true)
    expect(next.cities.chengdu!.commerce).toBe(200)
  })

  it('招商增长商业', () => {
    const s = createInitialState(1)
    const next = develop(s, 'zhugeliang', 'commerce', cfg)
    expect(next.cities.chengdu!.commerce).toBeGreaterThanOrEqual(200 + 20)
    expect(next.cities.chengdu!.agriculture).toBe(300)
  })

  it('按城级上限截断', () => {
    const s = withCity(createInitialState(1), 'chengdu', { agriculture: 995 })
    const next = develop(s, 'zhugeliang', 'agriculture', cfg)
    expect(next.cities.chengdu!.agriculture).toBe(1000)
  })

  it('确定性：相同 seed 相同结果', () => {
    const s = createInitialState(7)
    const a = develop(s, 'zhugeliang', 'agriculture', cfg)
    const b = develop(s, 'zhugeliang', 'agriculture', cfg)
    expect(a.cities.chengdu!.agriculture).toBe(b.cities.chengdu!.agriculture)
    expect(a.rng.seed).toBe(b.rng.seed)
  })

  it('非法下令 no-op（返回原状态）', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { busy: true })
    expect(develop(s, 'zhugeliang', 'agriculture', cfg)).toBe(s)
  })

  it('开垦增量吃道具加成（有效智力）', () => {
    const s = createInitialState(7)
    // 孟德新书 智力+10 给诸葛亮：floor(110/5) − floor(100/5) = 22 − 20 = 2，RNG 同种子抵消
    const withItem = { ...s, items: { ...s.items, 'mengde-xinshu': holdByOfficer(s.items['mengde-xinshu']!, 'zhugeliang') } }
    const a = develop(s, 'zhugeliang', 'agriculture', cfg).cities.chengdu!.agriculture
    const b = develop(withItem, 'zhugeliang', 'agriculture', cfg).cities.chengdu!.agriculture
    expect(b - a).toBe(2)
  })
})
