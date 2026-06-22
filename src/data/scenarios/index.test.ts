import { describe, expect, it } from 'vitest'
import period1 from './generated/period-1.json'
import period2 from './generated/period-2.json'
import period3 from './generated/period-3.json'
import period4 from './generated/period-4.json'
import cities from './generated/cities.json'
import officers from './generated/officers.json'
import items from './generated/items.json'
import adjacency from './generated/adjacency.json'
import battleMaps from './generated/battle-maps.json'
import { SCENARIOS, createScenarioState, lordsForScenario } from '.'
import { cityTile, terrainAt } from '../../core/military/battle-map'

const periods = [period1, period2, period3, period4]

describe('original scenario data', () => {
  it('generates shared catalogs and audited period counts', () => {
    expect(cities).toHaveLength(38)
    expect(officers).toHaveLength(295)
    expect(items).toHaveLength(37)
    expect(adjacency.length).toBeGreaterThan(0)
    expect(periods.map((period) => period.officers.length)).toEqual([187, 184, 189, 176])
    expect(
      periods.map((period) => period.officers.filter((o) => o.cityId !== null).length)
    ).toEqual([157, 175, 179, 166])
    expect(periods.map((period) => period.items.length)).toEqual([37, 33, 33, 33])
  })

  it('keeps original world positions and fixed battle-map ids in the shared city catalog', () => {
    expect(cities[0]).toEqual({ id: 1, name: '西凉', x: 1, y: 0, battleMapId: 7 })
    expect(cities[37]).toEqual({ id: 38, name: '建宁', x: 9, y: 7, battleMapId: 2 })
    expect(cities.every((city) => city.x >= 0 && city.x < 12)).toBe(true)
    expect(cities.every((city) => city.y >= 0 && city.y < 9)).toBe(true)
    expect(new Set(cities.map((city) => city.battleMapId))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]))
    expect(periods.every((period) => period.cities.every((city) => !('battleMapId' in city)))).toBe(
      true
    )
  })

  it('injects seven exact original terrain maps into scenario state', () => {
    expect(battleMaps).toHaveLength(7)
    const state = createScenarioState({ scenarioId: 'period-1', playerLordId: 1, seed: 1 })
    expect(Object.keys(state.battleMaps).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7])
    const first = state.battleMaps[1]!
    expect(first.tiles).toHaveLength(32 * 32)
    expect(cityTile(first)).toEqual({ x: 15, y: 15 })
    expect(terrainAt(first, { x: 1, y: 0 })).toBe('river')
    expect(terrainAt(first, { x: 5, y: 2 })).toBe('mountain')
    for (const map of Object.values(state.battleMaps)) {
      expect(map.tiles.filter((terrain) => terrain === 'city')).toHaveLength(1)
      expect(terrainAt(map, cityTile(map))).toBe('city')
    }
  })

  it('uses positive numeric ids and unique items in every period', () => {
    for (const period of periods) {
      for (const group of [period.cities, period.officers, period.items]) {
        const ids = group.map((entry) => entry.id)
        expect(ids.every((id) => Number.isInteger(id) && id > 0)).toBe(true)
        expect(new Set(ids).size).toBe(ids.length)
      }
    }
  })

  it('keeps stable officer identity and the audited duplicate-item winners', () => {
    const huatuo = officers.find((officer) => officer.name === '华佗')!
    const guanlu = officers.find((officer) => officer.name === '管辂')!
    const p4Jueying = period4.items.find((item) => item.id === 26)
    expect(p4Jueying?.holder).toEqual({ kind: 'officer', officerId: huatuo.id, equipSeq: 1 })
    expect(p4Jueying?.holder).not.toMatchObject({ officerId: guanlu.id })

    expect(period1.items.find((item) => item.id === 34)?.holder).toEqual({
      kind: 'city',
      cityId: 3,
    })
    expect(period1.items.find((item) => item.id === 37)?.holder).toEqual({
      kind: 'city',
      cityId: 4,
    })
    expect(period1.items.find((item) => item.id === 32)?.holder).toEqual({
      kind: 'city',
      cityId: 6,
    })
    expect(period1.items.find((item) => item.id === 33)?.holder).toEqual({
      kind: 'city',
      cityId: 7,
    })
    expect(period1.items.find((item) => item.id === 36)?.holder).toEqual({
      kind: 'city',
      cityId: 11,
    })
    expect(period1.items.find((item) => item.id === 35)?.holder).toEqual({
      kind: 'city',
      cityId: 14,
    })
  })

  it('normalizes known historical officer names', () => {
    const names = officers.map((officer) => officer.name)
    expect(names).toEqual(expect.arrayContaining(['荀彧', '李傕', '傅士仁', '张郃']))
    expect(names).not.toEqual(expect.arrayContaining(['荀或', '李决', '博士仁', '张合']))
    expect(
      officers.filter((officer) => ['荀彧', '李傕', '傅士仁', '张郃'].includes(officer.name))
    ).toEqual([
      { id: 33, name: '李傕' },
      { id: 139, name: '荀彧' },
      { id: 166, name: '张郃' },
      { id: 256, name: '傅士仁' },
    ])
  })

  it('keeps future officers and their equipment in the initial aggregate', () => {
    const state = createScenarioState({ scenarioId: 'period-4', playerLordId: 230, seed: 1 })
    const huatuo = Object.values(state.officers).find((officer) => officer.name === '华佗')!
    const guanlu = Object.values(state.officers).find((officer) => officer.name === '管辂')!
    expect(huatuo.cityId).toBeNull()
    expect(guanlu.cityId).toBeNull()
    expect(state.items[24]?.holder).toEqual({ kind: 'officer', officerId: huatuo.id, equipSeq: 0 })
    expect(state.items[26]?.holder).toEqual({ kind: 'officer', officerId: huatuo.id, equipSeq: 1 })
    expect(state.items[24]?.discovered).toBe(true)
  })
})

describe('scenario runtime', () => {
  it('lists the four scenarios and every current lord', () => {
    expect(SCENARIOS.map((scenario) => scenario.name)).toEqual([
      '董卓弄权',
      '曹操崛起',
      '赤壁之战',
      '三足鼎立',
    ])
    expect(SCENARIOS.map((scenario) => lordsForScenario(scenario.id).length)).toEqual([
      19, 16, 11, 5,
    ])
  })

  it('creates a deterministic state for the selected lord and seed', () => {
    const request = { scenarioId: 'period-1' as const, playerLordId: 1, seed: 42 }
    const first = createScenarioState(request)
    const second = createScenarioState(request)
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first.playerLordId).toBe(1)
    expect(Object.keys(first.cities)).toHaveLength(38)
    expect(first).not.toHaveProperty('pendingDebuts')
  })

  it('rejects an invalid lord and keeps static data independent of seed', () => {
    expect(() =>
      createScenarioState({ scenarioId: 'period-1', playerLordId: 9999, seed: 1 })
    ).toThrow(/invalid player lord/)
    const first = createScenarioState({ scenarioId: 'period-1', playerLordId: 1, seed: 1 })
    const second = createScenarioState({ scenarioId: 'period-1', playerLordId: 1, seed: 2 })
    expect({ ...first, rng: null }).toEqual({ ...second, rng: null })
    expect(first.rng).not.toEqual(second.rng)
  })

  it('creates a valid 38-city game for every current lord', () => {
    for (const scenario of SCENARIOS) {
      for (const lord of lordsForScenario(scenario.id)) {
        const state = createScenarioState({
          scenarioId: scenario.id,
          playerLordId: lord.id,
          seed: 7,
        })
        expect(Object.keys(state.cities)).toHaveLength(38)
        expect(state.officers[lord.id]?.lordId).toBe(lord.id)
      }
    }
  })
})
