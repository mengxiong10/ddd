import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import { canRecruit, recruit, recruitMaxTroops, recruitGoldCost } from './recruit'

const cfg = DEFAULT_CONFIG

function withCity(s: GameState, id: string, patch: Partial<GameState['cities'][string]>): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}
function withOfficer(s: GameState, id: string, patch: Partial<GameState['officers'][string]>): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

describe('征兵公式', () => {
  it('recruitMaxTroops = min(民忠×20, 金×10)', () => {
    // fixture：成都 民忠 50 → 1000；金 500 → 5000；取 min = 1000
    expect(recruitMaxTroops(createInitialState(1).cities.chengdu!)).toBe(1000)
    // 金成为瓶颈：金 30 → 300 < 民忠 50 → 1000
    expect(recruitMaxTroops({ ...createInitialState(1).cities.chengdu!, gold: 30 })).toBe(300)
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
    expect(canRecruit(createInitialState(1), 'chengdu', 'zhugeliang', 100, cfg).ok).toBe(true)
  })

  it('无在任武将（不在该城）-> 拒绝', () => {
    expect(canRecruit(createInitialState(1), 'chengdu', 'guanyu', 100, cfg).ok).toBe(false)
  })

  it('武将已占用 -> 拒绝', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { busy: true })
    expect(canRecruit(s, 'chengdu', 'zhugeliang', 100, cfg).ok).toBe(false)
  })

  it('城金 < 1 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 'chengdu', { gold: 0 })
    expect(canRecruit(s, 'chengdu', 'zhugeliang', 1, cfg).ok).toBe(false)
  })

  it('体力 < 12 -> 拒绝', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { stamina: 11 })
    expect(canRecruit(s, 'chengdu', 'zhugeliang', 100, cfg).ok).toBe(false)
  })

  it('amount < 1 -> 拒绝', () => {
    expect(canRecruit(createInitialState(1), 'chengdu', 'zhugeliang', 0, cfg).ok).toBe(false)
  })

  it('amount 超过可征上限 -> 拒绝', () => {
    expect(canRecruit(createInitialState(1), 'chengdu', 'zhugeliang', 1001, cfg).ok).toBe(false)
  })
})

describe('recruit 征兵', () => {
  it('后备兵 += N、城金 -= ceil(N/10)、体力 -= 12、busy=true；RNG 不变', () => {
    const s = createInitialState(1)
    const next = recruit(s, 'chengdu', 'zhugeliang', 100, cfg)
    expect(next.cities.chengdu!.reserveTroops).toBe(100)
    expect(next.cities.chengdu!.gold).toBe(500 - 10)
    expect(next.officers.zhugeliang!.stamina).toBe(100 - 12)
    expect(next.officers.zhugeliang!.busy).toBe(true)
    expect(next.rng.seed).toBe(s.rng.seed)
  })

  it('N < 10 仍至少扣 1 金', () => {
    const next = recruit(createInitialState(1), 'chengdu', 'zhugeliang', 5, cfg)
    expect(next.cities.chengdu!.gold).toBe(500 - 1)
    expect(next.cities.chengdu!.reserveTroops).toBe(5)
  })

  it('配置注入：改 recruitStaminaCost 改变体力消耗', () => {
    const next = recruit(createInitialState(1), 'chengdu', 'zhugeliang', 100, { ...cfg, recruitStaminaCost: 20 })
    expect(next.officers.zhugeliang!.stamina).toBe(100 - 20)
  })

  it('非法下令 no-op（返回原状态）', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { busy: true })
    expect(recruit(s, 'chengdu', 'zhugeliang', 100, cfg)).toBe(s)
  })
})
