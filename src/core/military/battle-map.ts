import type { Position } from '../shared/position'
import { samePos } from '../shared/position'
import type { TroopType } from '../world/troop-type'

/** 8 种战斗地形。 */
export type Terrain = 'grass' | 'plain' | 'mountain' | 'forest' | 'village' | 'city' | 'camp' | 'river'

export type MapId = string

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

/**
 * 程序化构造一张模板地图（比手写 1024 字符更易维护、可平衡期再细化）：
 * 默认 plain 铺底；中央一块山地、左右各一条河流带、若干森林点缀；
 * 城池格置于地图中线偏防守方一侧；进攻方出生点在左列、防守方在右列各 10 个。
 */
function makeTemplateMap(id: MapId): BattleMap {
  const width = GRID_SIZE
  const height = GRID_SIZE
  const tiles: Terrain[] = new Array(width * height).fill('plain')
  const set = (x: number, y: number, t: Terrain) => {
    tiles[y * width + x] = t
  }

  // 两条河流纵带（x=10、x=21），中段留缺口便于穿行
  for (let y = 0; y < height; y++) {
    if (y < 14 || y > 17) {
      set(10, y, 'river')
      set(21, y, 'river')
    }
  }
  // 中央山地块 + 环绕森林
  for (let y = 12; y <= 19; y++) {
    for (let x = 14; x <= 17; x++) set(x, y, 'mountain')
  }
  for (let y = 10; y <= 21; y++) {
    set(13, y, 'forest')
    set(18, y, 'forest')
  }
  // 防守方一侧的村庄与营寨（增加守方纵深）
  set(26, 15, 'village')
  set(27, 16, 'camp')

  // 城池格（胜负点）：靠防守方中线
  const cityTiles: Position[] = [{ x: 28, y: 16 }]
  set(28, 16, 'city')

  // 出生点：进攻方左列 x=1，防守方右列 x=30，各 10 个，纵向铺开
  const attackerSpawns: Position[] = []
  const defenderSpawns: Position[] = []
  for (let i = 0; i < 10; i++) {
    const y = 7 + i + (i >= 5 ? 6 : 0) // 7..11 与 18..22 两段，避开中央
    attackerSpawns.push({ x: 1, y })
    defenderSpawns.push({ x: 30, y })
  }

  return { id, width, height, tiles, cityTiles, attackerSpawns, defenderSpawns }
}

/**
 * 模板地图注册表（模块常量、静态规则数据，不进 GameState/存档）。
 * 城经 City.battleMapId 指向其一；本切片先一张通用模板，平衡期可加。
 */
export const BATTLE_MAPS: Record<MapId, BattleMap> = {
  plains: makeTemplateMap('plains'),
}

/** 默认地图 id（City.battleMapId 缺省时兜底）。 */
export const DEFAULT_MAP_ID: MapId = 'plains'
