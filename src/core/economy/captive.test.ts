import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { canBehead, behead, canBanish, banish } from './captive'
import { itemsOfOfficer, itemsInCity } from '../world/queries'
import { holdByOfficer } from '../world/item'

function withOfficer(s: GameState, id: string, patch: Partial<GameState['officers'][string]>): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}
function setCityLord(s: GameState, cityId: string, lordId: string): GameState {
  return { ...s, cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId } } }
}
function giveItem(s: GameState, itemId: string, officerId: string): GameState {
  return { ...s, items: { ...s.items, [itemId]: holdByOfficer(s.items[itemId]!, officerId) } }
}
/** 许昌被刘备占（曹操/荀彧/郭嘉成俘虏）。 */
function conquered(seed: number): GameState {
  return setCityLord(createInitialState(seed), 'xuchang', 'liubei')
}

describe('处斩 behead', () => {
  it('canBehead：俘虏可斩、非俘虏拒绝', () => {
    const s = conquered(1)
    expect(canBehead(s, 'caocao').ok).toBe(true)
    expect(canBehead(createInitialState(1), 'caocao').ok).toBe(false) // 未被俘
  })

  it('处斩：删除武将、其道具退回本城并标记已发现', () => {
    let s = conquered(1)
    s = giveItem(s, 'mengde-xinshu', 'caocao') // 孟德新书原在许昌城，先给曹操
    const next = behead(s, 'caocao')
    expect(next.officers.caocao).toBeUndefined() // 永久删除
    expect(itemsOfOfficer(next, 'caocao')).toHaveLength(0)
    const item = next.items['mengde-xinshu']!
    expect(item.holder).toEqual({ kind: 'city', cityId: 'xuchang' })
    expect(item.discovered).toBe(true)
    expect(itemsInCity(next, 'xuchang').map((i) => i.id)).toContain('mengde-xinshu')
  })

  it('处斩非俘虏 -> no-op', () => {
    const s = createInitialState(1)
    expect(behead(s, 'caocao')).toBe(s)
  })
})

describe('流放 banish', () => {
  it('canBanish：俘虏可、己方在任武将可、在任君主不可、在野不可、占用不可', () => {
    const s = conquered(1)
    expect(canBanish(s, 'caocao').ok).toBe(true) // 被俘君主可流放
    expect(canBanish(s, 'guanyu').ok).toBe(true) // 己方在任武将
    expect(canBanish(s, 'liubei').ok).toBe(false) // 在任君主
    expect(canBanish(withOfficer(s, 'guanyu', { lordId: null }), 'guanyu').ok).toBe(false) // 在野
    expect(canBanish(withOfficer(s, 'guanyu', { busy: true }), 'guanyu').ok).toBe(false) // 占用
  })

  it('流放俘虏：变在野、随机落到某城、消耗 RNG', () => {
    const s = conquered(1)
    const next = banish(s, 'caocao')
    expect(next.officers.caocao!.lordId).toBeNull()
    expect(next.cities[next.officers.caocao!.cityId]).toBeDefined()
    expect(next.rng).not.toEqual(s.rng)
  })

  it('流放保留所持道具（holder 仍指向其本人，不退城）', () => {
    let s = conquered(1)
    s = giveItem(s, 'mengde-xinshu', 'caocao')
    const next = banish(s, 'caocao')
    expect(next.items['mengde-xinshu']!.holder).toEqual({ kind: 'officer', officerId: 'caocao' })
    expect(itemsOfOfficer(next, 'caocao').map((i) => i.id)).toContain('mengde-xinshu')
  })

  it('流放己方在任武将：变在野', () => {
    const s = conquered(1)
    const next = banish(s, 'guanyu')
    expect(next.officers.guanyu!.lordId).toBeNull()
  })

  it('流放在任君主 -> no-op', () => {
    const s = conquered(1)
    expect(banish(s, 'liubei')).toBe(s)
  })
})
