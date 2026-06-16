import { describe, it, expect } from 'vitest'
import { createInitialState } from './fixture'
import { officersInCity, citiesOfLord, isCaptive } from './queries'
import { setBusy } from './officer'
import type { GameState } from '../game-state'

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
})
