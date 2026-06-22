import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import { canBanquet, banquet } from './banquet'
import { isBusy } from '../world/queries'

const cfg = DEFAULT_CONFIG

/** 占用某武将（占用为派生：入队一条引用该武将的命令）。 */
function occupy(s: GameState, id: number): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, { type: 'develop', officerId: id }] }
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

describe('canBanquet 前置校验', () => {
  it('满足条件时通过', () => {
    expect(canBanquet(createInitialState(1), 2, cfg).ok).toBe(true)
  })
  it('目标已占用（非在任）-> 拒绝', () => {
    expect(canBanquet(occupy(createInitialState(1), 2), 2, cfg).ok).toBe(false)
  })
  it('本城金 < 100 -> 拒绝', () => {
    expect(canBanquet(withCity(createInitialState(1), 1, { gold: 99 }), 2, cfg).ok).toBe(false)
  })
})

describe('banquet 下令（即时·不占人）', () => {
  it('扣城金100、目标体力+50封顶100、非君主忠诚+1、不占用、不入队', () => {
    const s = withOfficer(createInitialState(1), 2, { stamina: 30, loyalty: 50 })
    const next = banquet(s, 2, cfg).state
    expect(next.cities[1]!.gold).toBe(500 - 100)
    expect(next.officers[2]!.stamina).toBe(80)
    expect(next.officers[2]!.loyalty).toBe(51)
    expect(isBusy(next, 2)).toBe(false)
    expect(next.pendingCommands).toEqual([])
    expect(next.rng.seed).toBe(s.rng.seed)
  })

  it('体力接近上限时封顶 100', () => {
    const s = withOfficer(createInitialState(1), 2, { stamina: 80 })
    expect(banquet(s, 2, cfg).state.officers[2]!.stamina).toBe(100)
  })

  it('忠诚接近上限时封顶 100', () => {
    const s = withOfficer(createInitialState(1), 2, { loyalty: 100 })
    expect(banquet(s, 2, cfg).state.officers[2]!.loyalty).toBe(100)
  })

  it('目标为君主：忠诚不写存储（恒派生 100），体力照回', () => {
    const s = withOfficer(createInitialState(1), 1, { stamina: 30, loyalty: 100 })
    const next = banquet(s, 1, cfg).state
    expect(next.officers[1]!.stamina).toBe(80)
    expect(next.officers[1]!.loyalty).toBe(100)
  })

  it('非法下令 no-op（state 不变、自报告失败 reason）', () => {
    const s = withCity(createInitialState(1), 1, { gold: 99 })
    const res = banquet(s, 2, cfg)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('gold-insufficient')
  })
})
