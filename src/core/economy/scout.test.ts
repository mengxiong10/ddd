import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import { canScout, scout } from './scout'
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

// 玩家刘备：成都/江陵；AI 曹操：许昌/邺城。从成都(诸葛亮)侦察许昌。
describe('canScout 前置校验', () => {
  it('满足条件时通过', () => {
    expect(canScout(createInitialState(1), 2, 3, cfg).ok).toBe(true)
  })

  it('武将已占用 -> 拒绝', () => {
    const s = occupy(createInitialState(1), 2)
    expect(canScout(s, 2, 3, cfg).ok).toBe(false)
  })

  it('本城金 < 20 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 1, { gold: 19 })
    expect(canScout(s, 2, 3, cfg).ok).toBe(false)
  })

  it('体力 < 10 -> 拒绝', () => {
    const s = withOfficer(createInitialState(1), 2, { stamina: 9 })
    expect(canScout(s, 2, 3, cfg).ok).toBe(false)
  })

  it('目标城是己方城 -> 拒绝', () => {
    expect(canScout(createInitialState(1), 2, 2, cfg).ok).toBe(false)
  })

  it('目标城是本城 -> 拒绝', () => {
    expect(canScout(createInitialState(1), 2, 1, cfg).ok).toBe(false)
  })

  it('目标城不存在 -> 拒绝', () => {
    expect(canScout(createInitialState(1), 2, 999, cfg).ok).toBe(false)
  })
})

describe('scout 侦察（即时）', () => {
  it('扣体力 10、扣本城金 20、占用(入队 scout)；RNG 不变', () => {
    const s = createInitialState(1)
    const next = scout(s, 2, 3, cfg).state
    expect(next.officers[2]!.stamina).toBe(100 - 10)
    expect(isBusy(next, 2)).toBe(true)
    expect(next.cities[1]!.gold).toBe(500 - 20)
    expect(next.pendingCommands).toEqual([{ type: 'scout', officerId: 2 }])
    expect(next.rng.seed).toBe(s.rng.seed)
    // 目标城不被改动
    expect(next.cities[3]).toEqual(s.cities[3])
  })

  it('非法下令 no-op（state 不变、自报告失败 reason）', () => {
    const s = withOfficer(createInitialState(1), 2, { stamina: 9 })
    const res = scout(s, 2, 3, cfg)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('stamina-insufficient')
  })
})
