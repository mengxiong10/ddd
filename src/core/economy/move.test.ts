import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { canMove, move, executeMove } from './move'

function withOfficer(s: GameState, id: string, patch: Partial<GameState['officers'][string]>): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

// 刘备方：成都(chengdu) / 江陵(jiangling)；曹操方：许昌(xuchang)
describe('canMove 前置校验', () => {
  it('移动到己方另一座城通过', () => {
    expect(canMove(createInitialState(1), 'zhugeliang', 'jiangling').ok).toBe(true)
  })
  it('目标 = 本城 -> 拒绝', () => {
    expect(canMove(createInitialState(1), 'zhugeliang', 'chengdu').ok).toBe(false)
  })
  it('目标非己方城 -> 拒绝', () => {
    expect(canMove(createInitialState(1), 'zhugeliang', 'xuchang').ok).toBe(false)
  })
  it('目标城不存在 -> 拒绝', () => {
    expect(canMove(createInitialState(1), 'zhugeliang', 'nowhere').ok).toBe(false)
  })
  it('武将已占用 -> 拒绝', () => {
    expect(canMove(withOfficer(createInitialState(1), 'zhugeliang', { busy: true }), 'zhugeliang', 'jiangling').ok).toBe(false)
  })
})

describe('move 下令（月末执行）', () => {
  it('busy=true、入队 move；不扣体力/金，目标城与 cityId 不变', () => {
    const s = createInitialState(1)
    const next = move(s, 'zhugeliang', 'jiangling')
    expect(next.officers.zhugeliang!.busy).toBe(true)
    expect(next.officers.zhugeliang!.cityId).toBe('chengdu')
    expect(next.officers.zhugeliang!.stamina).toBe(100)
    expect(next.pendingCommands).toEqual([{ type: 'move', officerId: 'zhugeliang', targetCityId: 'jiangling' }])
  })

  it('非法下令 no-op（返回原状态）', () => {
    const s = createInitialState(1)
    expect(move(s, 'zhugeliang', 'chengdu')).toBe(s)
  })
})

describe('executeMove 月末执行', () => {
  it('把武将 cityId 改为目标城', () => {
    const next = executeMove(createInitialState(1), 'zhugeliang', 'jiangling')
    expect(next.officers.zhugeliang!.cityId).toBe('jiangling')
  })
})
