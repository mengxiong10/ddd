import { describe, it, expect } from 'vitest'
import { createInitialState } from './fixture'
import {
  officersInCity,
  citiesOfLord,
  isCaptive,
  itemsInCity,
  itemsOfOfficer,
  effectiveOfficer,
  officerLoyalty,
  wanderingOfficersInCity,
  undiscoveredItemsInCity,
  captivesInCity,
  governorOf,
  effectiveTroopType,
  officerMovement,
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
    expect(
      citiesOfLord(s, 'liubei')
        .map((c) => c.id)
        .sort()
    ).toEqual(['chengdu', 'jiangling'])
    expect(citiesOfLord(s, 'caocao')).toHaveLength(2)
  })

  it('officersInCity 返回驻城武将', () => {
    const s = createInitialState(1)
    expect(officersInCity(s, 'chengdu')).toHaveLength(3)
  })

  it('onlyAvailable 排除已占用武将', () => {
    const s = createInitialState(1)
    const busy = {
      ...s,
      officers: { ...s.officers, zhugeliang: setBusy(s.officers.zhugeliang!, true) },
    }
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
    const dirty = {
      ...s,
      officers: { ...s.officers, liubei: { ...s.officers.liubei!, loyalty: 13 } },
    }
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
      items: {
        ...s.items,
        gem: {
          id: 'gem',
          name: '隐宝',
          forceBonus: 1,
          intelBonus: 0,
          movementBonus: 0,
          troopTypeOverride: 0 as const,
          holder: { kind: 'city', cityId: 'chengdu' } as const,
          discovered: false,
          recruiterId: null,
        },
      },
    }
    expect(undiscoveredItemsInCity(hidden, 'chengdu').map((i) => i.id)).toEqual(['gem'])
    expect(
      itemsInCity(hidden, 'chengdu')
        .map((i) => i.id)
        .sort()
    ).toEqual(['cixiongshuanggujian', 'gem'])
  })

  it('governorOf：君主驻城则太守=君主（即便他人智力更高）', () => {
    const s = createInitialState(1)
    // 成都驻刘备(君主,75)、诸葛亮(100)、庞统(90)：太守=刘备
    expect(governorOf(s, 'chengdu')!.id).toBe('liubei')
  })

  it('governorOf：君主不在城则取在任最高有效智力者', () => {
    const s = createInitialState(1)
    // 江陵无君主：关羽(75) > 张飞(60) -> 太守=关羽
    expect(governorOf(s, 'jiangling')!.id).toBe('guanyu')
  })

  it('governorOf：有效智力含道具加成', () => {
    const s = createInitialState(1)
    const boosted: GameState = {
      ...s,
      items: {
        ...s.items,
        boost: {
          id: 'boost',
          name: '智珠',
          forceBonus: 0,
          intelBonus: 20,
          movementBonus: 0,
          troopTypeOverride: 0,
          holder: { kind: 'officer', officerId: 'zhangfei', equipSeq: 0 } as const,
          discovered: true,
          recruiterId: null,
        },
      },
    }
    // 张飞 60+20=80 > 关羽 75 -> 太守=张飞
    expect(governorOf(boosted, 'jiangling')!.id).toBe('zhangfei')
  })

  it('governorOf：平局取 id 字典序最小', () => {
    const s = createInitialState(1)
    const tied = {
      ...s,
      officers: { ...s.officers, zhangfei: { ...s.officers.zhangfei!, intelligence: 75 } },
    }
    // 关羽/张飞均 75 -> 'guanyu' < 'zhangfei'
    expect(governorOf(tied, 'jiangling')!.id).toBe('guanyu')
  })

  it('governorOf：空城/仅俘虏返回 null', () => {
    const s = setCityLord(createInitialState(1), 'jiangling', 'caocao')
    // 江陵被曹操占，关羽/张飞成俘虏（lordId≠城归属），曹操不在江陵 -> 无在任 -> null
    expect(governorOf(s, 'jiangling')).toBeNull()
  })

  it('captivesInCity 只返回本城俘虏（非俘虏/在野不计入）', () => {
    const s = createInitialState(1)
    expect(captivesInCity(s, 'xuchang')).toHaveLength(0) // 初始无俘虏
    // 许昌被刘备占 -> 城内曹操/荀彧/郭嘉成俘虏
    const conquered = setCityLord(s, 'xuchang', 'liubei')
    expect(
      captivesInCity(conquered, 'xuchang')
        .map((o) => o.id)
        .sort()
    ).toEqual(['caocao', 'guojia', 'xunyu'])
    // 在野武将（lordId=null）不算俘虏
    const wandering = {
      ...conquered,
      officers: {
        ...conquered.officers,
        ronin: {
          ...conquered.officers.caocao!,
          id: 'ronin',
          lordId: null,
          cityId: 'xuchang',
        },
      },
    }
    expect(captivesInCity(wandering, 'xuchang').map((o) => o.id)).not.toContain('ronin')
  })
})

/** 造一件归属某武将的道具（带装备序号/改兵种/加成）。 */
function equip(
  s: GameState,
  id: string,
  officerId: string,
  equipSeq: number,
  troopTypeOverride: 0 | 1 | 2 | 3,
  bonus?: { force?: number; intel?: number; movement?: number }
): GameState {
  return {
    ...s,
    items: {
      ...s.items,
      [id]: {
        id,
        name: id,
        forceBonus: bonus?.force ?? 0,
        intelBonus: bonus?.intel ?? 0,
        movementBonus: bonus?.movement ?? 0,
        troopTypeOverride,
        holder: { kind: 'officer', officerId, equipSeq } as const,
        discovered: true,
        recruiterId: null,
      },
    },
  }
}

describe('effectiveTroopType / officerMovement / itemsOfOfficer 排序', () => {
  it('无改兵种道具时 = 基础兵种', () => {
    const s = createInitialState(1) // 诸葛亮基础兵种 infantry
    expect(effectiveTroopType(s, 'zhugeliang')).toBe('infantry')
  })

  it('override=1 恒改水军（无门槛）', () => {
    const s = equip(createInitialState(1), 'oar', 'zhugeliang', 0, 1)
    expect(effectiveTroopType(s, 'zhugeliang')).toBe('navy')
  })

  it('override=2 玄兵：有效智力（含该道具自身加成）>105 才生效', () => {
    // 诸葛亮基础智力 100：+6 → 106 > 105 成玄兵；+5 → 105 不过维持基础
    const ok = equip(createInitialState(1), 'book', 'zhugeliang', 0, 2, { intel: 6 })
    expect(effectiveTroopType(ok, 'zhugeliang')).toBe('mystic')
    const no = equip(createInitialState(1), 'book', 'zhugeliang', 0, 2, { intel: 5 })
    expect(effectiveTroopType(no, 'zhugeliang')).toBe('infantry')
  })

  it('override=3 极兵：有效武力 >105 才生效', () => {
    // 诸葛亮基础武力 50：+60 → 110 成极兵；+55 → 105 不过
    const ok = equip(createInitialState(1), 'spear', 'zhugeliang', 0, 3, { force: 60 })
    expect(effectiveTroopType(ok, 'zhugeliang')).toBe('elite')
    const no = equip(createInitialState(1), 'spear', 'zhugeliang', 0, 3, { force: 55 })
    expect(effectiveTroopType(no, 'zhugeliang')).toBe('infantry')
  })

  it('派生回退：没收使智力跌破阈值的加成道具后，有效兵种回退', () => {
    // A(+10智、无改兵种, seq0) + B(改玄兵, seq1)：合计智力 110 > 105 → 玄兵
    let s = equip(createInitialState(1), 'A', 'zhugeliang', 0, 0, { intel: 10 })
    s = equip(s, 'B', 'zhugeliang', 1, 2)
    expect(effectiveTroopType(s, 'zhugeliang')).toBe('mystic')
    // 没收 A（移出）→ 智力回 100 ≤105 → B 不再生效 → 回退基础 infantry（Officer.troopType 未变）
    const { A: _removed, ...items } = s.items
    const reverted = { ...s, items }
    expect(effectiveTroopType(reverted, 'zhugeliang')).toBe('infantry')
    expect(reverted.officers.zhugeliang!.troopType).toBe('infantry')
  })

  it('顺序覆盖：后装备（equipSeq 大）的改兵种覆盖先装备', () => {
    // 智力足够使玄兵合法（+6 → 106）。water=override1, mystic=override2。
    const base = equip(createInitialState(1), 'm', 'zhugeliang', 0, 2, { intel: 6 })
    // m(seq0,玄), w(seq1,水) → 后者水军覆盖
    const wLast = equip(base, 'w', 'zhugeliang', 1, 1)
    expect(effectiveTroopType(wLast, 'zhugeliang')).toBe('navy')
    // m(seq2,玄), w(seq1,水) → 后者玄兵覆盖
    const mLast = equip(
      equip(createInitialState(1), 'w', 'zhugeliang', 1, 1),
      'm',
      'zhugeliang',
      2,
      2,
      { intel: 6 }
    )
    expect(effectiveTroopType(mLast, 'zhugeliang')).toBe('mystic')
  })

  it('itemsOfOfficer 按 equipSeq 升序返回', () => {
    let s = equip(createInitialState(1), 'late', 'zhugeliang', 5, 0)
    s = equip(s, 'early', 'zhugeliang', 1, 0)
    expect(itemsOfOfficer(s, 'zhugeliang').map((i) => i.id)).toEqual(['early', 'late'])
  })

  it('officerMovement = 有效兵种基础移动力 + 道具移动力加成之和', () => {
    // 诸葛亮 infantry(4)，无道具 → 4
    const s0 = createInitialState(1)
    expect(officerMovement(s0, 'zhugeliang')).toBe(4)
    // 装备改极兵(基础6) 且 movement+2 → 6+2=8
    const s1 = equip(s0, 'horse', 'zhugeliang', 0, 3, { force: 60, movement: 2 })
    expect(officerMovement(s1, 'zhugeliang')).toBe(8)
  })
})
