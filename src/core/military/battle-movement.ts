import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { Position } from '../shared/position'
import { samePos } from '../shared/position'
import { effectiveTroopType, officerMovement } from '../world/queries'
import type { TroopType } from '../world/troop-type'
import type { BattleState } from './battle-core'
import type { BattleMap } from './battle-map'
import { BATTLE_MAPS, MAX_MOVEMENT, MOVE_COST, inBounds, terrainAt } from './battle-map'
import { ATTACK_MASK } from './battle-combat'
import type { SkillId } from './battle-skill'
import { RANGE_MASK } from './battle-skill'

const STEPS: readonly Position[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
]
const key = (p: Position): string => `${p.x},${p.y}`

/** 某格存活单位（非击溃）；无则 undefined。 */
function unitAt(battle: BattleState, p: Position) {
  return Object.values(battle.units).find((u) => u.status !== 'dead' && samePos(u.pos, p))
}

/** 敌方接敌停步区：所有存活敌方单位的上下左右四格之并。 */
function zocTiles(
  battle: BattleState,
  mySide: BattleState['units'][OfficerId]['side']
): Set<string> {
  const zoc = new Set<string>()
  for (const u of Object.values(battle.units)) {
    if (u.status === 'dead' || u.side === mySide) continue
    for (const s of STEPS) zoc.add(key({ x: u.pos.x + s.x, y: u.pos.y + s.y }))
  }
  return zoc
}

/**
 * 可达落点（§6.6.4）：Dijkstra 按兵种地形消耗累计，预算 = 移动力（封顶 8）。
 * - 敌方存活单位占格不可进入（阻路径与落点）。
 * - 友方存活单位占格可穿越（路径扩展继续）、但不可作为落点。
 * - 接敌停步区：进入即停（该格不再向外扩展），兑现「不能继续穿越」。
 * 返回含起点（原地不动）在内的全部合法落点。
 */
export function reachableTiles(
  state: GameState,
  battle: BattleState,
  officerId: OfficerId
): Position[] {
  const unit = battle.units[officerId]
  if (!unit || unit.status === 'dead') return []
  const map: BattleMap = BATTLE_MAPS[battle.mapId]!
  const troopType: TroopType = effectiveTroopType(state, officerId)
  // 定身：移动力降为 1；其余按派生移动力封顶 8。
  const budget =
    unit.status === 'rooted' ? 1 : Math.min(officerMovement(state, officerId), MAX_MOVEMENT)
  const start = unit.pos
  // 奇门：可穿越敌方接敌停步区 → 不受 ZoC 压制。
  const zoc = unit.status === 'qimen' ? new Set<string>() : zocTiles(battle, unit.side)

  const dist = new Map<string, number>([[key(start), 0]])
  const frontier: Position[] = [start]
  while (frontier.length > 0) {
    // 取当前最小累计的节点（预算小、点少，线性选取足够）
    let bi = 0
    for (let i = 1; i < frontier.length; i++) {
      if (dist.get(key(frontier[i]!))! < dist.get(key(frontier[bi]!))!) bi = i
    }
    const cur = frontier.splice(bi, 1)[0]!
    const cc = dist.get(key(cur))!
    // 接敌停步：非起点的 ZoC 格不再向外扩展
    if (!samePos(cur, start) && zoc.has(key(cur))) continue
    for (const s of STEPS) {
      const nx: Position = { x: cur.x + s.x, y: cur.y + s.y }
      if (!inBounds(map, nx)) continue
      const occ = unitAt(battle, nx)
      if (occ && occ.side !== unit.side) continue // 敌方占格不可进入
      const nc = cc + MOVE_COST[troopType][terrainAt(map, nx)]
      if (nc > budget) continue
      const k = key(nx)
      if (!dist.has(k) || nc < dist.get(k)!) {
        dist.set(k, nc)
        frontier.push(nx)
      }
    }
  }

  // 落点：dist 已达且非「他人存活单位占格」（友方阻落点、敌方已排除；起点=自身允许）
  const result: Position[] = []
  for (const k of dist.keys()) {
    const [x, y] = k.split(',').map(Number) as [number, number]
    const p: Position = { x, y }
    const occ = unitAt(battle, p)
    if (occ && occ.officerId !== officerId) continue
    result.push(p)
  }
  return result
}

/**
 * 可击格（§6.6.5）：以 from 为中心套兵种默认掩码（界内即返回）。
 * 目标格是否真有敌方由调用方（act/canBattle）判定。
 */
export function attackableTiles(map: BattleMap, from: Position, troopType: TroopType): Position[] {
  const result: Position[] = []
  for (const off of ATTACK_MASK[troopType]) {
    const p: Position = { x: from.x + off.x, y: from.y + off.y }
    if (inBounds(map, p)) result.push(p)
  }
  return result
}

/**
 * 技能目标候选格（§6.4.2）：以 from 为中心套该技能 9×9 掩码（界内即返回）。
 * 阵营/地形/兵种合法性由调用方（canBattle）另判；self/无目标技能返回 []。
 */
export function skillTargetTiles(map: BattleMap, from: Position, skillId: SkillId): Position[] {
  const result: Position[] = []
  for (const off of RANGE_MASK[skillId] ?? []) {
    const p: Position = { x: from.x + off.x, y: from.y + off.y }
    if (inBounds(map, p)) result.push(p)
  }
  return result
}
