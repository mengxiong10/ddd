import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import { canTrade, trade } from './trade'
import { isBusy } from '../world/queries'

const cfg = DEFAULT_CONFIG

/** 占用某武将（占用为派生：入队一条引用该武将的命令）。 */
function occupy(s: GameState, id: string): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, { type: 'develop', officerId: id }] }
}

function withOfficer(
  s: GameState,
  id: string,
  patch: Partial<GameState['officers'][string]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}
function withCity(
  s: GameState,
  id: string,
  patch: Partial<GameState['cities'][string]>
): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}

// 成都：金 500、粮 400
describe('canTrade 前置校验', () => {
  it('买入在上限内通过；超 floor(金/5) 拒绝', () => {
    const s = createInitialState(1)
    expect(canTrade(s, 'zhugeliang', 'buy', 100, cfg).ok).toBe(true) // 100×5=500 ≤ 500
    expect(canTrade(s, 'zhugeliang', 'buy', 101, cfg).ok).toBe(false)
  })
  it('卖出不超城粮通过；超城粮拒绝', () => {
    const s = createInitialState(1)
    expect(canTrade(s, 'zhugeliang', 'sell', 400, cfg).ok).toBe(true)
    expect(canTrade(s, 'zhugeliang', 'sell', 401, cfg).ok).toBe(false)
  })
  it('体力 < 12 -> 拒绝', () => {
    expect(
      canTrade(
        withOfficer(createInitialState(1), 'zhugeliang', { stamina: 11 }),
        'zhugeliang',
        'buy',
        1,
        cfg
      ).ok
    ).toBe(false)
  })
  it('负数 / 非整数 -> 拒绝', () => {
    const s = createInitialState(1)
    expect(canTrade(s, 'zhugeliang', 'buy', -1, cfg).ok).toBe(false)
    expect(canTrade(s, 'zhugeliang', 'buy', 1.5, cfg).ok).toBe(false)
  })
  it('武将已占用 -> 拒绝', () => {
    expect(
      canTrade(occupy(createInitialState(1), 'zhugeliang'), 'zhugeliang', 'buy', 1, cfg).ok
    ).toBe(false)
  })
})

describe('trade 下令（即时·占人）', () => {
  it('买入：粮+amount、金-amount×5、扣体力12、占用(入队 trade)', () => {
    const next = trade(createInitialState(1), 'zhugeliang', 'buy', 50, cfg).state
    expect(next.cities.chengdu!.food).toBe(400 + 50)
    expect(next.cities.chengdu!.gold).toBe(500 - 250)
    expect(next.officers.zhugeliang!.stamina).toBe(100 - 12)
    expect(isBusy(next, 'zhugeliang')).toBe(true)
    expect(next.pendingCommands).toEqual([{ type: 'trade', officerId: 'zhugeliang' }])
  })

  it('卖出：粮-amount、金+amount×2', () => {
    const next = trade(createInitialState(1), 'zhugeliang', 'sell', 100, cfg).state
    expect(next.cities.chengdu!.food).toBe(400 - 100)
    expect(next.cities.chengdu!.gold).toBe(500 + 200)
  })

  it('卖出城金不封顶（可超 30000）', () => {
    const s = withCity(createInitialState(1), 'chengdu', { gold: 29900, food: 1000 })
    expect(trade(s, 'zhugeliang', 'sell', 1000, cfg).state.cities.chengdu!.gold).toBe(29900 + 2000)
  })

  it('非法下令 no-op（state 不变、自报告失败 reason）', () => {
    const s = createInitialState(1)
    const res = trade(s, 'zhugeliang', 'buy', 101, cfg)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('gold-insufficient')
  })
})
