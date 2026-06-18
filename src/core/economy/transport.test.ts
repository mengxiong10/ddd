import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import { randInt } from '../shared/rng'
import type { GameState } from '../game-state'
import { canTransport, transport, executeTransport } from './transport'
import { isBusy } from '../world/queries'

const cfg = DEFAULT_CONFIG

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

// 成都(chengdu)：金500 粮400 后备兵0；江陵(jiangling) 同势力；许昌(xuchang) 敌方
describe('canTransport 前置校验', () => {
  it('送往己方城、量在范围内通过', () => {
    const s = withCity(createInitialState(1), 'chengdu', { reserveTroops: 100 })
    expect(canTransport(s, 'zhugeliang', 'jiangling', 100, 100, 50, cfg).ok).toBe(true)
  })
  it('目标非己方城 -> 拒绝', () => {
    expect(canTransport(createInitialState(1), 'zhugeliang', 'xuchang', 0, 0, 0, cfg).ok).toBe(
      false
    )
  })
  it('目标 = 本城 -> 拒绝', () => {
    expect(canTransport(createInitialState(1), 'zhugeliang', 'chengdu', 0, 0, 0, cfg).ok).toBe(
      false
    )
  })
  it('体力 < 8 -> 拒绝', () => {
    expect(
      canTransport(
        withOfficer(createInitialState(1), 'zhugeliang', { stamina: 7 }),
        'zhugeliang',
        'jiangling',
        0,
        0,
        0,
        cfg
      ).ok
    ).toBe(false)
  })
  it('超出发城资源 -> 拒绝', () => {
    const s = createInitialState(1)
    expect(canTransport(s, 'zhugeliang', 'jiangling', 401, 0, 0, cfg).ok).toBe(false)
    expect(canTransport(s, 'zhugeliang', 'jiangling', 0, 501, 0, cfg).ok).toBe(false)
    expect(canTransport(s, 'zhugeliang', 'jiangling', 0, 0, 1, cfg).ok).toBe(false)
  })
})

describe('transport 下令', () => {
  it('扣体力8、出发城立即扣粮/金/后备兵、占用(入队 transport)；RNG不变', () => {
    const s = withCity(createInitialState(1), 'chengdu', { reserveTroops: 100 })
    const next = transport(s, 'zhugeliang', 'jiangling', 100, 50, 30, cfg)
    expect(next.cities.chengdu!.food).toBe(400 - 100)
    expect(next.cities.chengdu!.gold).toBe(500 - 50)
    expect(next.cities.chengdu!.reserveTroops).toBe(100 - 30)
    expect(next.officers.zhugeliang!.stamina).toBe(100 - 8)
    expect(isBusy(next, 'zhugeliang')).toBe(true)
    expect(next.rng.seed).toBe(s.rng.seed)
    expect(next.pendingCommands).toEqual([
      {
        type: 'transport',
        officerId: 'zhugeliang',
        targetCityId: 'jiangling',
        food: 100,
        gold: 50,
        troops: 30,
      },
    ])
  })

  it('非法下令 no-op', () => {
    const s = createInitialState(1)
    expect(transport(s, 'zhugeliang', 'xuchang', 0, 0, 0, cfg)).toBe(s)
  })
})

describe('executeTransport 月末执行（80/20）', () => {
  it('命中 80% 时目标城接收资源；否则永损；均推进 RNG', () => {
    const s = withCity(createInitialState(1), 'jiangling', {
      food: 300,
      gold: 400,
      reserveTroops: 0,
    })
    const [roll] = randInt(s.rng, 1, 100)
    const next = executeTransport(s, 'zhugeliang', 'jiangling', 100, 50, 30)
    expect(next.rng.seed).not.toBe(s.rng.seed)
    if (roll <= 80) {
      expect(next.cities.jiangling!.food).toBe(300 + 100)
      expect(next.cities.jiangling!.gold).toBe(400 + 50)
      expect(next.cities.jiangling!.reserveTroops).toBe(0 + 30)
    } else {
      expect(next.cities.jiangling!.food).toBe(300)
      expect(next.cities.jiangling!.gold).toBe(400)
      expect(next.cities.jiangling!.reserveTroops).toBe(0)
    }
  })

  it('失败分支：构造落在 (80,100] 的种子，目标城不变', () => {
    // 找一个 roll>80 的种子
    let seed = 1
    while (true) {
      const [roll] = randInt({ seed }, 1, 100)
      if (roll > 80) break
      seed++
    }
    const s0 = createInitialState(1)
    const s = {
      ...s0,
      rng: { seed },
      cities: { ...s0.cities, jiangling: { ...s0.cities.jiangling!, food: 300 } },
    }
    const next = executeTransport(s, 'zhugeliang', 'jiangling', 100, 0, 0)
    expect(next.cities.jiangling!.food).toBe(300)
  })
})
