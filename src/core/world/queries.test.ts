import { describe, it, expect } from 'vitest'
import { createInitialState } from './fixture'
import { officersInCity, citiesOfLord } from './queries'
import { setBusy } from './officer'

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
})
