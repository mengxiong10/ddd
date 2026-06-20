import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import { randInt } from '../shared/rng'
import type { GameState } from '../game-state'
import { canGovern, govern } from './govern'
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

describe('canGovern 前置校验', () => {
  it('正常城防灾<100 时通过', () => {
    expect(canGovern(createInitialState(1), 'zhugeliang', cfg).ok).toBe(true)
  })
  it('武将已占用 -> 拒绝', () => {
    expect(canGovern(occupy(createInitialState(1), 'zhugeliang'), 'zhugeliang', cfg).ok).toBe(false)
  })
  it('本城金 < 50 -> 拒绝', () => {
    expect(
      canGovern(withCity(createInitialState(1), 'chengdu', { gold: 49 }), 'zhugeliang', cfg).ok
    ).toBe(false)
  })
  it('体力 < 8 -> 拒绝', () => {
    expect(
      canGovern(withOfficer(createInitialState(1), 'zhugeliang', { stamina: 7 }), 'zhugeliang', cfg)
        .ok
    ).toBe(false)
  })
  it('已正常且防灾=100 -> 拒绝（避免浪费）', () => {
    const s = withCity(createInitialState(1), 'chengdu', {
      status: 'normal',
      disasterPrevention: 100,
    })
    expect(canGovern(s, 'zhugeliang', cfg).ok).toBe(false)
  })
  it('异常城即使防灾=100 仍可下令（治理清灾）', () => {
    const s = withCity(createInitialState(1), 'chengdu', {
      status: 'famine',
      disasterPrevention: 100,
    })
    expect(canGovern(s, 'zhugeliang', cfg).ok).toBe(true)
  })
})

describe('govern 下令（即时）', () => {
  it('状态→normal、防灾+=RandInt(1,4)封顶100、扣体力8、扣城金50、占用(入队 govern)、推进RNG', () => {
    const s = withCity(createInitialState(1), 'chengdu', {
      status: 'flood',
      disasterPrevention: 30,
    })
    const [expectedGain] = randInt(s.rng, 1, 4)
    const next = govern(s, 'zhugeliang', cfg).state
    expect(next.cities.chengdu!.status).toBe('normal')
    expect(next.cities.chengdu!.disasterPrevention).toBe(30 + expectedGain)
    expect(next.cities.chengdu!.gold).toBe(500 - 50)
    expect(next.officers.zhugeliang!.stamina).toBe(100 - 8)
    expect(isBusy(next, 'zhugeliang')).toBe(true)
    expect(next.rng.seed).not.toBe(s.rng.seed)
    expect(next.pendingCommands).toEqual([{ type: 'govern', officerId: 'zhugeliang' }])
  })

  it('防灾接近上限时不超过 100', () => {
    const s = withCity(createInitialState(1), 'chengdu', { status: 'riot', disasterPrevention: 99 })
    expect(govern(s, 'zhugeliang', cfg).state.cities.chengdu!.disasterPrevention).toBe(100)
  })

  it('非法下令 no-op（返回原状态）', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { stamina: 7 })
    expect(govern(s, 'zhugeliang', cfg).state).toBe(s)
  })

  it('产出 govern-done 事件（防灾新值/增量）', () => {
    const s = withCity(createInitialState(1), 'chengdu', {
      status: 'flood',
      disasterPrevention: 30,
    })
    const { state, events } = govern(s, 'zhugeliang', cfg)
    const newPrevention = state.cities.chengdu!.disasterPrevention
    expect(events).toEqual([
      {
        kind: 'govern-done',
        officerId: 'zhugeliang',
        cityId: 'chengdu',
        newPrevention,
        delta: newPrevention - 30,
      },
    ])
  })
})
