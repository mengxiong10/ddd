import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { Position } from '../shared/position'
import { samePos } from '../shared/position'
import type { CommandCheck } from '../shared/command'
import type { Rng } from '../shared/rng'
import { effectiveOfficer, effectiveTroopType } from '../world/queries'
import type { MapId, BattleMap } from './battle-map'
import {
  BATTLE_MAPS,
  MAX_DAYS,
  REDUCTION_TIER,
  DEFENSE_COEF_PCT,
  isCityTile,
  terrainAt,
} from './battle-map'
import {
  COUNTER_PCT,
  baseAttack,
  baseDefense,
  terrainAttack,
  terrainDefense,
  attackDamage,
  experienceGain,
  applyLevelUp,
  dailyFoodCost,
} from './battle-combat'
import { reachableTiles, attackableTiles, skillTargetTiles } from './battle-movement'
import { resolveCampaignOutcome } from './aftermath'
import { troopCapacity } from '../world/officer'
import type { Weather } from './battle-weather'
import { INITIAL_WEATHER, refreshWeather } from './battle-weather'
import type { BattleStatus } from './battle-status'
import { dailyStatusCheck, stoneDamage, canActWithStatus, canCastWithStatus } from './battle-status'
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
  initialMp,
} from './battle-skill'

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
 * 携带写回所需的来源 campaign 信息（攻守君主/目标城/随军粮草/出征武将）。
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
      readonly terminal:
        | { readonly kind: 'attack'; readonly target: Position }
        | { readonly kind: 'rest' }
        | { readonly kind: 'cast'; readonly skillId: SkillId; readonly target?: Position }
    }
  | { readonly type: 'endDay' }
  | { readonly type: 'retreat' }

/** 单次出征参战武将上限（与 economy/campaign 同步的量纲上限）。 */
const MAX_BATTLE_UNITS = 10

const aliveUnits = (battle: BattleState): BattleUnit[] =>
  Object.values(battle.units).filter((u) => u.status !== 'dead')
const unitAt = (battle: BattleState, p: Position): BattleUnit | undefined =>
  aliveUnits(battle).find((u) => samePos(u.pos, p))
const sideTroops = (battle: BattleState, side: BattleSide): number =>
  aliveUnits(battle)
    .filter((u) => u.side === side)
    .reduce((s, u) => s + u.troops, 0)
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
  provisions: number
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
      const eff = effectiveOfficer(state, id)
      const mp = initialMp(eff.intelligence, eff.force, o.level, o.stamina)
      units[id] = {
        officerId: id,
        side,
        pos: spawns[i] ?? spawns[spawns.length - 1]!,
        troops: o.troops,
        experience: o.experience,
        level: o.level,
        acted: false,
        mp,
        maxMp: mp,
        status: o.troops === 0 ? 'dead' : 'normal',
      }
    })
  }
  place(attackerIds, attackerSide, map.attackerSpawns)
  place(defenderIds, defenderSide, map.defenderSpawns)

  const cityFood = target.food
  return {
    mode,
    mapId: map.id,
    weather: INITIAL_WEATHER,
    day: 1,
    units,
    playerProvisions: mode === 'attack' ? provisions : cityFood,
    opponentProvisions: mode === 'attack' ? cityFood : provisions,
    commanderId: defenderIds[0] ?? '',
    outcome: null,
    attackerLord,
    defenderLord,
    targetCityId,
    provisions,
    officerIds: attackerIds,
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
  if (commander && commander.status === 'dead')
    return defenderSide === 'player' ? 'playerLose' : 'playerWin'
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
  ...state,
  activeBattle: { ...battle, outcome },
})

/**
 * 每日开头（§6.6，消耗 rng）：查 30 天上限 → 刷新天气 → 逐单位状态判定（石阵先损兵 1/8、可致死亡）
 * → 重置当日行动 → 胜负检查（石阵击溃即时胜负 + 日界粮草）。第 1 天由 turn 装好单位后调用、之后每 endDay 调用。
 * 要求 state.activeBattle 非空且 day 已就位（init=1 / endDay 已 +1）。
 */
export function startDay(state: GameState): GameState {
  const battle = state.activeBattle
  if (!battle || battle.outcome) return state
  // 1. 30 天上限优先（超时即结束，后续步骤略过）
  if (battle.day > MAX_DAYS) {
    return setOutcome(state, battle, battle.mode === 'attack' ? 'playerLose' : 'playerWin')
  }
  // 2. 刷新天气
  let rng = state.rng
  const [weather, rngW] = refreshWeather(rng)
  rng = rngW
  // 3. 逐单位（按 officerId 定序保确定性）状态判定 + 石阵损兵 + 重置 acted
  const units: Record<OfficerId, BattleUnit> = { ...battle.units }
  for (const id of Object.keys(units).sort()) {
    let u = units[id]!
    if (u.status !== 'dead') {
      if (u.status === 'stone') {
        const t = Math.max(0, u.troops - stoneDamage(u.troops))
        u = { ...u, troops: t, status: t === 0 ? 'dead' : u.status }
      }
      if (u.status !== 'dead') {
        const [ns, rngS] = dailyStatusCheck(u.status, effectiveOfficer(state, id).intelligence, rng)
        rng = rngS
        u = { ...u, status: ns }
      }
    }
    units[id] = { ...u, acted: false }
  }
  const advanced: BattleState = { ...battle, weather, units }
  // 4. 胜负：石阵击溃即时检查 + 日界粮草
  const map = BATTLE_MAPS[battle.mapId]!
  const outcome = checkImmediateVictory(advanced, map) ?? checkDayBoundaryVictory(advanced)
  return { ...state, rng, activeBattle: outcome ? { ...advanced, outcome } : advanced }
}

/** 校验一个战斗 action 是否合法（供 canApply 与 reduce 防御共用）。 */
export function canBattle(state: GameState, action: BattleAction): CommandCheck {
  const battle = state.activeBattle
  if (!battle) return { ok: false, reason: '无进行中的战斗' }
  if (battle.outcome) return { ok: false, reason: '战斗已结束' }
  if (action.type !== 'act') return { ok: true }

  const unit = battle.units[action.officerId]
  if (!unit || unit.status === 'dead') return { ok: false, reason: '单位不存在或已击溃' }
  if (unit.side !== 'player') return { ok: false, reason: '只能操作玩家方单位' }
  if (unit.acted) return { ok: false, reason: '该单位本日已行动' }
  if (!canActWithStatus(unit.status)) return { ok: false, reason: '混乱/石阵中，无法行动' }

  const map = BATTLE_MAPS[battle.mapId]!
  if (
    action.moveTo &&
    !reachableTiles(state, battle, action.officerId).some((p) => samePos(p, action.moveTo!))
  ) {
    return { ok: false, reason: '移动目标不可达' }
  }
  const from = action.moveTo ?? unit.pos
  if (action.terminal.kind === 'attack') {
    const target = action.terminal.target
    const troopType = effectiveTroopType(state, action.officerId)
    if (!attackableTiles(map, from, troopType).some((p) => samePos(p, target))) {
      return { ok: false, reason: '攻击目标超出范围' }
    }
    const enemy = unitAt(battle, target)
    if (!enemy || enemy.side === unit.side) return { ok: false, reason: '目标格无敌方单位' }
  }
  if (action.terminal.kind === 'cast') {
    return canCast(state, battle, map, unit, from, action.terminal)
  }
  return { ok: true }
}

/** 校验一次施法（供 canBattle）：禁咒/已掌握/MP/四关/范围/阵营。 */
function canCast(
  state: GameState,
  battle: BattleState,
  map: BattleMap,
  caster: BattleUnit,
  from: Position,
  term: { skillId: SkillId; target?: Position }
): CommandCheck {
  if (!canCastWithStatus(caster.status)) return { ok: false, reason: '禁咒中，无法施法' }
  const def: SkillDef | undefined = SKILL_DEFS[term.skillId]
  if (!def) return { ok: false, reason: '技能不存在' }
  const officer = state.officers[caster.officerId]!
  const isLord = officer.lordId === officer.id
  const avail = availableSkills(
    effectiveTroopType(state, caster.officerId),
    caster.level,
    officer.personalSkills,
    isLord
  )
  if (!avail.has(def.id)) return { ok: false, reason: '未掌握该技能' }
  if (caster.mp < def.mp) return { ok: false, reason: 'MP 不足' }
  const casterTerrain = terrainAt(map, from)
  if (def.target === 'self') {
    return skillGatesPass(def, battle.weather, casterTerrain)
      ? { ok: true }
      : { ok: false, reason: '天气/地形不允许' }
  }
  if (!term.target) return { ok: false, reason: '需选择目标' }
  if (!skillTargetTiles(map, from, def.id).some((p) => samePos(p, term.target!))) {
    return { ok: false, reason: '目标超出技能范围' }
  }
  const tu = unitAt(battle, term.target)
  if (!tu) return { ok: false, reason: '目标格无单位' }
  if (def.target === 'enemy' && tu.side === caster.side)
    return { ok: false, reason: '该技能须对敌方' }
  if (def.target === 'ally' && tu.side !== caster.side)
    return { ok: false, reason: '该技能须对友方' }
  const gate = skillGatesPass(def, battle.weather, casterTerrain, {
    terrain: terrainAt(map, tu.pos),
    troop: effectiveTroopType(state, tu.officerId),
  })
  return gate ? { ok: true } : { ok: false, reason: '天气/地形/兵种不允许' }
}

/** 计算一次普攻对目标的实际扣兵（吃有效武力/智力/兵种与双方脚下地形）。 */
function computeDamage(
  state: GameState,
  map: BattleMap,
  attacker: BattleUnit,
  defender: BattleUnit
): number {
  const atkType = effectiveTroopType(state, attacker.officerId)
  const defType = effectiveTroopType(state, defender.officerId)
  const atkForce = effectiveOfficer(state, attacker.officerId).force
  const defIntel = effectiveOfficer(state, defender.officerId).intelligence
  const atkTerrain = terrainAt(map, attacker.pos)
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

function applyAct(
  state: GameState,
  battle: BattleState,
  action: Extract<BattleAction, { type: 'act' }>
): GameState {
  if (!canBattle(state, action).ok) return state
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

/**
 * endDay：对手方行动（本切片 no-op）→ 双方扣当日粮草 → 进入下一天 → 交给 startDay
 * （刷新天气/状态判定/重置行动/日界与即时胜负）。
 */
function advanceDay(state: GameState, battle: BattleState): GameState {
  const playerProvisions = Math.max(
    0,
    battle.playerProvisions - dailyFoodCost(sideTroops(battle, 'player'))
  )
  const opponentProvisions = Math.max(
    0,
    battle.opponentProvisions - dailyFoodCost(sideTroops(battle, 'opponent'))
  )
  const advanced: BattleState = {
    ...battle,
    day: battle.day + 1,
    playerProvisions,
    opponentProvisions,
  }
  return startDay({ ...state, activeBattle: advanced })
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
 * 从 BattleState 组装 CampaignOutcome（attackerWins 由 mode+outcome、defenderIds 由 units.side、
 * mergedFood=双方剩余战场粮草之和），交 resolveCampaignOutcome 做完整战后处理；清空 activeBattle。
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
  const attackerWins =
    battle.mode === 'attack' ? battle.outcome === 'playerWin' : battle.outcome === 'playerLose'
  const defenderSide: BattleSide = battle.mode === 'attack' ? 'opponent' : 'player'
  const defenderIds = Object.values(battle.units)
    .filter((u) => u.side === defenderSide)
    .map((u) => u.officerId)
  const withTroops: GameState = { ...state, officers, activeBattle: null }
  return resolveCampaignOutcome(withTroops, {
    attackerWins,
    attackerLord: battle.attackerLord,
    defenderLord: battle.defenderLord,
    targetCityId: battle.targetCityId,
    attackerIds: battle.officerIds,
    defenderIds,
    mergedFood: battle.playerProvisions + battle.opponentProvisions,
  })
}
