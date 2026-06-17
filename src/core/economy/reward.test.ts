import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { canReward, reward, canConfiscate, confiscate } from './reward'
import { holdByOfficer } from '../world/item'
import { itemsOfOfficer, itemsInCity, officerLoyalty } from '../world/queries'

function withOfficer(s: GameState, id: string, patch: Partial<GameState['officers'][string]>): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
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
    s = { ...s, items: {
      ...s.items,
      a: { id: 'a', name: 'A', forceBonus: 1, intelBonus: 0, holder: { kind: 'officer', officerId: 'zhugeliang' } },
      b: { id: 'b', name: 'B', forceBonus: 1, intelBonus: 0, holder: { kind: 'officer', officerId: 'zhugeliang' } },
    } }
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
})

describe('reward 赏赐', () => {
  it('道具转给武将、非君主忠诚 +8、不占人、即时、不耗 RNG', () => {
    const s = createInitialState(1)
    const next = reward(s, 'zhugeliang', 'cixiongshuanggujian')
    expect(itemsOfOfficer(next, 'zhugeliang').map((i) => i.id)).toEqual(['cixiongshuanggujian'])
    expect(itemsInCity(next, 'chengdu')).toHaveLength(0)
    expect(next.officers.zhugeliang!.loyalty).toBe(58)
    expect(next.officers.zhugeliang!.busy).toBe(false)
    expect(next.pendingCommands).toEqual(s.pendingCommands)
    expect(next.rng.seed).toBe(s.rng.seed)
  })
  it('忠诚封顶 100', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { loyalty: 95 })
    expect(reward(s, 'zhugeliang', 'cixiongshuanggujian').officers.zhugeliang!.loyalty).toBe(100)
  })
  it('赏赐给君主：道具照常转移、忠诚仍派生 100', () => {
    const s = createInitialState(1)
    const next = reward(s, 'liubei', 'cixiongshuanggujian')
    expect(itemsOfOfficer(next, 'liubei')).toHaveLength(1)
    expect(officerLoyalty(next, 'liubei')).toBe(100)
  })
  it('busy 武将仍可被赏赐（不校验 busy）', () => {
    const s = withOfficer(createInitialState(1), 'zhugeliang', { busy: true })
    expect(reward(s, 'zhugeliang', 'cixiongshuanggujian').officers.zhugeliang!.loyalty).toBe(58)
  })
  it('非法 no-op（返回原状态）', () => {
    const s = createInitialState(1)
    expect(reward(s, 'zhugeliang', 'mengde-xinshu')).toBe(s)
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
    const s = withOfficer(giveItem(createInitialState(1), 'cixiongshuanggujian', 'zhugeliang'), 'zhugeliang', { loyalty: 50 })
    const next = confiscate(s, 'zhugeliang', 'cixiongshuanggujian')
    expect(itemsInCity(next, 'chengdu').map((i) => i.id)).toEqual(['cixiongshuanggujian'])
    expect(itemsOfOfficer(next, 'zhugeliang')).toHaveLength(0)
    expect(next.officers.zhugeliang!.loyalty).toBe(30)
    expect(next.officers.zhugeliang!.busy).toBe(false)
  })
  it('忠诚下限 0', () => {
    const s = withOfficer(giveItem(createInitialState(1), 'cixiongshuanggujian', 'zhugeliang'), 'zhugeliang', { loyalty: 10 })
    expect(confiscate(s, 'zhugeliang', 'cixiongshuanggujian').officers.zhugeliang!.loyalty).toBe(0)
  })
  it('没收君主道具：照常收回、忠诚派生仍 100', () => {
    const s = giveItem(createInitialState(1), 'cixiongshuanggujian', 'liubei')
    const next = confiscate(s, 'liubei', 'cixiongshuanggujian')
    expect(itemsInCity(next, 'chengdu')).toHaveLength(1)
    expect(officerLoyalty(next, 'liubei')).toBe(100)
  })
  it('非法 no-op（返回原状态）', () => {
    const s = createInitialState(1)
    expect(confiscate(s, 'zhugeliang', 'cixiongshuanggujian')).toBe(s)
  })
})
