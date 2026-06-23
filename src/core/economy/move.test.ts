import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { canMove, move, executeMove } from './move'
import { isBusy } from '../world/queries'

/** 占用某武将（占用为派生：入队一条引用该武将的命令）。 */
function occupy(s: GameState, id: number): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, { type: 'reclaim', officerId: id }] }
}

// 刘备方：成都(chengdu) / 江陵(jiangling)；曹操方：许昌(xuchang)
describe('canMove 前置校验', () => {
  it('移动到己方另一座城通过', () => {
    expect(canMove(createInitialState(1), 2, 2).ok).toBe(true)
  })
  it('目标 = 本城 -> 拒绝', () => {
    expect(canMove(createInitialState(1), 2, 1).ok).toBe(false)
  })
  it('目标非己方城 -> 拒绝', () => {
    expect(canMove(createInitialState(1), 2, 3).ok).toBe(false)
  })
  it('目标为空城 -> 拒绝', () => {
    const s = createInitialState(1)
    const empty: GameState = {
      ...s,
      cities: { ...s.cities, 2: { ...s.cities[2]!, lordId: null } },
    }
    expect(canMove(empty, 2, 2)).toEqual({
      ok: false,
      reason: 'target-not-friendly-city',
    })
  })
  it('目标城不存在 -> 拒绝', () => {
    expect(canMove(createInitialState(1), 2, 999).ok).toBe(false)
  })
  it('武将已占用 -> 拒绝', () => {
    expect(canMove(occupy(createInitialState(1), 2), 2, 2).ok).toBe(false)
  })
})

describe('move 下令（月末执行）', () => {
  it('占用(入队 move)；不扣体力/金，目标城与 cityId 不变', () => {
    const s = createInitialState(1)
    const next = move(s, 2, 2).state
    expect(isBusy(next, 2)).toBe(true)
    expect(next.officers[2]!.cityId).toBe(1)
    expect(next.officers[2]!.stamina).toBe(100)
    expect(next.pendingCommands).toEqual([{ type: 'move', officerId: 2, targetCityId: 2 }])
  })

  it('非法下令 no-op（state 不变、自报告失败 reason）', () => {
    const s = createInitialState(1)
    const res = move(s, 2, 1)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('target-is-self-city')
  })
})

describe('executeMove 月末执行', () => {
  it('把武将 cityId 改为目标城', () => {
    const next = executeMove(createInitialState(1), 2, 2)
    expect(next.officers[2]!.cityId).toBe(2)
  })
})
