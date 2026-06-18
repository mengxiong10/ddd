import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { Position } from '../shared/position'
import { samePos } from '../shared/position'
import type { CommandCheck } from '../shared/command'
import { effectiveOfficer, effectiveTroopType } from '../world/queries'
import type { MapId, BattleMap } from './battle-map'
import {
  BATTLE_MAPS, MAX_DAYS, REDUCTION_TIER, DEFENSE_COEF_PCT, isCityTile, terrainAt,
} from './battle-map'
import {
  COUNTER_PCT, baseAttack, baseDefense, terrainAttack, terrainDefense,
  attackDamage, experienceGain, applyLevelUp, dailyFoodCost,
} from './battle-combat'
import { reachableTiles, attackableTiles } from './battle-movement'
import { resolveCampaignOutcome } from './campaign'

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
  /** 战中当前兵力；归零即击溃。 */
  readonly troops: number
  /** 经验快照（战中累积）。 */
  readonly experience: number
  /** 等级快照（战中可升级）。 */
  readonly level: number
  /** 本日是否已行动（每日刷新）。 */
  readonly acted: boolean
  /** 是否击溃（troops===0）。 */
  readonly routed: boolean
}

/**
 * 战斗子状态：月末遇玩家 campaign 时挂在 GameState.activeBattle。
 * 携带写回所需的来源 campaign 信息（攻守君主/目标城/随军粮草/出征武将）。
 */
export interface BattleState {
  readonly mode: BattleMode
  readonly mapId: MapId
  /** 当前天数，从 1 起，封顶 MAX_DAYS。 */
  readonly day: number
  /** 全部参战单位，按 officerId 索引。 */
  readonly units: Readonly<Record<OfficerId, BattleUnit>>
  /** 玩家方 / 对手方战场粮草。 */
  readonly playerProvisions: number
  readonly opponentProvisions: number
  /** 主将 = 防守方第一名有效武将；被击溃立即触发胜负。 */
  readonly commanderId: OfficerId
  /** 战斗结果；null=进行中。 */
  readonly outcome: BattleOutcome | null
  // —— 写回用的来源 campaign 信息 ——
  readonly attackerLord: OfficerId
  readonly defenderLord: OfficerId
  readonly targetCityId: CityId
  /** 随军粮草（胜利并入被占城，复用 04 resolveCampaignOutcome）。 */
  readonly provisions: number
  /** 出征武将（攻方），写回 cityId 用。 */
  readonly officerIds: readonly OfficerId[]
}

/**
 * 战斗专属 action（经 game.apply 的 {type:'battle', action} 包装分派）。
 * - act：可选移动 + 一个终结动作（攻击/休息），结束该单位本日行动。
 * - endDay：对手方行动（本切片 no-op）→ 双方扣当日粮草 → 进入下一天。
 * - retreat：玩家全军撤退 → 玩家方失败。
 */
export type BattleAction =
  | {
      readonly type: 'act'
      readonly officerId: OfficerId
      readonly moveTo?: Position
      readonly terminal: { readonly kind: 'attack'; readonly target: Position } | { readonly kind: 'rest' }
    }
  | { readonly type: 'endDay' }
  | { readonly type: 'retreat' }

/** 单次出征参战武将上限（与 economy/campaign 同步的量纲上限）。 */
const MAX_BATTLE_UNITS = 10

const aliveUnits = (battle: BattleState): BattleUnit[] => Object.values(battle.units).filter((u) => !u.routed)
const unitAt = (battle: BattleState, p: Position): BattleUnit | undefined =>
  aliveUnits(battle).find((u) => samePos(u.pos, p))
const sideTroops = (battle: BattleState, side: BattleSide): number =>
  aliveUnits(battle).filter((u) => u.side === side).reduce((s, u) => s + u.troops, 0)
const sideAlive = (battle: BattleState, side: BattleSide): boolean =>
  aliveUnits(battle).some((u) => u.side === side)

/**
 * 从一条玩家 campaign 初始化战斗：读目标城地图、按攻守模式摆双方单位（≤10/方）、
 * 算战场粮草（攻=随军粮草、守=目标城开战快照城粮）、定主将（防守方第一名）、day=1。
 * 调用方保证玩家参与（攻或守一方为 playerLordId）。
 */
export function initBattle(
  state: GameState,
  officerIds: readonly OfficerId[],
  targetCityId: CityId,
  provisions: number,
): BattleState {
  const attackerLord = state.officers[officerIds[0]!]!.lordId!
  const target = state.cities[targetCityId]!
  const defenderLord = target.lordId
  const mode: BattleMode = attackerLord === state.playerLordId ? 'attack' : 'defend'
  const attackerSide: BattleSide = mode === 'attack' ? 'player' : 'opponent'
  const defenderSide: BattleSide = mode === 'attack' ? 'opponent' : 'player'
  const map: BattleMap = BATTLE_MAPS[target.battleMapId] ?? BATTLE_MAPS.plains!

  // 防守方 = 目标城归属方在城武将（自动排除俘虏/在野），按 id 定序、限 10。
  const defenderIds = Object.values(state.officers)
    .filter((o) => o.cityId === targetCityId && o.lordId === defenderLord)
    .map((o) => o.id)
    .sort()
    .slice(0, MAX_BATTLE_UNITS)
  const attackerIds = officerIds.slice(0, MAX_BATTLE_UNITS)

  const units: Record<OfficerId, BattleUnit> = {}
  const place = (ids: readonly OfficerId[], side: BattleSide, spawns: readonly Position[]) => {
    ids.forEach((id, i) => {
      const o = state.officers[id]!
      units[id] = {
        officerId: id, side, pos: spawns[i] ?? spawns[spawns.length - 1]!,
        troops: o.troops, experience: o.experience, level: o.level,
        acted: false, routed: o.troops === 0,
      }
    })
  }
  place(attackerIds, attackerSide, map.attackerSpawns)
  place(defenderIds, defenderSide, map.defenderSpawns)

  const cityFood = target.food
  return {
    mode, mapId: map.id, day: 1, units,
    playerProvisions: mode === 'attack' ? provisions : cityFood,
    opponentProvisions: mode === 'attack' ? cityFood : provisions,
    commanderId: defenderIds[0] ?? '',
    outcome: null,
    attackerLord, defenderLord, targetCityId, provisions, officerIds: attackerIds,
  }
}

/** 即时胜负检查（每次 act 后）：城池格 / 主将击溃 / 全灭。无则 null。 */
export function checkImmediateVictory(battle: BattleState, map: BattleMap): BattleOutcome | null {
  const defenderSide: BattleSide = battle.mode === 'attack' ? 'opponent' : 'player'
  // 城池格：进攻方=玩家进城胜；防守方=对手进城败
  for (const u of aliveUnits(battle)) {
    if (!isCityTile(map, u.pos)) continue
    if (battle.mode === 'attack' && u.side === 'player') return 'playerWin'
    if (battle.mode === 'defend' && u.side === 'opponent') return 'playerLose'
  }
  // 主将（防守方第一名）被击溃 → 防守方负
  const commander = battle.units[battle.commanderId]
  if (commander && commander.routed) return defenderSide === 'player' ? 'playerLose' : 'playerWin'
  // 全灭 → 另一方胜
  if (!sideAlive(battle, 'player')) return 'playerLose'
  if (!sideAlive(battle, 'opponent')) return 'playerWin'
  return null
}

/** 日界胜负检查（进入新一天时）：30 天上限优先于粮草；同日双方粮草归零判玩家败。 */
function checkDayBoundaryVictory(battle: BattleState): BattleOutcome | null {
  if (battle.day > MAX_DAYS) return battle.mode === 'attack' ? 'playerLose' : 'playerWin'
  if (battle.playerProvisions <= 0) return 'playerLose'
  if (battle.opponentProvisions <= 0) return 'playerWin'
  return null
}

const setOutcome = (state: GameState, battle: BattleState, outcome: BattleOutcome): GameState => ({
  ...state, activeBattle: { ...battle, outcome },
})

/** 校验一个战斗 action 是否合法（供 canApply 与 reduce 防御共用）。 */
export function canBattle(state: GameState, action: BattleAction): CommandCheck {
  const battle = state.activeBattle
  if (!battle) return { ok: false, reason: '无进行中的战斗' }
  if (battle.outcome) return { ok: false, reason: '战斗已结束' }
  if (action.type !== 'act') return { ok: true }

  const unit = battle.units[action.officerId]
  if (!unit || unit.routed) return { ok: false, reason: '单位不存在或已击溃' }
  if (unit.side !== 'player') return { ok: false, reason: '只能操作玩家方单位' }
  if (unit.acted) return { ok: false, reason: '该单位本日已行动' }

  const map = BATTLE_MAPS[battle.mapId]!
  if (action.moveTo && !reachableTiles(state, battle, action.officerId).some((p) => samePos(p, action.moveTo!))) {
    return { ok: false, reason: '移动目标不可达' }
  }
  if (action.terminal.kind === 'attack') {
    const from = action.moveTo ?? unit.pos
    const target = action.terminal.target
    const troopType = effectiveTroopType(state, action.officerId)
    if (!attackableTiles(map, from, troopType).some((p) => samePos(p, target))) {
      return { ok: false, reason: '攻击目标超出范围' }
    }
    const enemy = unitAt(battle, target)
    if (!enemy || enemy.side === unit.side) return { ok: false, reason: '目标格无敌方单位' }
  }
  return { ok: true }
}

/** 计算一次普攻对目标的实际扣兵（吃有效武力/智力/兵种与双方脚下地形）。 */
function computeDamage(
  state: GameState, map: BattleMap, attacker: BattleUnit, defender: BattleUnit,
): number {
  const atkType = effectiveTroopType(state, attacker.officerId)
  const defType = effectiveTroopType(state, defender.officerId)
  const atkForce = effectiveOfficer(state, attacker.officerId).force
  const defIntel = effectiveOfficer(state, defender.officerId).intelligence
  const atkTerrain = terrainAt(map, attacker.pos)
  const defTerrain = terrainAt(map, defender.pos)
  const atkPower = terrainAttack(baseAttack(atkForce, attacker.level, atkType), REDUCTION_TIER[atkType][atkTerrain])
  const defPower = terrainDefense(
    baseDefense(defIntel, defender.level, defType), REDUCTION_TIER[defType][defTerrain], DEFENSE_COEF_PCT[defTerrain],
  )
  return attackDamage(atkPower, defPower, attacker.troops, COUNTER_PCT[atkType][defType], defender.troops)
}

function applyAct(
  state: GameState, battle: BattleState,
  action: Extract<BattleAction, { type: 'act' }>,
): GameState {
  if (!canBattle(state, action).ok) return state
  const map = BATTLE_MAPS[battle.mapId]!
  const units = { ...battle.units }
  const actor = units[action.officerId]!
  const pos = action.moveTo ?? actor.pos
  let acting: BattleUnit = { ...actor, pos, acted: true }

  if (action.terminal.kind === 'attack') {
    const defender = unitAt(battle, action.terminal.target)!
    const dmg = computeDamage(state, map, acting, defender)
    const newTroops = defender.troops - dmg
    const routed = newTroops <= 0
    units[defender.officerId] = { ...defender, troops: Math.max(0, newTroops), routed }
    const expAfter = acting.experience + experienceGain(dmg, acting.level, defender.level, routed)
    const leveled = applyLevelUp(acting.level, expAfter)
    acting = { ...acting, level: leveled.level, experience: leveled.experience }
  }
  units[action.officerId] = acting

  const next: BattleState = { ...battle, units }
  const outcome = checkImmediateVictory(next, map)
  return { ...state, activeBattle: outcome ? { ...next, outcome } : next }
}

/** endDay：对手方行动（本切片 no-op）→ 双方扣当日粮草 → 进入下一天 → 日界胜负 + 刷新行动。 */
function advanceDay(state: GameState, battle: BattleState): GameState {
  const playerProvisions = Math.max(0, battle.playerProvisions - dailyFoodCost(sideTroops(battle, 'player')))
  const opponentProvisions = Math.max(0, battle.opponentProvisions - dailyFoodCost(sideTroops(battle, 'opponent')))
  const day = battle.day + 1
  const units = Object.fromEntries(
    Object.entries(battle.units).map(([id, u]) => [id, { ...u, acted: false }]),
  )
  const advanced: BattleState = { ...battle, day, playerProvisions, opponentProvisions, units }
  const outcome = checkDayBoundaryVictory(advanced)
  return { ...state, activeBattle: outcome ? { ...advanced, outcome } : advanced }
}

/** 战斗 reducer（纯）：非法 no-op；活动战斗已结束亦 no-op。 */
export function reduceBattle(state: GameState, action: BattleAction): GameState {
  const battle = state.activeBattle
  if (!battle || battle.outcome) return state
  switch (action.type) {
    case 'retreat':
      return setOutcome(state, battle, 'playerLose')
    case 'endDay':
      return advanceDay(state, battle)
    case 'act':
      return applyAct(state, battle, action)
  }
}

/**
 * 分胜负后写回（不 import turn）：每单位 troops/experience/level 写回 Officer；
 * 据 mode+outcome 求 attackerWins，复用 resolveCampaignOutcome 做占城/俘虏/重选君主；清空 activeBattle。
 * 要求 battle.outcome 非空。
 */
export function concludeBattle(state: GameState): GameState {
  const battle = state.activeBattle
  if (!battle || !battle.outcome) return state

  const officers = { ...state.officers }
  for (const u of Object.values(battle.units)) {
    const o = officers[u.officerId]
    if (!o) continue
    officers[u.officerId] = { ...o, troops: u.troops, experience: u.experience, level: u.level }
  }
  const attackerWins = battle.mode === 'attack' ? battle.outcome === 'playerWin' : battle.outcome === 'playerLose'
  const withTroops: GameState = { ...state, officers, activeBattle: null }
  return resolveCampaignOutcome(withTroops, battle.officerIds, battle.targetCityId, battle.provisions, attackerWins)
}
