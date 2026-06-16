import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import { canScout, scout } from './scout'

const cfg = DEFAULT_CONFIG

function withCity(s: GameState, id: string, patch: Partial<GameState['cities'][string]>): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}
function withOfficer(s: GameState, id: string, patch: Partial<GameState['officers'][string]>): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

// 玩家刘备：成都/江陵；AI 曹操：许昌/邺城。从成都(诸葛亮)侦察许昌。
describe('canScout 前置校验', () => {
  it('满足条件时通过', () => {
    expect(canScout(createInitialState(1), 'zhugeliang', 'xuchang', cfg).ok).toBe(true)
  })

  it('武将已占用 -> 拒绝', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { busy: true })
    expect(canScout(s, 'zhugeliang', 'xuchang', cfg).ok).toBe(false)
  })

  it('本城金 < 20 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 'chengdu', { gold: 19 })
    expect(canScout(s, 'zhugeliang', 'xuchang', cfg).ok).toBe(false)
  })

  it('体力 < 10 -> 拒绝', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { stamina: 9 })
    expect(canScout(s, 'zhugeliang', 'xuchang', cfg).ok).toBe(false)
  })

  it('目标城是己方城 -> 拒绝', () => {
    expect(canScout(createInitialState(1), 'zhugeliang', 'jiangling', cfg).ok).toBe(false)
  })

  it('目标城是本城 -> 拒绝', () => {
    expect(canScout(createInitialState(1), 'zhugeliang', 'chengdu', cfg).ok).toBe(false)
  })

  it('目标城不存在 -> 拒绝', () => {
    expect(canScout(createInitialState(1), 'zhugeliang', 'nowhere', cfg).ok).toBe(false)
  })
})

describe('scout 侦察（即时）', () => {
  it('扣体力 10、扣本城金 20、busy=true；不入队、RNG 不变', () => {
    const s = createInitialState(1)
    const next = scout(s, 'zhugeliang', 'xuchang', cfg)
    expect(next.officers.zhugeliang!.stamina).toBe(100 - 10)
    expect(next.officers.zhugeliang!.busy).toBe(true)
    expect(next.cities.chengdu!.gold).toBe(500 - 20)
    expect(next.pendingCommands).toEqual([])
    expect(next.rng.seed).toBe(s.rng.seed)
    // 目标城不被改动
    expect(next.cities.xuchang).toEqual(s.cities.xuchang)
  })

  it('非法下令 no-op（返回原状态）', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { stamina: 9 })
    expect(scout(s, 'zhugeliang', 'xuchang', cfg)).toBe(s)
  })
})
