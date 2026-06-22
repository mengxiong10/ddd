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
  defendingOfficers,
  isBusy,
} from './queries'
import { holdByOfficer } from './item'
import type { GameState } from '../game-state'

/** 把某道具归属改给某武将。 */
function giveItem(s: GameState, itemId: number, officerId: number): GameState {
  return { ...s, items: { ...s.items, [itemId]: holdByOfficer(s.items[itemId]!, officerId) } }
}

/** 占用某武将（占用为派生：入队一条引用该武将的命令）。 */
function occupy(s: GameState, id: number): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, { type: 'develop', officerId: id }] }
}

/** 把某城归属改给另一君主（用于制造俘虏：城内原武将 lordId 不变 -> 成俘虏）。 */
function setCityLord(s: GameState, cityId: number, lordId: number): GameState {
  return { ...s, cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId } } }
}

describe('world queries（基于初始 fixture）', () => {
  it('初始局面规模正确', () => {
    const s = createInitialState(1)
    expect(Object.keys(s.cities)).toHaveLength(4)
    expect(Object.keys(s.officers)).toHaveLength(12)
    expect(s.playerLordId).toBe(1)
    expect(s.month).toBe(1)
  })

  it('citiesOfLord 返回该君主的城', () => {
    const s = createInitialState(1)
    expect(
      citiesOfLord(s, 1)
        .map((c) => c.id)
        .sort()
    ).toEqual([1, 2])
    expect(citiesOfLord(s, 6)).toHaveLength(2)
  })

  it('officersInCity 返回驻城武将', () => {
    const s = createInitialState(1)
    expect(officersInCity(s, 1)).toHaveLength(3)
  })

  it('onlyAvailable 排除已占用武将', () => {
    const s = createInitialState(1)
    const busy = occupy(s, 2)
    expect(isBusy(busy, 2)).toBe(true)
    expect(officersInCity(busy, 1, { onlyAvailable: true })).toHaveLength(2)
    expect(officersInCity(busy, 1)).toHaveLength(3)
  })

  it('isCaptive：武将归属 ≠ 所在城归属即俘虏', () => {
    const s = createInitialState(1)
    expect(isCaptive(s, 4)).toBe(false) // 关羽在江陵，同归刘备
    const captured = setCityLord(s, 2, 6) // 江陵被曹操占，关羽就地成俘虏
    expect(isCaptive(captured, 4)).toBe(true)
    expect(isCaptive(captured, 6)).toBe(false)
  })

  it('onlyAvailable 排除俘虏', () => {
    const s = setCityLord(createInitialState(1), 2, 6)
    // 江陵原有关羽、张飞两将，均成俘虏 -> 在任为 0
    expect(officersInCity(s, 2)).toHaveLength(2)
    expect(officersInCity(s, 2, { onlyAvailable: true })).toHaveLength(0)
  })

  it('itemsInCity / itemsOfOfficer 按 holder 派生，同一道具只出现在一处', () => {
    const s = createInitialState(1)
    expect(itemsInCity(s, 1).map((i) => i.id)).toEqual([1])
    expect(itemsOfOfficer(s, 4)).toHaveLength(0)

    const s2 = giveItem(s, 1, 4)
    expect(itemsInCity(s2, 1)).toHaveLength(0)
    expect(itemsOfOfficer(s2, 4).map((i) => i.id)).toEqual([1])
  })

  it('effectiveOfficer：force/intel 叠加所持道具加成，其余字段不变', () => {
    const s = createInitialState(1)
    const guanyu = s.officers[4]!
    expect(effectiveOfficer(s, 4)).toEqual(guanyu) // 无道具时原样

    const s2 = giveItem(s, 1, 4) // 武力+10
    const eff = effectiveOfficer(s2, 4)
    expect(eff.force).toBe(guanyu.force + 10)
    expect(eff.intelligence).toBe(guanyu.intelligence)
    expect({ ...eff, force: guanyu.force }).toEqual(guanyu) // 仅 force 变
  })

  it('officerLoyalty：君主恒 100（即使存储值非 100），非君主取存储值', () => {
    const s = createInitialState(1)
    expect(officerLoyalty(s, 2)).toBe(50)
    // 刻意把君主存储值改脏，仍应派生 100
    const dirty = {
      ...s,
      officers: { ...s.officers, 1: { ...s.officers[1]!, loyalty: 13 } },
    }
    expect(officerLoyalty(dirty, 1)).toBe(100)
  })
})

/** 在成都放一名在野武将（lordId=null）。 */
function withWanderer(s: GameState, id: number, cityId: number): GameState {
  const o = { ...s.officers[2]!, id, name: String(id), lordId: null, cityId }
  return { ...s, officers: { ...s.officers, [id]: o } }
}

describe('在野/未发现（登场与搜寻）', () => {
  it('isCaptive：无主武将（lordId=null）不是俘虏', () => {
    const s = withWanderer(createInitialState(1), 100, 1)
    expect(isCaptive(s, 100)).toBe(false)
  })

  it('officersInCity：在野武将算驻城但不算在任', () => {
    const s = withWanderer(createInitialState(1), 100, 1)
    expect(officersInCity(s, 1)).toHaveLength(4) // 含在野
    expect(officersInCity(s, 1, { onlyAvailable: true })).toHaveLength(3) // 排除在野
  })

  it('wanderingOfficersInCity：仅本城在野武将', () => {
    const s = withWanderer(createInitialState(1), 100, 1)
    expect(wanderingOfficersInCity(s, 1).map((o) => o.id)).toEqual([100])
    expect(wanderingOfficersInCity(s, 2)).toHaveLength(0)
  })

  it('undiscoveredItemsInCity：仅本城未发现道具', () => {
    const s = createInitialState(1)
    // 既有道具 discovered=true，不计入
    expect(undiscoveredItemsInCity(s, 1)).toHaveLength(0)
    const hidden = {
      ...s,
      items: {
        ...s.items,
        100: {
          id: 100,
          name: '隐宝',
          forceBonus: 1,
          intelBonus: 0,
          movementBonus: 0,
          troopTypeOverride: 0 as const,
          holder: { kind: 'city', cityId: 1 } as const,
          discovered: false,
          appearanceConditions: { birth: 0, recruiterId: null, cityId: null },
        },
      },
    }
    expect(undiscoveredItemsInCity(hidden, 1).map((i) => i.id)).toEqual([100])
    expect(
      itemsInCity(hidden, 1)
        .map((i) => i.id)
        .sort((a, b) => a - b)
    ).toEqual([1, 100])
  })

  it('governorOf：君主驻城则太守=君主（即便他人智力更高）', () => {
    const s = createInitialState(1)
    // 成都驻刘备(君主,75)、诸葛亮(100)、庞统(90)：太守=刘备
    expect(governorOf(s, 1)!.id).toBe(1)
  })

  it('governorOf：君主不在城则取在任最高有效智力者', () => {
    const s = createInitialState(1)
    // 江陵无君主：关羽(75) > 张飞(60) -> 太守=关羽
    expect(governorOf(s, 2)!.id).toBe(4)
  })

  it('governorOf：有效智力含道具加成', () => {
    const s = createInitialState(1)
    const boosted: GameState = {
      ...s,
      items: {
        ...s.items,
        100: {
          id: 100,
          name: '智珠',
          forceBonus: 0,
          intelBonus: 20,
          movementBonus: 0,
          troopTypeOverride: 0,
          holder: { kind: 'officer', officerId: 5, equipSeq: 0 } as const,
          discovered: true,
          appearanceConditions: { birth: 0, recruiterId: null, cityId: null },
        },
      },
    }
    // 张飞 60+20=80 > 关羽 75 -> 太守=张飞
    expect(governorOf(boosted, 2)!.id).toBe(5)
  })

  it('governorOf：平局取 id 字典序最小', () => {
    const s = createInitialState(1)
    const tied = {
      ...s,
      officers: { ...s.officers, 5: { ...s.officers[5]!, intelligence: 75 } },
    }
    // 关羽/张飞均 75 -> 4 < 5
    expect(governorOf(tied, 2)!.id).toBe(4)
  })

  it('governorOf：空城/仅俘虏返回 null', () => {
    const s = setCityLord(createInitialState(1), 2, 6)
    // 江陵被曹操占，关羽/张飞成俘虏（lordId≠城归属），曹操不在江陵 -> 无在任 -> null
    expect(governorOf(s, 2)).toBeNull()
  })

  it('空城即使有在野武将也没有太守或守军', () => {
    const base = withWanderer(createInitialState(1), 100, 2)
    const unowned: GameState = {
      ...base,
      cities: {
        ...base.cities,
        2: { ...base.cities[2]!, lordId: null },
      },
    }
    expect(governorOf(unowned, 2)).toBeNull()
    expect(defendingOfficers(unowned, 2)).toEqual([])
    expect(isCaptive(unowned, 100)).toBe(false)
  })

  it('captivesInCity 只返回本城俘虏（非俘虏/在野不计入）', () => {
    const s = createInitialState(1)
    expect(captivesInCity(s, 3)).toHaveLength(0) // 初始无俘虏
    // 许昌被刘备占 -> 城内曹操/荀彧/郭嘉成俘虏
    const conquered = setCityLord(s, 3, 1)
    expect(
      captivesInCity(conquered, 3)
        .map((o) => o.id)
        .sort((a, b) => a - b)
    ).toEqual([6, 7, 8])
    // 在野武将（lordId=null）不算俘虏
    const wandering = {
      ...conquered,
      officers: {
        ...conquered.officers,
        101: {
          ...conquered.officers[6]!,
          id: 101,
          lordId: null,
          cityId: 3,
        },
      },
    }
    expect(captivesInCity(wandering, 3).map((o) => o.id)).not.toContain(101)
  })
})

/** 造一件归属某武将的道具（带装备序号/改兵种/加成）。 */
function equip(
  s: GameState,
  id: number,
  officerId: number,
  equipSeq: number,
  troopTypeOverride: 0 | 1 | 2 | 3 | 4 | 5 | 6,
  bonus?: { force?: number; intel?: number; movement?: number }
): GameState {
  return {
    ...s,
    items: {
      ...s.items,
      [id]: {
        id,
        name: String(id),
        forceBonus: bonus?.force ?? 0,
        intelBonus: bonus?.intel ?? 0,
        movementBonus: bonus?.movement ?? 0,
        troopTypeOverride,
        holder: { kind: 'officer', officerId, equipSeq } as const,
        discovered: true,
        appearanceConditions: { birth: 0, recruiterId: null, cityId: null },
      },
    },
  }
}

describe('effectiveTroopType / officerMovement / itemsOfOfficer 排序', () => {
  it('无改兵种道具时 = 基础兵种', () => {
    const s = createInitialState(1) // 诸葛亮基础兵种 infantry
    expect(effectiveTroopType(s, 2)).toBe('infantry')
  })

  it('override=1 恒改水军（无门槛）', () => {
    const s = equip(createInitialState(1), 100, 2, 0, 1)
    expect(effectiveTroopType(s, 2)).toBe('navy')
  })

  it('override=2 玄兵：有效智力（含该道具自身加成）>105 才生效', () => {
    // 诸葛亮基础智力 100：+6 → 106 > 105 成玄兵；+5 → 105 不过维持基础
    const ok = equip(createInitialState(1), 101, 2, 0, 2, { intel: 6 })
    expect(effectiveTroopType(ok, 2)).toBe('mystic')
    const no = equip(createInitialState(1), 101, 2, 0, 2, { intel: 5 })
    expect(effectiveTroopType(no, 2)).toBe('infantry')
  })

  it('override=3 极兵：有效武力 >105 才生效', () => {
    // 诸葛亮基础武力 50：+60 → 110 成极兵；+55 → 105 不过
    const ok = equip(createInitialState(1), 102, 2, 0, 3, { force: 60 })
    expect(effectiveTroopType(ok, 2)).toBe('elite')
    const no = equip(createInitialState(1), 102, 2, 0, 3, { force: 55 })
    expect(effectiveTroopType(no, 2)).toBe('infantry')
  })

  it('派生回退：没收使智力跌破阈值的加成道具后，有效兵种回退', () => {
    // A(+10智、无改兵种, seq0) + B(改玄兵, seq1)：合计智力 110 > 105 → 玄兵
    let s = equip(createInitialState(1), 103, 2, 0, 0, { intel: 10 })
    s = equip(s, 104, 2, 1, 2)
    expect(effectiveTroopType(s, 2)).toBe('mystic')
    // 没收 A（移出）→ 智力回 100 ≤105 → B 不再生效 → 回退基础 infantry（Officer.troopType 未变）
    const { 103: _removed, ...items } = s.items
    const reverted = { ...s, items }
    expect(effectiveTroopType(reverted, 2)).toBe('infantry')
    expect(reverted.officers[2]!.troopType).toBe('infantry')
  })

  it('顺序覆盖：后装备（equipSeq 大）的改兵种覆盖先装备', () => {
    // 智力足够使玄兵合法（+6 → 106）。water=override1, mystic=override2。
    const base = equip(createInitialState(1), 105, 2, 0, 2, { intel: 6 })
    // m(seq0,玄), w(seq1,水) → 后者水军覆盖
    const wLast = equip(base, 106, 2, 1, 1)
    expect(effectiveTroopType(wLast, 2)).toBe('navy')
    // m(seq2,玄), w(seq1,水) → 后者玄兵覆盖
    const mLast = equip(equip(createInitialState(1), 106, 2, 1, 1), 105, 2, 2, 2, { intel: 6 })
    expect(effectiveTroopType(mLast, 2)).toBe('mystic')
  })

  it('itemsOfOfficer 按 equipSeq 升序返回', () => {
    let s = equip(createInitialState(1), 107, 2, 5, 0)
    s = equip(s, 108, 2, 1, 0)
    expect(itemsOfOfficer(s, 2).map((i) => i.id)).toEqual([108, 107])
  })

  it('officerMovement = 有效兵种基础移动力 + 道具移动力加成之和', () => {
    // 诸葛亮 infantry(4)，无道具 → 4
    const s0 = createInitialState(1)
    expect(officerMovement(s0, 2)).toBe(4)
    // 装备改极兵(基础6) 且 movement+2 → 6+2=8
    const s1 = equip(s0, 109, 2, 0, 3, { force: 60, movement: 2 })
    expect(officerMovement(s1, 2)).toBe(8)
  })
})

describe('defendingOfficers（守军：在城·本势力·非俘虏·未被占用 isBusy）', () => {
  it('返回本城属本势力且未被占用的武将；被占用者排除', () => {
    let s = createInitialState(1)
    expect(
      defendingOfficers(s, 2)
        .map((o) => o.id)
        .sort()
    ).toEqual([4, 5])
    // 占用关羽（入队引用其的命令）→ 守军排除之
    s = occupy(s, 4)
    expect(defendingOfficers(s, 2).map((o) => o.id)).toEqual([5])
  })

  it('排除俘虏与外势力武将', () => {
    // 江陵改归曹操 → 原刘备武将就地成俘虏 → 守军空
    const s = setCityLord(createInitialState(1), 2, 6)
    expect(defendingOfficers(s, 2)).toEqual([])
  })

  it('排除被待执行 campaign 征调（外出出征）的武将', () => {
    const base = createInitialState(1)
    const s: GameState = {
      ...base,
      pendingCommands: [{ type: 'campaign', officerIds: [4], targetCityId: 3, provisions: 10 }],
    }
    expect(defendingOfficers(s, 2).map((o) => o.id)).toEqual([5])
  })
})
