import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import {
  DEFAULT_MAP_ID,
  GRID_SIZE,
  MAX_MOVEMENT,
  MAX_DAYS,
  MOVE_COST,
  REDUCTION_TIER,
  DEFENSE_COEF_PCT,
  inBounds,
  terrainAt,
  isCityTile,
} from './battle-map'

describe('battle-map 常量', () => {
  it('棋盘 32×32、移动力上限 8、日上限 30', () => {
    expect(GRID_SIZE).toBe(32)
    expect(MAX_MOVEMENT).toBe(8)
    expect(MAX_DAYS).toBe(30)
  })

  it('移动消耗：骑兵河流 3、水军河流 1、步兵森林 1', () => {
    expect(MOVE_COST.cavalry.river).toBe(3)
    expect(MOVE_COST.navy.river).toBe(1)
    expect(MOVE_COST.infantry.forest).toBe(1)
  })

  it('折减档：骑兵河流极重(3)、水军山地极重(3)、步兵平原无(0)', () => {
    expect(REDUCTION_TIER.cavalry.river).toBe(3)
    expect(REDUCTION_TIER.navy.mountain).toBe(3)
    expect(REDUCTION_TIER.infantry.plain).toBe(0)
  })

  it('地形防御系数：城池 150、河流 80、山地 130', () => {
    expect(DEFENSE_COEF_PCT.city).toBe(150)
    expect(DEFENSE_COEF_PCT.river).toBe(80)
    expect(DEFENSE_COEF_PCT.mountain).toBe(130)
  })
})

describe('battle-map 读取助手', () => {
  const map = createInitialState(1).battleMaps[DEFAULT_MAP_ID]!

  it('inBounds 边界正确', () => {
    expect(inBounds(map, { x: 0, y: 0 })).toBe(true)
    expect(inBounds(map, { x: 31, y: 31 })).toBe(true)
    expect(inBounds(map, { x: 32, y: 0 })).toBe(false)
    expect(inBounds(map, { x: -1, y: 5 })).toBe(false)
  })

  it('城池格 = 胜负点、isCityTile 命中', () => {
    expect(map.cityTiles.length).toBeGreaterThanOrEqual(1)
    const c = map.cityTiles[0]!
    expect(isCityTile(map, c)).toBe(true)
    expect(terrainAt(map, c)).toBe('city')
    expect(isCityTile(map, { x: 0, y: 0 })).toBe(false)
  })

  it('双方出生点各 ≥10、互不越界', () => {
    expect(map.attackerSpawns.length).toBeGreaterThanOrEqual(10)
    expect(map.defenderSpawns.length).toBeGreaterThanOrEqual(10)
    for (const p of [...map.attackerSpawns, ...map.defenderSpawns]) {
      expect(inBounds(map, p)).toBe(true)
    }
  })
})
