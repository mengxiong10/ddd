import type { Position } from '../shared/position'
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
 * 战斗地图（领域数据，静态模板）：只保存行主序地形数组。
 * 城池格直接由 city 地形判断，双方出生点在开战时按方向动态计算。
 * tiles.length === width*height；以 (y*width + x) 索引。
 */
export interface BattleMap {
  readonly id: MapId
  readonly width: number
  readonly height: number
  readonly tiles: readonly Terrain[]
}

/** 攻方从目标城的哪个方向进入战场。 */
export type AttackDirection =
  | 'north'
  | 'northEast'
  | 'east'
  | 'southEast'
  | 'south'
  | 'southWest'
  | 'west'
  | 'northWest'

/** data 层注入 core 前使用的纯地形形状。 */

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
  return inBounds(map, p) && terrainAt(map, p) === 'city'
}

/** 地图唯一的城池格；生成器与 fixture 保证存在且唯一。 */
export function cityTile(map: BattleMap): Position {
  const index = map.tiles.indexOf('city')
  if (index < 0) throw new Error(`battle map ${map.id} has no city tile`)
  return { x: index % map.width, y: Math.floor(index / map.width) }
}

/**
 * 由世界地图坐标计算攻方进入目标战场的方向。
 * 返回的是出发城相对目标城的方位，与原版 GetDirect(target, source) 一致。
 */
export function attackDirection(source: Position, target: Position): AttackDirection {
  const rawDx = source.x - target.x
  const rawDy = source.y - target.y
  const dx = Math.sign(rawDx)
  const dy = Math.sign(rawDy)
  if (dx === 0 && dy === 0) throw new Error('source and target city positions must differ')
  // 原版 CITY_LINKR 的方向分槽：同列或纵向跨度大于横向跨度时归正北/正南；
  // 同行归正东/正西，其余归四个对角。该规则覆盖原版全部有向邻接。
  if (dx === 0 || Math.abs(rawDy) > Math.abs(rawDx)) return dy < 0 ? 'north' : 'south'
  if (dy === 0) return dx < 0 ? 'west' : 'east'
  if (dy < 0) return dx < 0 ? 'northWest' : dx > 0 ? 'northEast' : 'north'
  return dx < 0 ? 'southWest' : 'southEast'
}

/** 原版 dFgtIntPos 的八组攻方相对坐标（方向顺序 N/NE/E/SE/S/SW/W/NW）。 */
const ATTACKER_OFFSETS: Record<AttackDirection, readonly Position[]> = {
  north: [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 1 },
    { x: 0, y: 4 },
    { x: 4, y: 4 },
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 2, y: 0 },
  ],
  northEast: [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 1 },
    { x: 1, y: 3 },
    { x: 0, y: 1 },
    { x: 3, y: 4 },
    { x: 3, y: 1 },
    { x: 4, y: 0 },
  ],
  east: [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 1 },
    { x: 0, y: 0 },
    { x: 0, y: 4 },
    { x: 3, y: 1 },
    { x: 3, y: 3 },
    { x: 4, y: 2 },
  ],
  southEast: [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 0, y: 3 },
    { x: 3, y: 0 },
    { x: 3, y: 3 },
    { x: 4, y: 4 },
  ],
  south: [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 1 },
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 1, y: 3 },
    { x: 3, y: 3 },
    { x: 2, y: 4 },
  ],
  southWest: [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 1, y: 0 },
    { x: 4, y: 3 },
    { x: 1, y: 3 },
    { x: 0, y: 4 },
  ],
  west: [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 1 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 1, y: 1 },
    { x: 1, y: 3 },
    { x: 0, y: 2 },
  ],
  northWest: [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 2 },
    { x: 3, y: 2 },
    { x: 2, y: 1 },
    { x: 3, y: 3 },
    { x: 1, y: 4 },
    { x: 4, y: 1 },
    { x: 1, y: 1 },
    { x: 0, y: 0 },
  ],
}

/** 原版 dFgtIntPos 第九组：守方相对城池左上两格基准的坐标。 */
const DEFENDER_OFFSETS: readonly Position[] = [
  { x: 2, y: 2 },
  { x: 2, y: 3 },
  { x: 1, y: 2 },
  { x: 3, y: 2 },
  { x: 2, y: 1 },
  { x: 1, y: 1 },
  { x: 3, y: 3 },
  { x: 1, y: 3 },
  { x: 3, y: 1 },
  { x: 2, y: 0 },
]

function translate(base: Position, offsets: readonly Position[]): Position[] {
  return offsets.map((offset) => ({ x: base.x + offset.x, y: base.y + offset.y }))
}

/** 按原版边缘基准与方向阵形动态生成 10 个攻方出生点。 */
export function attackerSpawns(map: BattleMap, direction: AttackDirection): readonly Position[] {
  const bases: Record<AttackDirection, Position> = {
    north: { x: Math.floor(map.width / 2) - 2, y: 0 },
    northEast: { x: map.width - 5, y: 2 },
    east: { x: map.width - 5, y: Math.floor(map.height / 2) - 2 },
    southEast: { x: map.width - 5, y: map.height - 5 },
    south: { x: Math.floor(map.width / 2) - 2, y: map.height - 5 },
    southWest: { x: 2, y: map.height - 5 },
    west: { x: 2, y: Math.floor(map.height / 2) - 2 },
    northWest: { x: 0, y: 0 },
  }
  return translate(bases[direction], ATTACKER_OFFSETS[direction])
}

/** 以唯一城池格为中心，按原版守方阵形动态生成 10 个出生点。 */
export function defenderSpawns(map: BattleMap): readonly Position[] {
  const city = cityTile(map)
  return translate({ x: city.x - 2, y: city.y - 2 }, DEFENDER_OFFSETS)
}

/** 把 data 层注入的纯地形资料补成 core 使用的地图目录。 */
export function createBattleMapCatalog(maps: readonly BattleMap[]): BattleMapCatalog {
  return Object.fromEntries(maps.map((raw) => [raw.id, raw]))
}

/** fixture 使用的已知地图；不是未知 id 的运行时回退。 */
export const DEFAULT_MAP_ID: MapId = 1
