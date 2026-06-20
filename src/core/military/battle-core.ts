import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { Position } from '../shared/position'
import { samePos } from '../shared/position'
import type { CommandCheck } from '../shared/command'
import type { Rng } from '../shared/rng'
import { effectiveOfficer, effectiveTroopType } from '../world/queries'
import { troopCapacity } from '../world/officer'
import type { MapId, BattleMap } from './battle-map'
import { BATTLE_MAPS, REDUCTION_TIER, DEFENSE_COEF_PCT, isCityTile, terrainAt } from './battle-map'
import {
  COUNTER_PCT,
  baseAttack,
  baseDefense,
  terrainAttack,
  terrainDefense,
  attackDamage,
  experienceGain,
  applyLevelUp,
} from './battle-combat'
import { reachableTiles, attackableTiles, skillTargetTiles } from './battle-movement'
import type { Weather } from './battle-weather'
import { refreshWeather } from './battle-weather'
import type { BattleStatus } from './battle-status'
import { canActWithStatus, canCastWithStatus } from './battle-status'
import type { SkillId, SkillDef } from './battle-skill'
import {
  SKILL_DEFS,
  availableSkills,
  effectValue,
  skillGatesPass,
  rollSkillSuccess,
  weatherMul,
  targetTerrainMul,
  casterTerrainMul,
  targetTroopMul,
} from './battle-skill'

/**
 * 战斗核心机制（`17-battle-ai` 起从 `battle.ts` 抽出）：类型 + 单位助手 + 伤害/普攻/施法结算 +
 * `applyActResolved`（已校验即应用）+ `canBattle`/`canCast` + 即时胜负。被编排 `battle.ts`
 * 与对手决策 `battle-ai.ts` 共用；不反向 import `battle`/`battle-ai`。
 */

/** 阵营：玩家方 / 对手方。 */
export type BattleSide = 'player' | 'opponent'

/** 攻守模式：玩家进攻敌城 / 玩家防守己城。 */
export type BattleMode = 'attack' | 'defend'

/** 战斗结果（玩家视角）。null 表示进行中。 */
export type BattleOutcome = 'playerWin' | 'playerLose'

/** 战斗单位：开战时由 Officer 快照而来，战中演进，分胜负后写回 Officer。 */
export interface BattleUnit {
  readonly officerId: OfficerId
  readonly side: BattleSide
  readonly pos: Position
  /** 战中当前兵力；归零即击溃（status='dead'）。 */
  readonly troops: number
  /** 经验快照（战中累积）。 */
  readonly experience: number
  /** 等级快照（战中可升级）。 */
  readonly level: number
  /** 本日是否已行动（每日刷新）。 */
  readonly acted: boolean
  /** 当前技能点；开战由公式派生、战后不写回 Officer。 */
  readonly mp: number
  /** 技能点上限（=初始 MP）。休息 +1 封顶此值。 */
  readonly maxMp: number
  /** 人物状态；'dead'=击溃（死亡唯一真相，替代旧 routed 字段）。 */
  readonly status: BattleStatus
}

/**
 * 战斗子状态：月末遇玩家 campaign 时挂在 GameState.activeBattle。
 * 唯一持有的来源 campaign 信息是 targetCityId；攻方君主与攻/守名单均由 units 派生
 * （攻方君主 = 攻方单位对应 Officer 的 lordId，整场不变；名单由 units.side），不另存。
 */
export interface BattleState {
  readonly mode: BattleMode
  readonly mapId: MapId
  /** 当前天气；开战=风，每日开头刷新。 */
  readonly weather: Weather
  /** 当前天数，从 1 起，封顶 MAX_DAYS。 */
  readonly day: number
  /** 全部参战单位，按 officerId 索引。 */
  readonly units: Readonly<Record<OfficerId, BattleUnit>>
  /** 玩家方 / 对手方战场粮草。 */
  readonly playerProvisions: number
  readonly opponentProvisions: number
  /** 攻方主将 = 攻方第一名（出征名单首位）；开战定格、不随减员漂移；被击溃 → 攻方负。 */
  readonly attackerCommanderId: OfficerId
  /** 守方主将 = 守方第一名（太守领衔）；开战定格、不随减员漂移；被击溃 → 守方负。 */
  readonly defenderCommanderId: OfficerId
  /** 战斗结果；null=进行中。 */
  readonly outcome: BattleOutcome | null
  readonly targetCityId: CityId
}

/**
 * 战斗专属 action（经 game.apply 的 {type:'battle', action} 包装分派）。
 * - act：可选移动 + 一个终结动作（攻击/休息/施法），结束该单位本日行动。
 * - endDay：对手方行动（`17-battle-ai` 起由 AI 实际行动）→ 双方扣当日粮草 → 进入下一天。
 * - retreat：玩家全军撤退 → 玩家方失败。
 */
export type BattleAction =
  | {
      readonly type: 'act'
      readonly officerId: OfficerId
      readonly moveTo?: Position
      readonly terminal:
        | { readonly kind: 'attack'; readonly target: Position }
        | { readonly kind: 'rest' }
        | { readonly kind: 'cast'; readonly skillId: SkillId; readonly target?: Position }
    }
  | { readonly type: 'endDay' }
  | { readonly type: 'retreat' }

export const aliveUnits = (battle: BattleState): BattleUnit[] =>
  Object.values(battle.units).filter((u) => u.status !== 'dead')
export const unitAt = (battle: BattleState, p: Position): BattleUnit | undefined =>
  aliveUnits(battle).find((u) => samePos(u.pos, p))
export const sideTroops = (battle: BattleState, side: BattleSide): number =>
  aliveUnits(battle)
    .filter((u) => u.side === side)
    .reduce((s, u) => s + u.troops, 0)
export const sideAlive = (battle: BattleState, side: BattleSide): boolean =>
  aliveUnits(battle).some((u) => u.side === side)

/** 即时胜负检查（每次 act 后）：城池格 / 主将击溃 / 全灭。无则 null。 */
export function checkImmediateVictory(battle: BattleState, map: BattleMap): BattleOutcome | null {
  const attackerSide: BattleSide = battle.mode === 'attack' ? 'player' : 'opponent'
  const defenderSide: BattleSide = battle.mode === 'attack' ? 'opponent' : 'player'
  // 城池格：进攻方=玩家进城胜；防守方=对手进城败
  for (const u of aliveUnits(battle)) {
    if (!isCityTile(map, u.pos)) continue
    if (battle.mode === 'attack' && u.side === 'player') return 'playerWin'
    if (battle.mode === 'defend' && u.side === 'opponent') return 'playerLose'
  }
  // 任一方主将被击溃 → 该方负（攻方主将=出征首位；守方主将=太守）
  const attackerCommander = battle.units[battle.attackerCommanderId]
  if (attackerCommander && attackerCommander.status === 'dead')
    return attackerSide === 'player' ? 'playerLose' : 'playerWin'
  const defenderCommander = battle.units[battle.defenderCommanderId]
  if (defenderCommander && defenderCommander.status === 'dead')
    return defenderSide === 'player' ? 'playerLose' : 'playerWin'
  // 全灭 → 另一方胜
  if (!sideAlive(battle, 'player')) return 'playerLose'
  if (!sideAlive(battle, 'opponent')) return 'playerWin'
  return null
}

/** 校验一个战斗 action 是否合法（供 canApply 与玩家 act 路径共用）；仍要求 unit.side==='player'。 */
export function canBattle(state: GameState, action: BattleAction): CommandCheck {
  const battle = state.activeBattle
  if (!battle) return { ok: false, reason: 'no-active-battle' }
  if (battle.outcome) return { ok: false, reason: 'battle-ended' }
  if (action.type !== 'act') return { ok: true }

  const unit = battle.units[action.officerId]
  if (!unit || unit.status === 'dead') return { ok: false, reason: 'unit-not-found-or-routed' }
  if (unit.side !== 'player') return { ok: false, reason: 'not-player-unit' }
  if (unit.acted) return { ok: false, reason: 'unit-already-acted' }
  if (!canActWithStatus(unit.status)) return { ok: false, reason: 'cannot-act-status' }

  const map = BATTLE_MAPS[battle.mapId]!
  if (
    action.moveTo &&
    !reachableTiles(state, battle, action.officerId).some((p) => samePos(p, action.moveTo!))
  ) {
    return { ok: false, reason: 'move-unreachable' }
  }
  const from = action.moveTo ?? unit.pos
  if (action.terminal.kind === 'attack') {
    const target = action.terminal.target
    const troopType = effectiveTroopType(state, action.officerId)
    if (!attackableTiles(map, from, troopType).some((p) => samePos(p, target))) {
      return { ok: false, reason: 'attack-out-of-range' }
    }
    const enemy = unitAt(battle, target)
    if (!enemy || enemy.side === unit.side) return { ok: false, reason: 'no-enemy-at-target' }
  }
  if (action.terminal.kind === 'cast') {
    return canCast(state, battle, map, unit, from, action.terminal)
  }
  return { ok: true }
}

/** 校验一次施法（供 canBattle 与 battle-ai 选技）：禁咒/已掌握/MP/四关/范围/阵营。 */
export function canCast(
  state: GameState,
  battle: BattleState,
  map: BattleMap,
  caster: BattleUnit,
  from: Position,
  term: { skillId: SkillId; target?: Position }
): CommandCheck {
  if (!canCastWithStatus(caster.status)) return { ok: false, reason: 'cannot-cast-status' }
  const def: SkillDef | undefined = SKILL_DEFS[term.skillId]
  if (!def) return { ok: false, reason: 'skill-not-found' }
  const officer = state.officers[caster.officerId]!
  const isLord = officer.lordId === officer.id
  const avail = availableSkills(
    effectiveTroopType(state, caster.officerId),
    caster.level,
    officer.personalSkills,
    isLord
  )
  if (!avail.has(def.id)) return { ok: false, reason: 'skill-not-learned' }
  if (caster.mp < def.mp) return { ok: false, reason: 'mp-insufficient' }
  const casterTerrain = terrainAt(map, from)
  if (def.target === 'self') {
    return skillGatesPass(def, battle.weather, casterTerrain)
      ? { ok: true }
      : { ok: false, reason: 'weather-terrain-forbidden' }
  }
  if (!term.target) return { ok: false, reason: 'target-required' }
  if (!skillTargetTiles(map, from, def.id).some((p) => samePos(p, term.target!))) {
    return { ok: false, reason: 'skill-out-of-range' }
  }
  const tu = unitAt(battle, term.target)
  if (!tu) return { ok: false, reason: 'no-unit-at-target' }
  if (def.target === 'enemy' && tu.side === caster.side)
    return { ok: false, reason: 'skill-needs-enemy' }
  if (def.target === 'ally' && tu.side !== caster.side)
    return { ok: false, reason: 'skill-needs-ally' }
  const gate = skillGatesPass(def, battle.weather, casterTerrain, {
    terrain: terrainAt(map, tu.pos),
    troop: effectiveTroopType(state, tu.officerId),
  })
  return gate ? { ok: true } : { ok: false, reason: 'weather-terrain-troop-forbidden' }
}

/**
 * 计算一次普攻对目标的实际扣兵（吃有效武力/智力/兵种与双方脚下地形）。
 * `17-battle-ai` 起加可选 atkPos——AI 预估「若攻击者站在候选落点」时的伤害（默认取 attacker.pos）。
 */
export function computeDamage(
  state: GameState,
  map: BattleMap,
  attacker: BattleUnit,
  defender: BattleUnit,
  atkPos: Position = attacker.pos
): number {
  const atkType = effectiveTroopType(state, attacker.officerId)
  const defType = effectiveTroopType(state, defender.officerId)
  const atkForce = effectiveOfficer(state, attacker.officerId).force
  const defIntel = effectiveOfficer(state, defender.officerId).intelligence
  const atkTerrain = terrainAt(map, atkPos)
  const defTerrain = terrainAt(map, defender.pos)
  const atkPower = terrainAttack(
    baseAttack(atkForce, attacker.level, atkType),
    REDUCTION_TIER[atkType][atkTerrain]
  )
  const defPower = terrainDefense(
    baseDefense(defIntel, defender.level, defType),
    REDUCTION_TIER[defType][defTerrain],
    DEFENSE_COEF_PCT[defTerrain]
  )
  return attackDamage(
    atkPower,
    defPower,
    attacker.troops,
    COUNTER_PCT[atkType][defType],
    defender.troops
  )
}

/** 上/下/左/右四邻（围攻遍历定序）。 */
const ORTHO: readonly Position[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
]

/** 一次普攻（mutate units）：扣目标兵力/置死亡，行动者获经验/升级。普攻与围攻共用。 */
function basicAttack(
  state: GameState,
  map: BattleMap,
  units: Record<OfficerId, BattleUnit>,
  attacker: BattleUnit,
  defender: BattleUnit
): void {
  const dmg = computeDamage(state, map, attacker, defender)
  const newTroops = Math.max(0, defender.troops - dmg)
  const routed = newTroops === 0
  units[defender.officerId] = {
    ...defender,
    troops: newTroops,
    status: routed ? 'dead' : defender.status,
  }
  const leveled = applyLevelUp(
    attacker.level,
    attacker.experience + experienceGain(dmg, attacker.level, defender.level, routed)
  )
  units[attacker.officerId] = { ...attacker, level: leveled.level, experience: leveled.experience }
}

/** 施法成功后的效果结算（mutate units），返回天气/rng/双方战场粮草补丁。 */
function applyCastEffect(
  state: GameState,
  map: BattleMap,
  battle: BattleState,
  units: Record<OfficerId, BattleUnit>,
  caster: BattleUnit,
  def: SkillDef,
  target: BattleUnit | undefined,
  rng: Rng
): { weather: Weather; rng: Rng; playerProvisions: number; opponentProvisions: number } {
  const base = {
    weather: battle.weather,
    rng,
    playerProvisions: battle.playerProvisions,
    opponentProvisions: battle.opponentProvisions,
  }
  // 天变：刷新天气；谍报：core 无效果（UI 读对手粮草）
  if (def.special === 'weather') {
    const [w, r] = refreshWeather(rng)
    return { ...base, weather: w, rng: r }
  }
  if (def.special === 'intel') return base
  if (!target) return base

  // 围攻：目标四邻友军逐个普攻目标（上/下/左/右），可致击溃
  if (def.special === 'siege') {
    for (const s of ORTHO) {
      const cur = units[target.officerId]!
      if (cur.status === 'dead') break
      const p: Position = { x: target.pos.x + s.x, y: target.pos.y + s.y }
      const ally = Object.values(units).find(
        (u) => u.status !== 'dead' && u.side === caster.side && samePos(u.pos, p)
      )
      if (ally) basicAttack(state, map, units, ally, cur)
    }
    return base
  }

  const cur = units[target.officerId]!
  if (cur.status === 'dead') return base
  const mw = weatherMul(def, battle.weather)
  const mtt = targetTroopMul(def, effectiveTroopType(state, target.officerId))
  const mterr = targetTerrainMul(def, terrainAt(map, cur.pos))
  const mc = casterTerrainMul(def, terrainAt(map, caster.pos))

  if (def.baseFood > 0) {
    // 破粮：扣敌方（caster 对侧）战场粮草
    const val = effectValue(def.baseFood, mw, mtt, mterr, mc)
    if (caster.side === 'player') {
      return {
        ...base,
        opponentProvisions: Math.max(
          0,
          base.opponentProvisions - Math.min(val, base.opponentProvisions)
        ),
      }
    }
    return {
      ...base,
      playerProvisions: Math.max(0, base.playerProvisions - Math.min(val, base.playerProvisions)),
    }
  }

  if (def.baseTroops > 0) {
    const val = effectValue(def.baseTroops, mw, mtt, mterr, mc)
    if (def.target === 'ally') {
      const cap = Math.max(
        0,
        troopCapacity({ ...effectiveOfficer(state, target.officerId), level: cur.level }) -
          cur.troops
      )
      units[target.officerId] = {
        ...cur,
        troops: cur.troops + Math.min(val, cap),
        status: def.status ?? cur.status,
      }
    } else {
      const dmg = Math.min(val, cur.troops)
      const newTroops = cur.troops - dmg
      const routed = newTroops === 0
      units[target.officerId] = {
        ...cur,
        troops: newTroops,
        status: routed ? 'dead' : (def.status ?? cur.status),
      }
    }
    return base
  }

  // 纯状态技能（基础兵力/破粮均 0）
  if (def.status) units[target.officerId] = { ...cur, status: def.status }
  return base
}

/**
 * 已校验即应用（从旧 applyAct 抽出、去掉 player-only 的 canBattle 门）：移动到 moveTo、结算
 * attack/rest/cast（含技能成功率 rng + 施法效果），置 acted，跑 checkImmediateVictory 写 outcome。
 * 玩家路（reduceBattle 'act' 经 canBattle 通过后）与 AI 路（battle-ai 决策已自证合法）共用。
 */
export function applyActResolved(
  state: GameState,
  battle: BattleState,
  action: Extract<BattleAction, { type: 'act' }>
): GameState {
  const map = BATTLE_MAPS[battle.mapId]!
  let rng = state.rng
  let weather = battle.weather
  let playerProvisions = battle.playerProvisions
  let opponentProvisions = battle.opponentProvisions
  const units = { ...battle.units }
  const actor = units[action.officerId]!
  const pos = action.moveTo ?? actor.pos
  const acting: BattleUnit = { ...actor, pos, acted: true }
  units[action.officerId] = acting

  const term = action.terminal
  if (term.kind === 'attack') {
    basicAttack(state, map, units, acting, unitAt(battle, term.target)!)
  } else if (term.kind === 'rest') {
    units[action.officerId] = { ...acting, mp: Math.min(acting.maxMp, acting.mp + 1) }
  } else {
    const def = SKILL_DEFS[term.skillId]!
    const charged: BattleUnit = { ...acting, mp: Math.max(0, acting.mp - def.mp) }
    units[action.officerId] = charged
    const target = def.target === 'self' || !term.target ? undefined : unitAt(battle, term.target)
    const castAbility = effectiveOfficer(state, action.officerId).intelligence + acting.level + 5
    const targetResist = target
      ? effectiveOfficer(state, target.officerId).intelligence + target.level + 5
      : 0
    const [ok, rng2] = rollSkillSuccess(castAbility, targetResist, rng)
    rng = rng2
    if (ok) {
      const res = applyCastEffect(state, map, battle, units, charged, def, target, rng)
      weather = res.weather
      rng = res.rng
      playerProvisions = res.playerProvisions
      opponentProvisions = res.opponentProvisions
    }
  }

  const next: BattleState = { ...battle, weather, units, playerProvisions, opponentProvisions }
  const outcome = checkImmediateVictory(next, map)
  return { ...state, rng, activeBattle: outcome ? { ...next, outcome } : next }
}
