import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import {
  canEntice,
  entice,
  executeEntice,
  canAlienate,
  executeAlienate,
  canInstigate,
  executeInstigate,
  canInduce,
  induce,
  executeInduce,
} from './diplomacy'
import { isBusy, isCaptive } from '../world/queries'
import { randInt } from '../shared/rng'

const cfg = DEFAULT_CONFIG

/** 占用某武将（占用为派生：入队一条引用该武将的命令）。 */
function occupy(s: GameState, id: number): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, { type: 'reclaim', officerId: id }] }
}

function withOfficer(
  s: GameState,
  id: number,
  patch: Partial<GameState['officers'][number]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}
function withCity(
  s: GameState,
  id: number,
  patch: Partial<GameState['cities'][number]>
): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}
function setCityLord(s: GameState, cityId: number, lordId: number): GameState {
  return { ...s, cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId } } }
}
function withWanderer(s: GameState, id: number, cityId: number): GameState {
  const o = { ...s.officers[8]!, id, name: String(id), lordId: null, cityId }
  return { ...s, officers: { ...s.officers, [id]: o } }
}

// 执行人=关羽（江陵·刘备）；敌方在任非君主=荀彧（许昌·曹操）。
describe('canEntice / canAlienate（敌方在任非君主武将）', () => {
  it('满足条件通过', () => {
    expect(canEntice(createInitialState(1), 4, 7, cfg).ok).toBe(true)
    expect(canAlienate(createInitialState(1), 4, 7, cfg).ok).toBe(true)
  })
  it('目标为君主 -> 拒绝', () => {
    expect(canEntice(createInitialState(1), 4, 6, cfg).ok).toBe(false)
  })
  it('目标为己方 -> 拒绝', () => {
    expect(canEntice(createInitialState(1), 4, 2, cfg).ok).toBe(false)
  })
  it('目标为在野 -> 拒绝', () => {
    const s = withWanderer(createInitialState(1), 100, 3)
    expect(canEntice(s, 4, 100, cfg).ok).toBe(false)
  })
  it('目标为俘虏 -> 拒绝', () => {
    const s = setCityLord(createInitialState(1), 3, 1) // 荀彧成俘虏
    expect(canEntice(s, 4, 7, cfg).ok).toBe(false)
  })
  it('执行人占用 / 体力不足 / 城金不足 -> 拒绝', () => {
    expect(canEntice(occupy(createInitialState(1), 4), 4, 7, cfg).ok).toBe(false)
    expect(canEntice(withOfficer(createInitialState(1), 4, { stamina: 10 }), 4, 7, cfg).ok).toBe(
      false
    )
    expect(canEntice(withCity(createInitialState(1), 2, { gold: 0 }), 4, 7, cfg).ok).toBe(false)
  })
})

describe('下令（占人 + 入队 + 不动 RNG）', () => {
  it('entice：扣体力20/城金50、占用(入队)、rng 不变', () => {
    const s = createInitialState(1)
    const next = entice(s, 4, 7, cfg).state
    expect(next.officers[4]!.stamina).toBe(s.officers[4]!.stamina - 20)
    expect(isBusy(next, 4)).toBe(true)
    expect(next.cities[2]!.gold).toBe(s.cities[2]!.gold - 50)
    expect(next.pendingCommands).toContainEqual({
      type: 'entice',
      officerId: 4,
      targetOfficerId: 7,
    })
    expect(next.rng).toEqual(s.rng)
  })
  it('induce：扣体力10/城金50（城池压制满足时）', () => {
    const s = setCityLord(createInitialState(1), 4, 1) // 刘备3城、曹操1城 -> 压制满足
    const next = induce(s, 4, 6, cfg).state
    expect(next.officers[4]!.stamina).toBe(s.officers[4]!.stamina - 10)
    expect(next.pendingCommands).toContainEqual({
      type: 'induce',
      officerId: 4,
      targetOfficerId: 6,
    })
  })
  it('前置不满足 -> no-op（state 不变、自报告失败 reason）', () => {
    const s = withCity(createInitialState(1), 2, { gold: 0 })
    const res = entice(s, 4, 7, cfg)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('gold-insufficient')
  })
})

describe('executeEntice（招揽三关：无 +50 安全线）', () => {
  it('智力差关失败（纯按差）：目标不变、仅消耗 R1', () => {
    let s = createInitialState(1)
    s = withOfficer(s, 4, { intelligence: 1 })
    s = withOfficer(s, 7, { intelligence: 100 })
    const [, rng1] = randInt(s.rng, 0, 99)
    const next = executeEntice(s, 4, 7).state
    expect(next.officers[7]!.lordId).toBe(6)
    expect(next.officers[7]!.cityId).toBe(3)
    expect(next.rng).toEqual(rng1)
  })

  it('三关全过：迁入执行人城、归己、忠诚 RandInt(40,79)', () => {
    // seed1 rolls [67,53,19]；exec100/target1/loyalty0/怕死(coeff40)：R1≤99过、R2<0永不过故过、R3=19<40过
    let s = createInitialState(1)
    s = withOfficer(s, 4, { intelligence: 100 })
    s = withOfficer(s, 7, { intelligence: 1, loyalty: 0, personality: 3 })
    const next = executeEntice(s, 4, 7).state
    expect(next.officers[7]!.lordId).toBe(1)
    expect(next.officers[7]!.cityId).toBe(2)
    expect(isCaptive(next, 7)).toBe(false)
    expect(next.officers[7]!.loyalty).toBeGreaterThanOrEqual(40)
    expect(next.officers[7]!.loyalty).toBeLessThanOrEqual(79)
  })

  it('性格关失败（忠义 coeff5，R3=19≥5）：目标不变', () => {
    let s = createInitialState(1)
    s = withOfficer(s, 4, { intelligence: 100 })
    s = withOfficer(s, 7, { intelligence: 1, loyalty: 0, personality: 0 })
    const next = executeEntice(s, 4, 7).state
    expect(next.officers[7]!.lordId).toBe(6)
  })

  it('守卫：目标已非合法（已归己）-> 原样返回', () => {
    const s = withOfficer(createInitialState(1), 7, { lordId: 1 })
    expect(executeEntice(s, 4, 7).state).toBe(s)
  })

  it('产出 diplomacy-result 事件（成败）', () => {
    let win = withOfficer(createInitialState(1), 4, { intelligence: 100 })
    win = withOfficer(win, 7, { intelligence: 1, loyalty: 0, personality: 3 })
    expect(executeEntice(win, 4, 7).events).toEqual([
      {
        kind: 'diplomacy-result',
        command: 'entice',
        officerId: 4,
        targetOfficerId: 7,
        success: true,
      },
    ])
    let lose = withOfficer(createInitialState(1), 4, { intelligence: 1 })
    lose = withOfficer(lose, 7, { intelligence: 100 })
    expect(executeEntice(lose, 4, 7).events).toEqual([
      {
        kind: 'diplomacy-result',
        command: 'entice',
        officerId: 4,
        targetOfficerId: 7,
        success: false,
      },
    ])
  })
})

describe('executeAlienate（离间：安全线+50，成功仅 −4）', () => {
  it('成功：忠诚 −4（下限0）', () => {
    // seed1；exec100/target1/loyalty50/卤莽(coeff50)：R1过、R2=53≥50过、R3=19<50过
    let s = createInitialState(1)
    s = withOfficer(s, 4, { intelligence: 100 })
    s = withOfficer(s, 7, { intelligence: 1, loyalty: 50, personality: 4 })
    const next = executeAlienate(s, 4, 7).state
    expect(next.officers[7]!.loyalty).toBe(46)
    expect(next.officers[7]!.lordId).toBe(6) // 不改归属
  })
  it('性格关失败：忠诚不变', () => {
    let s = createInitialState(1)
    s = withOfficer(s, 4, { intelligence: 100 })
    s = withOfficer(s, 7, { intelligence: 1, loyalty: 50, personality: 0 }) // 忠义coeff5, R3=19≥5
    const next = executeAlienate(s, 4, 7).state
    expect(next.officers[7]!.loyalty).toBe(50)
  })
})

describe('canInstigate（敌方太守，非君主）', () => {
  it('目标为敌城太守（邺城无君主 -> 司马懿96最高）-> 通过', () => {
    expect(canInstigate(createInitialState(1), 4, 9, cfg).ok).toBe(true)
  })
  it('目标非太守（许昌郭嘉，曹操在城即太守）-> 拒绝', () => {
    expect(canInstigate(createInitialState(1), 4, 8, cfg).ok).toBe(false)
  })
  it('目标为君主 -> 拒绝', () => {
    expect(canInstigate(createInitialState(1), 4, 6, cfg).ok).toBe(false)
  })
})

describe('executeInstigate（策反：自立为君）', () => {
  it('成功：目标自立、其城与同势力武将切归目标、不触发重选', () => {
    // seed1；guanyu intel120 vs simayi96：阈值120-96+50=74≥67过；simayi loyalty0过；大志(coeff60)R3=19<60过
    let s = createInitialState(1)
    s = withOfficer(s, 4, { intelligence: 120 })
    s = withOfficer(s, 9, { loyalty: 0 }) // 性格=1 大志
    const next = executeInstigate(s, 4, 9).state
    expect(next.officers[9]!.lordId).toBe(9)
    expect(next.cities[4]!.lordId).toBe(9)
    expect(next.officers[10]!.lordId).toBe(9) // 同城原势力武将随之
    expect(next.officers[6]!.lordId).toBe(6) // 许昌君主不受影响
    expect(next.cities[3]!.lordId).toBe(6)
  })

  it('成功额外产出 lord-instigated 系统事件', () => {
    let s = withOfficer(createInitialState(1), 4, { intelligence: 120 })
    s = withOfficer(s, 9, { loyalty: 0 })
    expect(executeInstigate(s, 4, 9).events).toEqual([
      {
        kind: 'diplomacy-result',
        command: 'instigate',
        officerId: 4,
        targetOfficerId: 9,
        success: true,
      },
      { kind: 'lord-instigated', officerId: 9, fromLordId: 6 },
    ])
  })
})

describe('canInduce / executeInduce（劝降敌君主，城池压制）', () => {
  it('城池压制不足（2 vs 2）-> 拒绝', () => {
    expect(canInduce(createInitialState(1), 4, 6, cfg).ok).toBe(false)
  })
  it('城池压制满足（3 vs 1）-> 通过', () => {
    const s = setCityLord(createInitialState(1), 4, 1)
    expect(canInduce(s, 4, 6, cfg).ok).toBe(true)
  })

  it('成功：吸收全部城与城内臣属，散落武将转在野', () => {
    // ye 划归刘备 -> 曹操仅许昌；seed5 rolls[84,1,16]；guanyu intel130 vs caocao90：阈值130-90+50=90≥84过；奸诈(coeff20)R2=1<20过
    let s = setCityLord(createInitialState(5), 4, 1)
    s = withOfficer(s, 4, { intelligence: 130 })
    const next = executeInduce(s, 4, 6).state
    expect(next.cities[3]!.lordId).toBe(1)
    expect(next.officers[6]!.lordId).toBe(1) // 君主本人并入
    expect(next.officers[7]!.lordId).toBe(1)
    expect(next.officers[8]!.lordId).toBe(1)
    // 司马懿/张辽在邺城（已归刘备、非曹操城内）-> 转在野
    expect(next.officers[9]!.lordId).toBeNull()
    expect(next.officers[10]!.lordId).toBeNull()
  })

  it('成功额外产出 lord-surrendered 系统事件', () => {
    let s = setCityLord(createInitialState(5), 4, 1)
    s = withOfficer(s, 4, { intelligence: 130 })
    expect(executeInduce(s, 4, 6).events).toEqual([
      {
        kind: 'diplomacy-result',
        command: 'induce',
        officerId: 4,
        targetOfficerId: 6,
        success: true,
      },
      { kind: 'lord-surrendered', fromLordId: 6, toLordId: 1 },
    ])
  })

  it('玩家君主免疫：目标为玩家君主 -> 直接失败、不动 RNG', () => {
    // 让刘备仅 1 城（江陵），曹操 3 城 -> 压制满足；执行人=司马懿（曹操·邺城）
    let s = createInitialState(1)
    s = setCityLord(s, 1, 6)
    s = withOfficer(s, 1, { cityId: 2 }) // 刘备移江陵，仍为江陵之主、非俘虏
    const next = executeInduce(s, 9, 1).state
    expect(next).toBe(s) // 免疫：原样返回（同引用）
  })
})

describe('端到端（game.apply + endMonth）', () => {
  it('招揽经下令+月末执行：执行人回城、队列清空', async () => {
    const { apply } = await import('../game')
    const s0 = createInitialState(1)
    const s1 = apply(s0, { type: 'entice', officerId: 4, targetOfficerId: 7 })
    expect(s1.pendingCommands).toHaveLength(1)
    const s2 = apply(s1, { type: 'endMonth' })
    expect(s2.pendingCommands).toHaveLength(0)
    expect(isBusy(s2, 4)).toBe(false)
  })

  it('可复现：相同种子整段推进结果一致', async () => {
    const { apply } = await import('../game')
    const run = () => {
      let s = createInitialState(7)
      s = apply(s, { type: 'entice', officerId: 4, targetOfficerId: 7 })
      s = apply(s, { type: 'instigate', officerId: 5, targetOfficerId: 9 })
      return apply(s, { type: 'endMonth' })
    }
    expect(run()).toEqual(run())
  })
})
