import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import { canRecruit, recruit, recruitMaxTroops, recruitGoldCost } from './recruit'
import { isBusy } from '../world/queries'

const cfg = DEFAULT_CONFIG

/** 占用某武将（占用为派生：入队一条引用该武将的命令）。 */
function occupy(s: GameState, id: number): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, { type: 'reclaim', officerId: id }] }
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

describe('征兵公式', () => {
  it('recruitMaxTroops = min(民忠×20, 金×10)', () => {
    // fixture：成都 民忠 50 → 1000；金 500 → 5000；取 min = 1000
    expect(recruitMaxTroops(createInitialState(1).cities[1]!)).toBe(1000)
    // 金成为瓶颈：金 30 → 300 < 民忠 50 → 1000
    expect(recruitMaxTroops({ ...createInitialState(1).cities[1]!, gold: 30 })).toBe(300)
  })

  it('recruitGoldCost = ceil(N/10)，N<10 时为 1', () => {
    expect(recruitGoldCost(5)).toBe(1)
    expect(recruitGoldCost(10)).toBe(1)
    expect(recruitGoldCost(11)).toBe(2)
    expect(recruitGoldCost(100)).toBe(10)
  })
})

describe('canRecruit 前置校验', () => {
  it('满足条件时通过', () => {
    expect(canRecruit(createInitialState(1), 2, 100, cfg).ok).toBe(true)
  })

  it('武将已占用 -> 拒绝', () => {
    const s = occupy(createInitialState(1), 2)
    expect(canRecruit(s, 2, 100, cfg).ok).toBe(false)
  })

  it('城金 < 1 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 1, { gold: 0 })
    expect(canRecruit(s, 2, 1, cfg).ok).toBe(false)
  })

  it('体力 < 12 -> 拒绝', () => {
    const s = withOfficer(createInitialState(1), 2, { stamina: 11 })
    expect(canRecruit(s, 2, 100, cfg).ok).toBe(false)
  })

  it('amount < 1 -> 拒绝', () => {
    expect(canRecruit(createInitialState(1), 2, 0, cfg).ok).toBe(false)
  })

  it('amount 超过可征上限 -> 拒绝', () => {
    expect(canRecruit(createInitialState(1), 2, 1001, cfg).ok).toBe(false)
  })
})

describe('recruit 征兵', () => {
  it('后备兵 += N、城金 -= ceil(N/10)、体力 -= 12、占用(入队 recruit)；RNG 不变', () => {
    const s = createInitialState(1)
    const next = recruit(s, 2, 100, cfg).state
    expect(next.cities[1]!.reserveTroops).toBe(100)
    expect(next.cities[1]!.gold).toBe(500 - 10)
    expect(next.officers[2]!.stamina).toBe(100 - 12)
    expect(isBusy(next, 2)).toBe(true)
    expect(next.pendingCommands).toEqual([{ type: 'recruit', officerId: 2 }])
    expect(next.rng.seed).toBe(s.rng.seed)
  })

  it('N < 10 仍至少扣 1 金', () => {
    const next = recruit(createInitialState(1), 2, 5, cfg).state
    expect(next.cities[1]!.gold).toBe(500 - 1)
    expect(next.cities[1]!.reserveTroops).toBe(5)
  })

  it('配置注入：改 recruitStaminaCost 改变体力消耗', () => {
    const next = recruit(createInitialState(1), 2, 100, {
      ...cfg,
      recruitStaminaCost: 20,
    }).state
    expect(next.officers[2]!.stamina).toBe(100 - 20)
  })

  it('非法下令 no-op（state 不变、自报告失败 reason）', () => {
    const s = occupy(createInitialState(1), 2)
    const res = recruit(s, 2, 100, cfg)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('officer-busy')
  })
})
