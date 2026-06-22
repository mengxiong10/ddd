import type { Position } from '../shared/position'
import { samePos } from '../shared/position'
import type { BattleMapId } from '../shared/ids'
import type { TroopType } from '../world/troop-type'

/** 8 种战斗地形。 */
export type Terrain =
  | 'grass'
  | 'plain'
  | 'mountain'
  | 'forest'
  | 'village'
  | 'city'
  | 'camp'
  | 'river'

export type MapId = BattleMapId

/** 棋盘边长（规则身份，与总纲一致）。 */
export const GRID_SIZE = 32
/** 移动力上限（量纲上限，规则身份）。 */
export const MAX_MOVEMENT = 8
/** 日循环上限（规则身份）。 */
export const MAX_DAYS = 30

/**
 * 战斗地图（领域数据，静态模板）：行主序地形数组 + 城池格（胜负点）+ 双方出生点。
 * tiles.length === width*height；以 (y*width + x) 索引。
 */
export interface BattleMap {
  readonly id: MapId
  readonly width: number
  readonly height: number
  readonly tiles: readonly Terrain[]
  readonly cityTiles: readonly Position[]
  readonly attackerSpawns: readonly Position[]
  readonly defenderSpawns: readonly Position[]
}

/** data 层注入 core 前使用的纯地形形状。 */
export interface BattleMapData {
  readonly id: BattleMapId
  readonly width: number
  readonly height: number
  readonly tiles: readonly Terrain[]
}

export type BattleMapCatalog = Readonly<Record<BattleMapId, BattleMap>>

/**
 * 地形移动消耗 [兵种][地形]（§6.5.2，规则身份内联常量）。
 * 进入一格扣对应消耗；出生格不扣（路径不含起点）。
 */
export const MOVE_COST: Record<TroopType, Record<Terrain, number>> = {
  cavalry: { plain: 1, grass: 1, city: 2, village: 2, forest: 3, mountain: 3, river: 3, camp: 2 },
  infantry: { plain: 1, grass: 1, city: 2, village: 2, forest: 1, mountain: 1, river: 3, camp: 2 },
  archer: { plain: 1, grass: 1, city: 2, village: 2, forest: 1, mountain: 1, river: 3, camp: 2 },
  navy: { plain: 2, grass: 2, city: 2, village: 2, forest: 3, mountain: 3, river: 1, camp: 2 },
  elite: { plain: 1, grass: 1, city: 2, village: 2, forest: 3, mountain: 2, river: 3, camp: 2 },
  mystic: { plain: 1, grass: 1, city: 2, village: 2, forest: 1, mountain: 1, river: 3, camp: 2 },
}

/**
 * 地形战力折减档 [兵种][地形]（§6.5.3，规则身份内联常量）。
 * 值 0/1/2/3 对应除以 1/2/4/8（无/中/重/极重）。
 */
export const REDUCTION_TIER: Record<TroopType, Record<Terrain, number>> = {
  cavalry: { grass: 0, plain: 0, mountain: 2, forest: 1, village: 0, city: 0, camp: 0, river: 3 },
  infantry: { grass: 0, plain: 0, mountain: 0, forest: 0, village: 0, city: 0, camp: 0, river: 2 },
  archer: { grass: 0, plain: 0, mountain: 0, forest: 0, village: 0, city: 0, camp: 0, river: 2 },
  navy: { grass: 1, plain: 1, mountain: 3, forest: 2, village: 0, city: 0, camp: 0, river: 0 },
  elite: { grass: 0, plain: 0, mountain: 1, forest: 1, village: 0, city: 0, camp: 0, river: 1 },
  mystic: { grass: 0, plain: 0, mountain: 0, forest: 0, village: 0, city: 0, camp: 0, river: 1 },
}

/**
 * 地形防御系数 [地形]（§6.5.4，规则身份内联常量）。
 * 用整数百分比避免浮点：防御力 = floor(防御中间值 × pct / 100)。
 */
export const DEFENSE_COEF_PCT: Record<Terrain, number> = {
  grass: 100,
  plain: 100,
  mountain: 130,
  forest: 115,
  village: 110,
  city: 150,
  camp: 120,
  river: 80,
}

/** 坐标是否在地图界内。 */
export function inBounds(map: BattleMap, p: Position): boolean {
  return p.x >= 0 && p.x < map.width && p.y >= 0 && p.y < map.height
}

/** 取某格地形（越界视为不可达，调用方应先 inBounds）。 */
export function terrainAt(map: BattleMap, p: Position): Terrain {
  return map.tiles[p.y * map.width + p.x]!
}

/** 该格是否城池格（胜负点）。 */
export function isCityTile(map: BattleMap, p: Position): boolean {
  return map.cityTiles.some((c) => samePos(c, p))
}

/** 双方出生点继续使用既有固定规则，不属于原版地形数据。 */
const attackerSpawns: readonly Position[] = Array.from({ length: 10 }, (_, i) => ({
  x: 1,
  y: 7 + i + (i >= 5 ? 6 : 0),
}))
const defenderSpawns: readonly Position[] = attackerSpawns.map(({ y }) => ({ x: 30, y }))

function hydrateMap(raw: BattleMapData): BattleMap {
  const tiles = raw.tiles
  const cityTiles: Position[] = []
  for (let index = 0; index < tiles.length; index += 1) {
    if (tiles[index] === 'city')
      cityTiles.push({ x: index % raw.width, y: Math.floor(index / raw.width) })
  }
  return {
    id: raw.id,
    width: raw.width,
    height: raw.height,
    tiles,
    cityTiles,
    attackerSpawns,
    defenderSpawns,
  }
}

/** 把 data 层注入的纯地形资料补成 core 使用的地图目录。 */
export function createBattleMapCatalog(maps: readonly BattleMapData[]): BattleMapCatalog {
  return Object.fromEntries(maps.map((raw) => [raw.id, hydrateMap(raw)]))
}

/** fixture 使用的已知地图；不是未知 id 的运行时回退。 */
export const DEFAULT_MAP_ID: MapId = 1
