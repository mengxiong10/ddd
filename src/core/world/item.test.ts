import { describe, it, expect } from 'vitest'
import type { Item } from './item'
import { holdByOfficer, holdByCity, MAX_ITEMS_PER_OFFICER } from './item'

const base: Item = {
  id: 1,
  name: '青釭剑',
  forceBonus: 10,
  intelBonus: 0,
  movementBonus: 0,
  troopTypeOverride: 0,
  holder: { kind: 'city', cityId: 1 },
  discovered: true,
  appearanceConditions: { birth: 0, recruiterId: null, cityId: null },
}

describe('item 聚合', () => {
  it('holdByOfficer 把归属改到武将，其余字段不变', () => {
    const next = holdByOfficer(base, 1)
    expect(next.holder).toEqual({ kind: 'officer', officerId: 1, equipSeq: 0 })
    expect({ ...next, holder: base.holder }).toEqual(base)
  })

  it('holdByCity 把归属改到城，其余字段不变', () => {
    const heldByOfficer: Item = {
      ...base,
      holder: { kind: 'officer', officerId: 1, equipSeq: 0 },
    }
    const next = holdByCity(heldByOfficer, 2)
    expect(next.holder).toEqual({ kind: 'city', cityId: 2 })
    expect({ ...next, holder: heldByOfficer.holder }).toEqual(heldByOfficer)
  })

  it('每名武将道具上限为 2', () => {
    expect(MAX_ITEMS_PER_OFFICER).toBe(2)
  })
})
