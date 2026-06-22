import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { canBehead, behead, canBanish, banish } from './captive'
import { itemsOfOfficer, itemsInCity } from '../world/queries'
import { holdByOfficer } from '../world/item'

function withOfficer(
  s: GameState,
  id: number,
  patch: Partial<GameState['officers'][number]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}
function setCityLord(s: GameState, cityId: number, lordId: number): GameState {
  return { ...s, cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId } } }
}
/** 占用某武将（占用为派生：入队一条引用该武将的命令）。 */
function occupy(s: GameState, id: number): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, { type: 'develop', officerId: id }] }
}
function giveItem(s: GameState, itemId: number, officerId: number): GameState {
  return { ...s, items: { ...s.items, [itemId]: holdByOfficer(s.items[itemId]!, officerId) } }
}
/** 许昌被刘备占（曹操/荀彧/郭嘉成俘虏）。 */
function conquered(seed: number): GameState {
  return setCityLord(createInitialState(seed), 3, 1)
}

describe('处斩 behead', () => {
  it('canBehead：俘虏可斩、非俘虏拒绝', () => {
    const s = conquered(1)
    expect(canBehead(s, 6).ok).toBe(true)
    expect(canBehead(createInitialState(1), 6).ok).toBe(false) // 未被俘
  })

  it('处斩：删除武将、其道具退回本城并标记已发现', () => {
    let s = conquered(1)
    s = giveItem(s, 2, 6) // 孟德新书原在许昌城，先给曹操
    const next = behead(s, 6).state
    expect(next.officers[6]).toBeUndefined() // 永久删除
    expect(itemsOfOfficer(next, 6)).toHaveLength(0)
    const item = next.items[2]!
    expect(item.holder).toEqual({ kind: 'city', cityId: 3 })
    expect(item.discovered).toBe(true)
    expect(itemsInCity(next, 3).map((i) => i.id)).toContain(2)
  })

  it('处斩非俘虏 -> no-op（state 不变、自报告失败 reason）', () => {
    const s = createInitialState(1)
    const res = behead(s, 6)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('target-not-captive')
  })
})

describe('流放 banish', () => {
  it('canBanish：俘虏可、己方在任武将可、在任君主不可、在野不可、占用不可', () => {
    const s = conquered(1)
    expect(canBanish(s, 6).ok).toBe(true) // 被俘君主可流放
    expect(canBanish(s, 4).ok).toBe(true) // 己方在任武将
    expect(canBanish(s, 1).ok).toBe(false) // 在任君主
    expect(canBanish(withOfficer(s, 4, { lordId: null }), 4).ok).toBe(false) // 在野
    expect(canBanish(occupy(s, 4), 4).ok).toBe(false) // 占用
  })

  it('流放俘虏：变在野、随机落到某城、消耗 RNG', () => {
    const s = conquered(1)
    const next = banish(s, 6).state
    expect(next.officers[6]!.lordId).toBeNull()
    expect(next.cities[next.officers[6]!.cityId!]).toBeDefined()
    expect(next.rng).not.toEqual(s.rng)
  })

  it('流放保留所持道具（holder 仍指向其本人，不退城）', () => {
    let s = conquered(1)
    s = giveItem(s, 2, 6)
    const next = banish(s, 6).state
    expect(next.items[2]!.holder).toEqual({
      kind: 'officer',
      officerId: 6,
      equipSeq: 0,
    })
    expect(itemsOfOfficer(next, 6).map((i) => i.id)).toContain(2)
  })

  it('流放己方在任武将：变在野', () => {
    const s = conquered(1)
    const next = banish(s, 4).state
    expect(next.officers[4]!.lordId).toBeNull()
  })

  it('流放在任君主 -> no-op（state 不变、自报告失败 reason）', () => {
    const s = conquered(1)
    const res = banish(s, 1)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('cannot-banish-active-lord')
  })
})
