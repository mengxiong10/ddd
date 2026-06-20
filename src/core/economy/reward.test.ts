import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { canReward, reward, canConfiscate, confiscate } from './reward'
import { holdByOfficer } from '../world/item'
import { isBusy, itemsOfOfficer, itemsInCity, officerLoyalty } from '../world/queries'

function withOfficer(
  s: GameState,
  id: string,
  patch: Partial<GameState['officers'][string]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}
/** 占用某武将（占用为派生：入队一条引用该武将的命令）。 */
function occupy(s: GameState, id: string): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, { type: 'develop', officerId: id }] }
}
function giveItem(s: GameState, itemId: string, officerId: string): GameState {
  return { ...s, items: { ...s.items, [itemId]: holdByOfficer(s.items[itemId]!, officerId) } }
}
function setCityLord(s: GameState, cityId: string, lordId: string): GameState {
  return { ...s, cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId } } }
}
// 成都有 雌雄双股剑(cixiongshuanggujian)；诸葛亮/庞统/刘备在成都

describe('canReward 前置校验', () => {
  it('合法：道具属作用城、武将非俘虏、道具数<2', () => {
    expect(canReward(createInitialState(1), 'zhugeliang', 'cixiongshuanggujian').ok).toBe(true)
  })
  it('道具不属于作用城 -> 拒绝（许昌的孟德新书 vs 成都武将）', () => {
    expect(canReward(createInitialState(1), 'zhugeliang', 'mengde-xinshu').ok).toBe(false)
  })
  it('武将已持 2 件 -> 拒绝', () => {
    let s = createInitialState(1)
    // 注入两件归属诸葛亮的道具
    s = {
      ...s,
      items: {
        ...s.items,
        a: {
          id: 'a',
          name: 'A',
          forceBonus: 1,
          intelBonus: 0,
          movementBonus: 0,
          troopTypeOverride: 0,
          holder: { kind: 'officer', officerId: 'zhugeliang', equipSeq: 0 },
          discovered: true,
          recruiterId: null,
        },
        b: {
          id: 'b',
          name: 'B',
          forceBonus: 1,
          intelBonus: 0,
          movementBonus: 0,
          troopTypeOverride: 0,
          holder: { kind: 'officer', officerId: 'zhugeliang', equipSeq: 1 },
          discovered: true,
          recruiterId: null,
        },
      },
    }
    expect(canReward(s, 'zhugeliang', 'cixiongshuanggujian').ok).toBe(false)
  })
  it('目标为俘虏 -> 拒绝', () => {
    // 成都归曹操 -> 诸葛亮成俘虏；道具仍在成都
    const s = setCityLord(createInitialState(1), 'chengdu', 'caocao')
    expect(canReward(s, 'zhugeliang', 'cixiongshuanggujian').ok).toBe(false)
  })
  it('武将或道具不存在 -> 拒绝', () => {
    const s = createInitialState(1)
    expect(canReward(s, 'nobody', 'cixiongshuanggujian').ok).toBe(false)
    expect(canReward(s, 'zhugeliang', 'noitem').ok).toBe(false)
  })
  it('道具未被发现 -> 拒绝（搜寻发现前不可赏赐）', () => {
    const s = createInitialState(1)
    const hidden = {
      ...s,
      items: {
        ...s.items,
        cixiongshuanggujian: { ...s.items.cixiongshuanggujian!, discovered: false },
      },
    }
    expect(canReward(hidden, 'zhugeliang', 'cixiongshuanggujian').ok).toBe(false)
  })
})

describe('reward 赏赐', () => {
  it('道具转给武将、非君主忠诚 +8、不占人、即时、不耗 RNG', () => {
    const s = createInitialState(1)
    const next = reward(s, 'zhugeliang', 'cixiongshuanggujian').state
    expect(itemsOfOfficer(next, 'zhugeliang').map((i) => i.id)).toEqual(['cixiongshuanggujian'])
    expect(itemsInCity(next, 'chengdu')).toHaveLength(0)
    expect(next.officers.zhugeliang!.loyalty).toBe(58)
    expect(isBusy(next, 'zhugeliang')).toBe(false)
    expect(next.pendingCommands).toEqual(s.pendingCommands)
    expect(next.rng.seed).toBe(s.rng.seed)
  })
  it('忠诚封顶 100', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { loyalty: 95 })
    expect(reward(s, 'zhugeliang', 'cixiongshuanggujian').state.officers.zhugeliang!.loyalty).toBe(
      100
    )
  })
  it('赏赐给君主：道具照常转移、忠诚仍派生 100', () => {
    const s = createInitialState(1)
    const next = reward(s, 'liubei', 'cixiongshuanggujian').state
    expect(itemsOfOfficer(next, 'liubei')).toHaveLength(1)
    expect(officerLoyalty(next, 'liubei')).toBe(100)
  })
  it('占用中武将仍可被赏赐（不校验占用）', () => {
    const s = occupy(createInitialState(1), 'zhugeliang')
    expect(reward(s, 'zhugeliang', 'cixiongshuanggujian').state.officers.zhugeliang!.loyalty).toBe(
      58
    )
  })
  it('非法 no-op（state 不变、自报告失败 reason）', () => {
    const s = createInitialState(1)
    const res = reward(s, 'zhugeliang', 'mengde-xinshu')
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('item-not-in-city')
  })
  it('连赏两件：equipSeq 递增（首件 0、次件 1），表达装备先后', () => {
    // 成都再放一件道具，使同城可连赏两件给诸葛亮
    let s = createInitialState(1)
    s = {
      ...s,
      items: {
        ...s.items,
        gem: {
          id: 'gem',
          name: '玉',
          forceBonus: 0,
          intelBonus: 0,
          movementBonus: 0,
          troopTypeOverride: 0 as const,
          holder: { kind: 'city', cityId: 'chengdu' } as const,
          discovered: true,
          recruiterId: null,
        },
      },
    }
    s = reward(s, 'zhugeliang', 'cixiongshuanggujian').state
    s = reward(s, 'zhugeliang', 'gem').state
    const seqOf = (id: string) => {
      const h = s.items[id]!.holder
      return h.kind === 'officer' ? h.equipSeq : -1
    }
    expect(seqOf('cixiongshuanggujian')).toBe(0)
    expect(seqOf('gem')).toBe(1)
  })
})

describe('canConfiscate / confiscate 没收', () => {
  it('合法：道具属该武将', () => {
    const s = giveItem(createInitialState(1), 'cixiongshuanggujian', 'zhugeliang')
    expect(canConfiscate(s, 'zhugeliang', 'cixiongshuanggujian').ok).toBe(true)
  })
  it('道具不属于该武将 -> 拒绝', () => {
    expect(canConfiscate(createInitialState(1), 'zhugeliang', 'cixiongshuanggujian').ok).toBe(false)
  })
  it('目标为俘虏 -> 拒绝', () => {
    let s = giveItem(createInitialState(1), 'cixiongshuanggujian', 'zhugeliang')
    s = setCityLord(s, 'chengdu', 'caocao')
    expect(canConfiscate(s, 'zhugeliang', 'cixiongshuanggujian').ok).toBe(false)
  })
  it('道具收回所在城、非君主忠诚 −20、即时不占人', () => {
    const s = withOfficer(
      giveItem(createInitialState(1), 'cixiongshuanggujian', 'zhugeliang'),
      'zhugeliang',
      { loyalty: 50 }
    )
    const next = confiscate(s, 'zhugeliang', 'cixiongshuanggujian').state
    expect(itemsInCity(next, 'chengdu').map((i) => i.id)).toEqual(['cixiongshuanggujian'])
    expect(itemsOfOfficer(next, 'zhugeliang')).toHaveLength(0)
    expect(next.officers.zhugeliang!.loyalty).toBe(30)
    expect(isBusy(next, 'zhugeliang')).toBe(false)
  })
  it('忠诚下限 0', () => {
    const s = withOfficer(
      giveItem(createInitialState(1), 'cixiongshuanggujian', 'zhugeliang'),
      'zhugeliang',
      { loyalty: 10 }
    )
    expect(
      confiscate(s, 'zhugeliang', 'cixiongshuanggujian').state.officers.zhugeliang!.loyalty
    ).toBe(0)
  })
  it('没收君主道具：照常收回、忠诚派生仍 100', () => {
    const s = giveItem(createInitialState(1), 'cixiongshuanggujian', 'liubei')
    const next = confiscate(s, 'liubei', 'cixiongshuanggujian').state
    expect(itemsInCity(next, 'chengdu')).toHaveLength(1)
    expect(officerLoyalty(next, 'liubei')).toBe(100)
  })
  it('非法 no-op（state 不变、自报告失败 reason）', () => {
    const s = createInitialState(1)
    const res = confiscate(s, 'zhugeliang', 'cixiongshuanggujian')
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('item-not-held-by-officer')
  })
})
