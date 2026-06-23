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
  const rotateIn5x5 = (p: { x: number; y: number }, quarterTurnsClockwise: number) => {
    const turns = ((quarterTurnsClockwise % 4) + 4) % 4
    let x = p.x
    let y = p.y
    for (let i = 0; i < turns; i++) {
      const nextX = 4 - y
      const nextY = x
      x = nextX
      y = nextY
    }
    return { x, y }
  }
  const sortByXY = (points: readonly { x: number; y: number }[]) =>
    [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const toOffsets = (spawns: readonly { x: number; y: number }[]) => {
    const anchor = { x: spawns[0]!.x - 2, y: spawns[0]!.y - 2 }
    return spawns.map((p) => ({ x: p.x - anchor.x, y: p.y - anchor.y }))
  }

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

  it('按统一阵形动态生成双方各 10 个出生点', () => {
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

  it('正交四方向由同一模板旋转得到', () => {
    const north = toOffsets(attackerSpawns(map, 'north'))
    const east = toOffsets(attackerSpawns(map, 'east'))
    const south = toOffsets(attackerSpawns(map, 'south'))
    const west = toOffsets(attackerSpawns(map, 'west'))
    expect(sortByXY(east)).toEqual(sortByXY(north.map((p) => rotateIn5x5(p, 1))))
    expect(sortByXY(south)).toEqual(sortByXY(north.map((p) => rotateIn5x5(p, 2))))
    expect(sortByXY(west)).toEqual(sortByXY(north.map((p) => rotateIn5x5(p, 3))))
  })

  it('对角四方向由同一模板旋转得到', () => {
    const northEast = toOffsets(attackerSpawns(map, 'northEast'))
    const southEast = toOffsets(attackerSpawns(map, 'southEast'))
    const southWest = toOffsets(attackerSpawns(map, 'southWest'))
    const northWest = toOffsets(attackerSpawns(map, 'northWest'))
    expect(sortByXY(southEast)).toEqual(sortByXY(northEast.map((p) => rotateIn5x5(p, 1))))
    expect(sortByXY(southWest)).toEqual(sortByXY(northEast.map((p) => rotateIn5x5(p, 2))))
    expect(sortByXY(northWest)).toEqual(sortByXY(northEast.map((p) => rotateIn5x5(p, 3))))
  })
})
