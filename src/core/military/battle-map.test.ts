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
  cityTile,
  attackDirection,
  attackerSpawns,
  defenderSpawns,
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
    const c = cityTile(map)
    expect(isCityTile(map, c)).toBe(true)
    expect(terrainAt(map, c)).toBe('city')
    expect(isCityTile(map, { x: 0, y: 0 })).toBe(false)
  })

  it('由出发城相对目标城的位置派生八方向', () => {
    const target = { x: 5, y: 5 }
    expect(attackDirection({ x: 5, y: 4 }, target)).toBe('north')
    expect(attackDirection({ x: 6, y: 4 }, target)).toBe('northEast')
    expect(attackDirection({ x: 6, y: 5 }, target)).toBe('east')
    expect(attackDirection({ x: 6, y: 6 }, target)).toBe('southEast')
    expect(attackDirection({ x: 5, y: 6 }, target)).toBe('south')
    expect(attackDirection({ x: 4, y: 6 }, target)).toBe('southWest')
    expect(attackDirection({ x: 4, y: 5 }, target)).toBe('west')
    expect(attackDirection({ x: 4, y: 4 }, target)).toBe('northWest')
    // 原版长安(5,2)→宛城(6,4)在 CITY_LINKR 中归正南，不归东南。
    expect(attackDirection({ x: 6, y: 4 }, { x: 5, y: 2 })).toBe('south')
  })

  it('按原版方向阵形动态生成双方各 10 个出生点', () => {
    const attackers = attackerSpawns(map, 'north')
    const defenders = defenderSpawns(map)
    expect(attackers).toHaveLength(10)
    expect(defenders).toHaveLength(10)
    expect(attackers.slice(0, 5)).toEqual([
      { x: 16, y: 2 },
      { x: 16, y: 3 },
      { x: 15, y: 2 },
      { x: 17, y: 2 },
      { x: 16, y: 1 },
    ])
    expect(defenders[0]).toEqual(cityTile(map))
    for (const p of [...attackers, ...defenders]) {
      expect(inBounds(map, p)).toBe(true)
    }
  })
})
