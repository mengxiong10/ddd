import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { canAllocate, allocate, allocateMaxTroops } from './allocate'
import { holdByOfficer } from '../world/item'
import { isBusy } from '../world/queries'

function giveItem(s: GameState, itemId: number, officerId: number): GameState {
  return { ...s, items: { ...s.items, [itemId]: holdByOfficer(s.items[itemId]!, officerId) } }
}

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

describe('分配上限', () => {
  it('allocateMaxTroops = min(带兵量上限, 后备兵 + 武将原兵)', () => {
    const s = withCity(createInitialState(1), 1, { reserveTroops: 200 })
    // 诸葛亮：带兵量 = 1×100 + 50×10 + 100×10 = 1600；后备兵 200 + 兵 100 = 300 → min = 300
    expect(allocateMaxTroops(s.officers[2]!, s.cities[1]!)).toBe(300)
    // 后备兵巨大时，带兵量成为瓶颈
    const s2 = withCity(s, 1, { reserveTroops: 100000 })
    expect(allocateMaxTroops(s2.officers[2]!, s2.cities[1]!)).toBe(1600)
  })

  it('带兵量上限吃道具加成（有效武力）', () => {
    const s = withCity(createInitialState(1), 1, { reserveTroops: 100000 })
    // 雌雄双股剑 武力+10 给诸葛亮：带兵量 = 100 + 60×10 + 100×10 = 1700
    const s2 = giveItem(s, 1, 2)
    expect(canAllocate(s2, 2, 1700).ok).toBe(true)
    expect(canAllocate(s, 2, 1700).ok).toBe(false) // 无道具时仍以 1600 为限
  })
})

describe('canAllocate 前置校验', () => {
  it('满足条件时通过', () => {
    const s = withCity(createInitialState(1), 1, { reserveTroops: 200 })
    expect(canAllocate(s, 2, 250).ok).toBe(true)
  })

  it('武将已占用 -> 拒绝', () => {
    const s = occupy(createInitialState(1), 2)
    expect(canAllocate(s, 2, 50).ok).toBe(false)
  })

  it('amount < 0 -> 拒绝', () => {
    expect(canAllocate(createInitialState(1), 2, -1).ok).toBe(false)
  })

  it('amount 超过带兵量上限 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 1, { reserveTroops: 100000 })
    expect(canAllocate(s, 2, 1601).ok).toBe(false)
  })

  it('amount 超过 后备兵+原兵 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 1, { reserveTroops: 50 })
    // 后备兵 50 + 原兵 100 = 150
    expect(canAllocate(s, 2, 151).ok).toBe(false)
  })
})

describe('allocate 分配（双向）', () => {
  it('N > 原兵：城 → 武将', () => {
    const s = withCity(createInitialState(1), 1, { reserveTroops: 200 })
    const next = allocate(s, 2, 250).state
    // 后备兵 = 200 + (100 − 250) = 50；武将兵 = 250
    expect(next.cities[1]!.reserveTroops).toBe(50)
    expect(next.officers[2]!.troops).toBe(250)
  })

  it('N < 原兵：上交回城', () => {
    const s = withCity(createInitialState(1), 1, { reserveTroops: 0 })
    const next = allocate(s, 2, 40).state
    // 后备兵 = 0 + (100 − 40) = 60；武将兵 = 40
    expect(next.cities[1]!.reserveTroops).toBe(60)
    expect(next.officers[2]!.troops).toBe(40)
  })

  it('N = 0：全部上交', () => {
    const s = withCity(createInitialState(1), 1, { reserveTroops: 0 })
    const next = allocate(s, 2, 0).state
    expect(next.cities[1]!.reserveTroops).toBe(100)
    expect(next.officers[2]!.troops).toBe(0)
  })

  it('不扣体力/金、不占人；RNG 不变', () => {
    const s = createInitialState(1)
    const next = allocate(s, 2, 0).state
    expect(next.officers[2]!.stamina).toBe(s.officers[2]!.stamina)
    expect(next.cities[1]!.gold).toBe(s.cities[1]!.gold)
    expect(isBusy(next, 2)).toBe(false)
    expect(next.rng.seed).toBe(s.rng.seed)
  })

  it('非法下令 no-op（state 不变、自报告失败 reason）', () => {
    const s = occupy(createInitialState(1), 2)
    const res = allocate(s, 2, 50)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('officer-busy')
    expect(res.events).toEqual([])
  })
})
