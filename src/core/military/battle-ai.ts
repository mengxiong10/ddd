import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { Position } from '../shared/position'
import { samePos, manhattan } from '../shared/position'
import type { Rng } from '../shared/rng'
import { randInt, pickRandom } from '../shared/rng'
import { effectiveOfficer, effectiveTroopType } from '../world/queries'
import { troopCapacity } from '../world/officer'
import type { Terrain, BattleMap } from './battle-map'
import { terrainAt, isCityTile } from './battle-map'
import { reachableTiles, attackableTiles, skillTargetTiles } from './battle-movement'
import type { SkillDef } from './battle-skill'
import { SKILL_DEFS, availableSkills } from './battle-skill'
import { canActWithStatus, canCastWithStatus } from './battle-status'
import type { BattleState, BattleUnit, BattleAction } from './battle-core'
import { aliveUnits, unitAt, computeDamage, canCast } from './battle-core'

/**
 * 对手方（AI）决策叶（`17-battle-ai`）：选将 → 选落点 → 选终结动作，产出一个 `act`。
 * 只 import battle-core（运行时：类型/助手/computeDamage/canCast）+ 现有叶（movement/skill/map/status）
 * + world/shared，不 import 编排 `battle` → 无环。AI 选位只算普攻预估伤害、不评估技能收益、从不撤退。
 */

type ActAction = Extract<BattleAction, { type: 'act' }>
type Terminal = ActAction['terminal']

/** 主将在普攻范围内视作的「无穷伤害」哨兵（避免 Infinity 相减得 NaN，破坏排序全序）。 */
const COMMANDER_DAMAGE = Number.MAX_SAFE_INTEGER

/** 防御地形（§7.4 落点偏好）：山地/树林/村庄/城池/营寨。 */
const DEFENSIVE_TERRAIN: ReadonlySet<Terrain> = new Set<Terrain>([
  'mountain',
  'forest',
  'village',
  'city',
  'camp',
])

/** 玩家主将 id（AI 的「敌方主将」）：attack 模式=攻方主将、defend 模式=守方主将（均为玩家方）。 */
function playerCommanderId(battle: BattleState): OfficerId {
  return battle.mode === 'attack' ? battle.attackerCommanderId : battle.defenderCommanderId
}

/** 目标点（§7.3）：attack 模式=玩家主将格（扑主将）；defend 模式=城池格中心（推城）。 */
function targetPoint(battle: BattleState, map: BattleMap): Position {
  if (battle.mode === 'attack') {
    const commander = battle.units[playerCommanderId(battle)]
    if (commander && commander.status !== 'dead') return commander.pos
    const anyPlayer = aliveUnits(battle).find((u) => u.side === 'player')
    if (anyPlayer) return anyPlayer.pos
  }
  return map.cityTiles[0] ?? { x: 0, y: 0 }
}

/** 选将（§7.2）：对手方、可行动（非 dead/confused/stone）、未行动；离目标点曼哈顿最小（平局 officerId 升序）。 */
function selectUnitId(battle: BattleState, map: BattleMap): OfficerId | null {
  const tp = targetPoint(battle, map)
  const candidates = aliveUnits(battle).filter(
    (u) => u.side === 'opponent' && !u.acted && canActWithStatus(u.status)
  )
  if (candidates.length === 0) return null
  candidates.sort(
    (a, b) => manhattan(a.pos, tp) - manhattan(b.pos, tp) || (a.officerId < b.officerId ? -1 : 1)
  )
  return candidates[0]!.officerId
}

const mapOf = (state: GameState, battle: BattleState) => state.battleMaps[battle.mapId]!
const posKey = (p: Position, width: number): number => p.y * width + p.x

/**
 * 落点伤害预估（§7.5，只看普攻）：扫该兵种 attackableTiles 内活着的玩家方单位；
 * 玩家主将在内 → COMMANDER_DAMAGE（无条件优先）；否则取各目标 computeDamage(…, fromPos) 最大值；无目标 → 0。
 */
function estimateBestDamage(
  state: GameState,
  battle: BattleState,
  map: BattleMap,
  officerId: OfficerId,
  fromPos: Position
): number {
  const unit = battle.units[officerId]!
  const troopType = effectiveTroopType(state, officerId)
  const commander = playerCommanderId(battle)
  let best = 0
  for (const c of attackableTiles(map, fromPos, troopType)) {
    const tu = unitAt(battle, c)
    if (!tu || tu.side === unit.side) continue
    if (tu.officerId === commander) return COMMANDER_DAMAGE
    const d = computeDamage(state, map, unit, tu, fromPos)
    if (d > best) best = d
  }
  return best
}

/**
 * 选落点（§7.4，确定性）：①已站城池格→原地 ②defend 模式且某可达点∈cityTiles→进城
 * ③否则按（预估伤害降序；若全 0 则离目标点更近；防御地形优先；离起点更远；坐标序）取最优。
 */
function chooseTile(
  state: GameState,
  battle: BattleState,
  map: BattleMap,
  officerId: OfficerId
): Position {
  const unit = battle.units[officerId]!
  if (isCityTile(map, unit.pos)) return unit.pos // §7.4.1 站城上不动
  const tiles = reachableTiles(state, battle, officerId)
  if (battle.mode === 'defend') {
    // §7.4.2 进城即胜（仅 AI 攻方）
    const cityReach = tiles
      .filter((p) => isCityTile(map, p))
      .sort((a, b) => posKey(a, map.width) - posKey(b, map.width))
    if (cityReach.length > 0) return cityReach[0]!
  }
  const tp = targetPoint(battle, map)
  const dmg = new Map<number, number>()
  for (const p of tiles)
    dmg.set(posKey(p, map.width), estimateBestDamage(state, battle, map, officerId, p))
  const anyDamage = [...dmg.values()].some((d) => d > 0)
  const sorted = tiles.slice().sort((a, b) => {
    const da = dmg.get(posKey(a, map.width))!
    const db = dmg.get(posKey(b, map.width))!
    if (da !== db) return db - da // 伤害降序
    if (!anyDamage) {
      const ma = manhattan(a, tp)
      const mb = manhattan(b, tp)
      if (ma !== mb) return ma - mb // 都打不到 → 更接近目标点
    }
    const fa = DEFENSIVE_TERRAIN.has(terrainAt(map, a)) ? 0 : 1
    const fb = DEFENSIVE_TERRAIN.has(terrainAt(map, b)) ? 0 : 1
    if (fa !== fb) return fa - fb // 防御地形优先
    const sa = manhattan(a, unit.pos)
    const sb = manhattan(b, unit.pos)
    if (sa !== sb) return sb - sa // 走得更远
    return posKey(a, map.width) - posKey(b, map.width) // 坐标序兜底
  })
  return sorted[0] ?? unit.pos
}

/** 选普攻目标：范围内玩家主将优先，否则 computeDamage 最大（平局 officerId 升序）；无敌则 null。 */
function chooseAttackTarget(
  state: GameState,
  battle: BattleState,
  map: BattleMap,
  officerId: OfficerId,
  pos: Position
): Position | null {
  const unit = battle.units[officerId]!
  const troopType = effectiveTroopType(state, officerId)
  const commander = playerCommanderId(battle)
  const enemies = attackableTiles(map, pos, troopType)
    .map((c) => unitAt(battle, c))
    .filter((tu): tu is BattleUnit => !!tu && tu.side !== unit.side)
  if (enemies.length === 0) return null
  const cmd = enemies.find((tu) => tu.officerId === commander)
  if (cmd) return cmd.pos
  enemies.sort(
    (a, b) =>
      computeDamage(state, map, unit, b, pos) - computeDamage(state, map, unit, a, pos) ||
      (a.officerId < b.officerId ? -1 : 1)
  )
  return enemies[0]!.pos
}

/** 某技能在 pos 的合法目标格（§7.7）：跳 self 技能；canCast 校验 MP/四关/范围/阵营；治疗只取损失≥1/4者。 */
function findSkillTarget(
  state: GameState,
  battle: BattleState,
  map: BattleMap,
  caster: BattleUnit,
  pos: Position,
  def: SkillDef
): Position | null {
  if (def.target === 'self') return null // AI 跳过 self 技能（天变/谍报）
  const commander = playerCommanderId(battle)
  const candidates: BattleUnit[] = []
  for (const tile of skillTargetTiles(map, pos, def.id)) {
    const tu = unitAt(battle, tile)
    if (!tu) continue
    // 排除施法者自身：决策期其移动尚未落到 battle.units，旧格不应被当成（友方）目标。
    if (tu.officerId === caster.officerId) continue
    if (!canCast(state, battle, map, caster, pos, { skillId: def.id, target: tile }).ok) continue
    if (def.target === 'ally' && def.baseTroops > 0) {
      // 治疗类：只考虑给「至少损失 1/4 兵力」的友军
      const cap = troopCapacity({ ...effectiveOfficer(state, tu.officerId), level: tu.level })
      if (cap - tu.troops < Math.floor(cap / 4)) continue
    }
    candidates.push(tu)
  }
  if (candidates.length === 0) return null
  if (def.target === 'enemy') {
    const cmd = candidates.find((u) => u.officerId === commander)
    if (cmd) return cmd.pos
    candidates.sort((a, b) => (a.officerId < b.officerId ? -1 : 1))
    return candidates[0]!.pos
  }
  // 友方（治疗）：最损血者优先（兵力最低），平局 officerId 升序
  candidates.sort((a, b) => a.troops - b.troops || (a.officerId < b.officerId ? -1 : 1))
  return candidates[0]!.pos
}

/**
 * 技能筛 + 选技（§7.7，消费 rng）：禁咒→null（不耗 rng）；RandInt(0,149)>有效智力→null；
 * 非玄兵 RandInt(0, floor(带兵量×1.5))<当前兵力→null（玄兵免此筛）；
 * 玄兵=最佳（序号从高到低取第一个可施放者，不耗 rng）；非玄兵=简单（随机抽 1 个可用技能，可施放则放否则 null）。
 */
function trySkill(
  state: GameState,
  battle: BattleState,
  map: BattleMap,
  unit: BattleUnit,
  pos: Position,
  rng: Rng
): readonly [Terminal | null, Rng] {
  if (!canCastWithStatus(unit.status)) return [null, rng] // 禁咒/死亡：不放、不耗 rng
  const eff = effectiveOfficer(state, unit.officerId)
  const troopType = effectiveTroopType(state, unit.officerId)
  const isMystic = troopType === 'mystic'

  const [r1, rng1] = randInt(rng, 0, 149)
  rng = rng1
  if (r1 > eff.intelligence) return [null, rng] // 智力筛

  if (!isMystic) {
    const cap = troopCapacity({ ...eff, level: unit.level })
    const [r2, rng2] = randInt(rng, 0, Math.floor(cap * 1.5))
    rng = rng2
    if (r2 < unit.troops) return [null, rng] // 兵多保留筛
  }

  const officer = state.officers[unit.officerId]!
  const isLord = officer.lordId === officer.id
  const avail = [...availableSkills(troopType, unit.level, officer.personalSkills, isLord)].filter(
    (id) => SKILL_DEFS[id] && SKILL_DEFS[id]!.target !== 'self'
  )
  if (avail.length === 0) return [null, rng]

  if (isMystic) {
    // 最佳：序号从高到低，取第一个能找到目标者
    for (const id of avail.sort((a, b) => b - a)) {
      const t = findSkillTarget(state, battle, map, unit, pos, SKILL_DEFS[id]!)
      if (t) return [{ kind: 'cast', skillId: id, target: t }, rng]
    }
    return [null, rng]
  }
  // 简单：随机抽 1 个可用技能，能找到目标则放、否则技能不成立
  const [picked, rng3] = pickRandom(rng, avail)
  rng = rng3
  const t = findSkillTarget(state, battle, map, unit, pos, SKILL_DEFS[picked]!)
  return t ? [{ kind: 'cast', skillId: picked, target: t }, rng] : [null, rng]
}

/** 选终结动作（§7.6）：玄兵=技能优先；其余=攻击优先。回退到普攻 / 休息。 */
function chooseTerminal(
  state: GameState,
  battle: BattleState,
  map: BattleMap,
  officerId: OfficerId,
  pos: Position,
  rng: Rng
): readonly [Terminal, Rng] {
  const unit = battle.units[officerId]!
  const isMystic = effectiveTroopType(state, officerId) === 'mystic'
  const attackTarget = chooseAttackTarget(state, battle, map, officerId, pos)

  if (isMystic) {
    const [skill, r] = trySkill(state, battle, map, unit, pos, rng)
    if (skill) return [skill, r]
    if (attackTarget) return [{ kind: 'attack', target: attackTarget }, r]
    return [{ kind: 'rest' }, r]
  }
  // 攻击优先
  const [skill, r] = trySkill(state, battle, map, unit, pos, rng)
  if (skill) return [skill, r]
  if (attackTarget) return [{ kind: 'attack', target: attackTarget }, r]
  return [{ kind: 'rest' }, r]
}

/**
 * 产出对手方下一个行动：选将→选落点（确定性）→选终结动作（耗 rng），返回推进 rng 后的 state。
 * 无可动 AI 单位 / 无战斗 / 已分胜负 → null。
 */
export function nextOpponentAction(
  state: GameState
): { readonly state: GameState; readonly action: ActAction } | null {
  const battle = state.activeBattle
  if (!battle || battle.outcome) return null
  const map = mapOf(state, battle)
  const officerId = selectUnitId(battle, map)
  if (!officerId) return null
  const pos = chooseTile(state, battle, map, officerId)
  const [terminal, rng] = chooseTerminal(state, battle, map, officerId, pos, state.rng)
  const unit = battle.units[officerId]!
  const action: ActAction = {
    type: 'act',
    officerId,
    ...(samePos(pos, unit.pos) ? {} : { moveTo: pos }),
    terminal,
  }
  return { state: { ...state, rng }, action }
}
