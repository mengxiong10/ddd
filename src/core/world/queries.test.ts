import { describe, it, expect } from 'vitest'
import { createInitialState } from './fixture'
import {
  officersInCity, citiesOfLord, isCaptive,
  itemsInCity, itemsOfOfficer, effectiveOfficer, officerLoyalty,
  wanderingOfficersInCity, undiscoveredItemsInCity, captivesInCity,
} from './queries'
import { setBusy } from './officer'
import { holdByOfficer } from './item'
import type { GameState } from '../game-state'

/** 把某道具归属改给某武将。 */
function giveItem(s: GameState, itemId: string, officerId: string): GameState {
  return { ...s, items: { ...s.items, [itemId]: holdByOfficer(s.items[itemId]!, officerId) } }
}

/** 把某城归属改给另一君主（用于制造俘虏：城内原武将 lordId 不变 -> 成俘虏）。 */
function setCityLord(s: GameState, cityId: string, lordId: string): GameState {
  return { ...s, cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId } } }
}

describe('world queries（基于初始 fixture）', () => {
  it('初始局面规模正确', () => {
    const s = createInitialState(1)
    expect(Object.keys(s.cities)).toHaveLength(4)
    expect(Object.keys(s.officers)).toHaveLength(10)
    expect(s.playerLordId).toBe('liubei')
    expect(s.month).toBe(1)
  })

  it('citiesOfLord 返回该君主的城', () => {
    const s = createInitialState(1)
    expect(citiesOfLord(s, 'liubei').map((c) => c.id).sort()).toEqual(['chengdu', 'jiangling'])
    expect(citiesOfLord(s, 'caocao')).toHaveLength(2)
  })

  it('officersInCity 返回驻城武将', () => {
    const s = createInitialState(1)
    expect(officersInCity(s, 'chengdu')).toHaveLength(3)
  })

  it('onlyAvailable 排除已占用武将', () => {
    const s = createInitialState(1)
    const busy = { ...s, officers: { ...s.officers, zhugeliang: setBusy(s.officers.zhugeliang!, true) } }
    expect(officersInCity(busy, 'chengdu', { onlyAvailable: true })).toHaveLength(2)
    expect(officersInCity(busy, 'chengdu')).toHaveLength(3)
  })

  it('isCaptive：武将归属 ≠ 所在城归属即俘虏', () => {
    const s = createInitialState(1)
    expect(isCaptive(s, 'guanyu')).toBe(false) // 关羽在江陵，同归刘备
    const captured = setCityLord(s, 'jiangling', 'caocao') // 江陵被曹操占，关羽就地成俘虏
    expect(isCaptive(captured, 'guanyu')).toBe(true)
    expect(isCaptive(captured, 'caocao')).toBe(false)
  })

  it('onlyAvailable 排除俘虏', () => {
    const s = setCityLord(createInitialState(1), 'jiangling', 'caocao')
    // 江陵原有关羽、张飞两将，均成俘虏 -> 在任为 0
    expect(officersInCity(s, 'jiangling')).toHaveLength(2)
    expect(officersInCity(s, 'jiangling', { onlyAvailable: true })).toHaveLength(0)
  })

  it('itemsInCity / itemsOfOfficer 按 holder 派生，同一道具只出现在一处', () => {
    const s = createInitialState(1)
    expect(itemsInCity(s, 'chengdu').map((i) => i.id)).toEqual(['cixiongshuanggujian'])
    expect(itemsOfOfficer(s, 'guanyu')).toHaveLength(0)

    const s2 = giveItem(s, 'cixiongshuanggujian', 'guanyu')
    expect(itemsInCity(s2, 'chengdu')).toHaveLength(0)
    expect(itemsOfOfficer(s2, 'guanyu').map((i) => i.id)).toEqual(['cixiongshuanggujian'])
  })

  it('effectiveOfficer：force/intel 叠加所持道具加成，其余字段不变', () => {
    const s = createInitialState(1)
    const guanyu = s.officers.guanyu!
    expect(effectiveOfficer(s, 'guanyu')).toEqual(guanyu) // 无道具时原样

    const s2 = giveItem(s, 'cixiongshuanggujian', 'guanyu') // 武力+10
    const eff = effectiveOfficer(s2, 'guanyu')
    expect(eff.force).toBe(guanyu.force + 10)
    expect(eff.intelligence).toBe(guanyu.intelligence)
    expect({ ...eff, force: guanyu.force }).toEqual(guanyu) // 仅 force 变
  })

  it('officerLoyalty：君主恒 100（即使存储值非 100），非君主取存储值', () => {
    const s = createInitialState(1)
    expect(officerLoyalty(s, 'zhugeliang')).toBe(50)
    // 刻意把君主存储值改脏，仍应派生 100
    const dirty = { ...s, officers: { ...s.officers, liubei: { ...s.officers.liubei!, loyalty: 13 } } }
    expect(officerLoyalty(dirty, 'liubei')).toBe(100)
  })
})

/** 在成都放一名在野武将（lordId=null）。 */
function withWanderer(s: GameState, id: string, cityId: string): GameState {
  const o = { ...s.officers.zhugeliang!, id, name: id, lordId: null, cityId, busy: false }
  return { ...s, officers: { ...s.officers, [id]: o } }
}

describe('在野/未发现（登场与搜寻）', () => {
  it('isCaptive：无主武将（lordId=null）不是俘虏', () => {
    const s = withWanderer(createInitialState(1), 'wild1', 'chengdu')
    expect(isCaptive(s, 'wild1')).toBe(false)
  })

  it('officersInCity：在野武将算驻城但不算在任', () => {
    const s = withWanderer(createInitialState(1), 'wild1', 'chengdu')
    expect(officersInCity(s, 'chengdu')).toHaveLength(4) // 含在野
    expect(officersInCity(s, 'chengdu', { onlyAvailable: true })).toHaveLength(3) // 排除在野
  })

  it('wanderingOfficersInCity：仅本城在野武将', () => {
    const s = withWanderer(createInitialState(1), 'wild1', 'chengdu')
    expect(wanderingOfficersInCity(s, 'chengdu').map((o) => o.id)).toEqual(['wild1'])
    expect(wanderingOfficersInCity(s, 'jiangling')).toHaveLength(0)
  })

  it('undiscoveredItemsInCity：仅本城未发现道具', () => {
    const s = createInitialState(1)
    // 既有道具 discovered=true，不计入
    expect(undiscoveredItemsInCity(s, 'chengdu')).toHaveLength(0)
    const hidden = {
      ...s,
      items: { ...s.items, gem: {
        id: 'gem', name: '隐宝', forceBonus: 1, intelBonus: 0,
        holder: { kind: 'city', cityId: 'chengdu' } as const, discovered: false, recruiterId: null,
      } },
    }
    expect(undiscoveredItemsInCity(hidden, 'chengdu').map((i) => i.id)).toEqual(['gem'])
    expect(itemsInCity(hidden, 'chengdu').map((i) => i.id).sort()).toEqual(['cixiongshuanggujian', 'gem'])
  })

  it('captivesInCity 只返回本城俘虏（非俘虏/在野不计入）', () => {
    const s = createInitialState(1)
    expect(captivesInCity(s, 'xuchang')).toHaveLength(0) // 初始无俘虏
    // 许昌被刘备占 -> 城内曹操/荀彧/郭嘉成俘虏
    const conquered = setCityLord(s, 'xuchang', 'liubei')
    expect(captivesInCity(conquered, 'xuchang').map((o) => o.id).sort()).toEqual(['caocao', 'guojia', 'xunyu'])
    // 在野武将（lordId=null）不算俘虏
    const wandering = {
      ...conquered,
      officers: { ...conquered.officers, ronin: {
        ...conquered.officers.caocao!, id: 'ronin', lordId: null, cityId: 'xuchang',
      } },
    }
    expect(captivesInCity(wandering, 'xuchang').map((o) => o.id)).not.toContain('ronin')
  })
})
