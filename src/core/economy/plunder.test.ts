import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import type { GameState } from '../game-state'
import { canPlunder, plunder, executePlunder } from './plunder'
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

// 诸葛亮：智力 100、武力 50(mock) -> power = 150；粮 +=150×5=750、金 +=150×2=300
describe('canPlunder 前置校验', () => {
  it('满足条件时通过', () => {
    expect(canPlunder(createInitialState(1), 'zhugeliang', cfg).ok).toBe(true)
  })

  it('武将已占用 -> 拒绝', () => {
    const s = occupy(createInitialState(1), 'zhugeliang')
    expect(canPlunder(s, 'zhugeliang', cfg).ok).toBe(false)
  })

  it('体力 < 12 -> 拒绝', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { stamina: 11 })
    expect(canPlunder(s, 'zhugeliang', cfg).ok).toBe(false)
  })
})

describe('plunder 下令（效果延后）', () => {
  it('扣体力 12、占用(入队 plunder)；城/粮/金不变、RNG 不变', () => {
    const s = createInitialState(1)
    const next = plunder(s, 'zhugeliang', cfg).state
    expect(next.officers.zhugeliang!.stamina).toBe(100 - 12)
    expect(isBusy(next, 'zhugeliang')).toBe(true)
    expect(next.pendingCommands).toEqual([{ type: 'plunder', officerId: 'zhugeliang' }])
    expect(next.cities.chengdu!.agriculture).toBe(300)
    expect(next.cities.chengdu!.commerce).toBe(200)
    expect(next.cities.chengdu!.loyalty).toBe(50)
    expect(next.cities.chengdu!.food).toBe(400)
    expect(next.cities.chengdu!.gold).toBe(500)
    expect(next.rng.seed).toBe(s.rng.seed)
  })

  it('多次下令按顺序入队', () => {
    let s = plunder(createInitialState(1), 'zhugeliang', cfg).state
    s = plunder(s, 'pangtong', cfg).state
    expect(s.pendingCommands).toEqual([
      { type: 'plunder', officerId: 'zhugeliang' },
      { type: 'plunder', officerId: 'pangtong' },
    ])
  })

  it('非法下令 no-op（state 不变、自报告失败 reason）', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { stamina: 11 })
    const res = plunder(s, 'zhugeliang', cfg)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('stamina-insufficient')
  })
})

describe('executePlunder 月末执行', () => {
  it('本城被 ravage + 粮 +=power×5 + 金 +=power×2', () => {
    const next = executePlunder(createInitialState(1), 'zhugeliang').state
    const c = next.cities.chengdu!
    expect(c.agriculture).toBe(150)
    expect(c.commerce).toBe(100)
    expect(c.loyalty).toBe(25)
    expect(c.food).toBe(400 + 750)
    expect(c.gold).toBe(500 + 300)
  })

  it('产出吃道具加成（有效智+力）', () => {
    // 雌雄双股剑 武力+10 给诸葛亮：power = 100 + 60 = 160 -> 粮 +800、金 +320
    const s0 = createInitialState(1)
    const s = {
      ...s0,
      items: {
        ...s0.items,
        cixiongshuanggujian: {
          ...s0.items.cixiongshuanggujian!,
          holder: { kind: 'officer', officerId: 'zhugeliang', equipSeq: 0 } as const,
        },
      },
    }
    const c = executePlunder(s, 'zhugeliang').state.cities.chengdu!
    expect(c.food).toBe(400 + 800)
    expect(c.gold).toBe(500 + 320)
  })

  it('产出 plunder-done 事件（金/粮收益）', () => {
    const { events } = executePlunder(createInitialState(1), 'zhugeliang')
    expect(events).toEqual([
      {
        kind: 'plunder-done',
        officerId: 'zhugeliang',
        cityId: 'chengdu',
        goldGained: 300,
        foodGained: 750,
      },
    ])
  })
})
