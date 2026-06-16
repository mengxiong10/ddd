import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { canAllocate, allocate, allocateMaxTroops } from './allocate'

function withCity(s: GameState, id: string, patch: Partial<GameState['cities'][string]>): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}
function withOfficer(s: GameState, id: string, patch: Partial<GameState['officers'][string]>): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

describe('分配上限', () => {
  it('allocateMaxTroops = min(带兵量上限, 后备兵 + 武将原兵)', () => {
    const s = withCity(createInitialState(1), 'chengdu', { reserveTroops: 200 })
    // 诸葛亮：带兵量 = 1×100 + 50×10 + 100×10 = 1600；后备兵 200 + 兵 100 = 300 → min = 300
    expect(allocateMaxTroops(s.officers.zhugeliang!, s.cities.chengdu!)).toBe(300)
    // 后备兵巨大时，带兵量成为瓶颈
    const s2 = withCity(s, 'chengdu', { reserveTroops: 100000 })
    expect(allocateMaxTroops(s2.officers.zhugeliang!, s2.cities.chengdu!)).toBe(1600)
  })
})

describe('canAllocate 前置校验', () => {
  it('满足条件时通过', () => {
    const s = withCity(createInitialState(1), 'chengdu', { reserveTroops: 200 })
    expect(canAllocate(s, 'zhugeliang', 250).ok).toBe(true)
  })

  it('武将已占用 -> 拒绝', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { busy: true })
    expect(canAllocate(s, 'zhugeliang', 50).ok).toBe(false)
  })

  it('amount < 0 -> 拒绝', () => {
    expect(canAllocate(createInitialState(1), 'zhugeliang', -1).ok).toBe(false)
  })

  it('amount 超过带兵量上限 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 'chengdu', { reserveTroops: 100000 })
    expect(canAllocate(s, 'zhugeliang', 1601).ok).toBe(false)
  })

  it('amount 超过 后备兵+原兵 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 'chengdu', { reserveTroops: 50 })
    // 后备兵 50 + 原兵 100 = 150
    expect(canAllocate(s, 'zhugeliang', 151).ok).toBe(false)
  })
})

describe('allocate 分配（双向）', () => {
  it('N > 原兵：城 → 武将', () => {
    const s = withCity(createInitialState(1), 'chengdu', { reserveTroops: 200 })
    const next = allocate(s, 'zhugeliang', 250)
    // 后备兵 = 200 + (100 − 250) = 50；武将兵 = 250
    expect(next.cities.chengdu!.reserveTroops).toBe(50)
    expect(next.officers.zhugeliang!.troops).toBe(250)
  })

  it('N < 原兵：上交回城', () => {
    const s = withCity(createInitialState(1), 'chengdu', { reserveTroops: 0 })
    const next = allocate(s, 'zhugeliang', 40)
    // 后备兵 = 0 + (100 − 40) = 60；武将兵 = 40
    expect(next.cities.chengdu!.reserveTroops).toBe(60)
    expect(next.officers.zhugeliang!.troops).toBe(40)
  })

  it('N = 0：全部上交', () => {
    const s = withCity(createInitialState(1), 'chengdu', { reserveTroops: 0 })
    const next = allocate(s, 'zhugeliang', 0)
    expect(next.cities.chengdu!.reserveTroops).toBe(100)
    expect(next.officers.zhugeliang!.troops).toBe(0)
  })

  it('不扣体力/金、不占人；RNG 不变', () => {
    const s = createInitialState(1)
    const next = allocate(s, 'zhugeliang', 0)
    expect(next.officers.zhugeliang!.stamina).toBe(s.officers.zhugeliang!.stamina)
    expect(next.cities.chengdu!.gold).toBe(s.cities.chengdu!.gold)
    expect(next.officers.zhugeliang!.busy).toBe(false)
    expect(next.rng.seed).toBe(s.rng.seed)
  })

  it('非法下令 no-op（返回原状态）', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { busy: true })
    expect(allocate(s, 'zhugeliang', 50)).toBe(s)
  })
})
