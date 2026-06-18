import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import { randInt } from '../shared/rng'
import type { GameState } from '../game-state'
import { canPatrol, patrol } from './patrol'
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

describe('canPatrol 前置校验', () => {
  it('满足条件时通过', () => {
    expect(canPatrol(createInitialState(1), 'zhugeliang', cfg).ok).toBe(true)
  })
  it('武将已占用 -> 拒绝', () => {
    expect(canPatrol(occupy(createInitialState(1), 'zhugeliang'), 'zhugeliang', cfg).ok).toBe(false)
  })
  it('本城金 < 50 -> 拒绝', () => {
    expect(
      canPatrol(withCity(createInitialState(1), 'chengdu', { gold: 49 }), 'zhugeliang', cfg).ok
    ).toBe(false)
  })
  it('体力 < 8 -> 拒绝', () => {
    expect(
      canPatrol(withOfficer(createInitialState(1), 'zhugeliang', { stamina: 7 }), 'zhugeliang', cfg)
        .ok
    ).toBe(false)
  })
})

describe('patrol 下令（即时）', () => {
  it('民忠 +=RandInt(1,4) 封顶100、人口+100、扣体力8、扣城金50、占用(入队 patrol)、推进RNG', () => {
    const s = createInitialState(1)
    const [expectedGain] = randInt(s.rng, 1, 4)
    const next = patrol(s, 'zhugeliang', cfg)
    expect(next.cities.chengdu!.loyalty).toBe(50 + expectedGain)
    expect(next.cities.chengdu!.population).toBe(30000 + 100)
    expect(next.cities.chengdu!.gold).toBe(500 - 50)
    expect(next.officers.zhugeliang!.stamina).toBe(100 - 8)
    expect(isBusy(next, 'zhugeliang')).toBe(true)
    expect(next.rng.seed).not.toBe(s.rng.seed)
    expect(next.pendingCommands).toEqual([{ type: 'patrol', officerId: 'zhugeliang' }])
  })

  it('民忠接近上限时不超过 100', () => {
    const s = withCity(createInitialState(1), 'chengdu', { loyalty: 99 })
    expect(patrol(s, 'zhugeliang', cfg).cities.chengdu!.loyalty).toBe(100)
  })

  it('非法下令 no-op（返回原状态）', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { stamina: 7 })
    expect(patrol(s, 'zhugeliang', cfg)).toBe(s)
  })
})
