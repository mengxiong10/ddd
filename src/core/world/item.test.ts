import { describe, it, expect } from 'vitest'
import type { Item } from './item'
import { holdByOfficer, holdByCity, MAX_ITEMS_PER_OFFICER } from './item'

const base: Item = {
  id: 'sword',
  name: '青釭剑',
  forceBonus: 10,
  intelBonus: 0,
  movementBonus: 0,
  troopTypeOverride: 0,
  holder: { kind: 'city', cityId: 'c1' },
  discovered: true,
  recruiterId: null,
}

describe('item 聚合', () => {
  it('holdByOfficer 把归属改到武将，其余字段不变', () => {
    const next = holdByOfficer(base, 'o1')
    expect(next.holder).toEqual({ kind: 'officer', officerId: 'o1', equipSeq: 0 })
    expect({ ...next, holder: base.holder }).toEqual(base)
  })

  it('holdByCity 把归属改到城，其余字段不变', () => {
    const heldByOfficer: Item = {
      ...base,
      holder: { kind: 'officer', officerId: 'o1', equipSeq: 0 },
    }
    const next = holdByCity(heldByOfficer, 'c2')
    expect(next.holder).toEqual({ kind: 'city', cityId: 'c2' })
    expect({ ...next, holder: heldByOfficer.holder }).toEqual(heldByOfficer)
  })

  it('每名武将道具上限为 2', () => {
    expect(MAX_ITEMS_PER_OFFICER).toBe(2)
  })
})
