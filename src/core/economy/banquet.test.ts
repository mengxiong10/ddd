import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import { canBanquet, banquet } from './banquet'

const cfg = DEFAULT_CONFIG

function withOfficer(s: GameState, id: string, patch: Partial<GameState['officers'][string]>): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}
function withCity(s: GameState, id: string, patch: Partial<GameState['cities'][string]>): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}

describe('canBanquet 前置校验', () => {
  it('满足条件时通过', () => {
    expect(canBanquet(createInitialState(1), 'zhugeliang', cfg).ok).toBe(true)
  })
  it('目标已占用（非在任）-> 拒绝', () => {
    expect(canBanquet(withOfficer(createInitialState(1), 'zhugeliang', { busy: true }), 'zhugeliang', cfg).ok).toBe(false)
  })
  it('本城金 < 100 -> 拒绝', () => {
    expect(canBanquet(withCity(createInitialState(1), 'chengdu', { gold: 99 }), 'zhugeliang', cfg).ok).toBe(false)
  })
})

describe('banquet 下令（即时·不占人）', () => {
  it('扣城金100、目标体力+50封顶100、非君主忠诚+1、busy不变、不入队', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { stamina: 30, loyalty: 50 })
    const next = banquet(s, 'zhugeliang', cfg)
    expect(next.cities.chengdu!.gold).toBe(500 - 100)
    expect(next.officers.zhugeliang!.stamina).toBe(80)
    expect(next.officers.zhugeliang!.loyalty).toBe(51)
    expect(next.officers.zhugeliang!.busy).toBe(false)
    expect(next.pendingCommands).toEqual([])
    expect(next.rng.seed).toBe(s.rng.seed)
  })

  it('体力接近上限时封顶 100', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { stamina: 80 })
    expect(banquet(s, 'zhugeliang', cfg).officers.zhugeliang!.stamina).toBe(100)
  })

  it('忠诚接近上限时封顶 100', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { loyalty: 100 })
    expect(banquet(s, 'zhugeliang', cfg).officers.zhugeliang!.loyalty).toBe(100)
  })

  it('目标为君主：忠诚不写存储（恒派生 100），体力照回', () => {
    const s = withOfficer(createInitialState(1), 'liubei', { stamina: 30, loyalty: 100 })
    const next = banquet(s, 'liubei', cfg)
    expect(next.officers.liubei!.stamina).toBe(80)
    expect(next.officers.liubei!.loyalty).toBe(100)
  })

  it('非法下令 no-op（返回原状态）', () => {
    const s = withCity(createInitialState(1), 'chengdu', { gold: 99 })
    expect(banquet(s, 'zhugeliang', cfg)).toBe(s)
  })
})
