import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import { withEvents, type WithEvents } from '../shared/outcome'
import type { Position } from '../shared/position'
import { effectiveOfficer, governorOf, defendingOfficers } from '../world/queries'
import type { BattleMap } from './battle-map'
import { BATTLE_MAPS, MAX_DAYS } from './battle-map'
import { dailyFoodCost } from './battle-combat'
import { resolveCampaignOutcome } from './aftermath'
import { INITIAL_WEATHER, refreshWeather } from './battle-weather'
import { dailyStatusCheck, stoneDamage } from './battle-status'
import { initialMp } from './battle-skill'
import type {
  BattleSide,
  BattleState,
  BattleUnit,
  BattleAction,
  BattleOutcome,
} from './battle-core'
import { sideTroops, checkImmediateVictory, canBattle, applyActResolved } from './battle-core'
import { nextOpponentAction } from './battle-ai'

/**
 * 战斗编排（`17-battle-ai` 起从核心机制中分出）：initBattle/startDay/reduceBattle/concludeBattle +
 * advanceDay 的对手方回合循环。import 核心 `battle-core` 与对手决策 `battle-ai`，并再导出核心符号，
 * 使外部 `from './military/battle'` 零改动。
 */
export type {
  BattleSide,
  BattleMode,
  BattleOutcome,
  BattleUnit,
  BattleState,
  BattleAction,
} from './battle-core'
export { canBattle, checkImmediateVictory } from './battle-core'

/** 单次出征参战武将上限（与 economy/campaign 同步的量纲上限）。 */
const MAX_BATTLE_UNITS = 10

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
  // TODO： 必选，把 AI选的 defenderIds 传进来，去掉 defendingOfficers 相关查询；
  explicitDefenderIds?: readonly OfficerId[]
): BattleState {
  const attackerLord = state.officers[officerIds[0]!]!.lordId!
  const target = state.cities[targetCityId]!
  const mode = attackerLord === state.playerLordId ? 'attack' : 'defend'
  const attackerSide: BattleSide = mode === 'attack' ? 'player' : 'opponent'
  const defenderSide: BattleSide = mode === 'attack' ? 'opponent' : 'player'
  const map: BattleMap = BATTLE_MAPS[target.battleMapId] ?? BATTLE_MAPS.plains!

  // 防守方：显式守军（玩家防守时 chooseDefenders 传入的已选子集，已 ⊆ defendingOfficers）或自动取
  // defendingOfficers(target)（在城·本势力·非俘虏·未被占用）。两路均「太守领衔（若在守军内）+ 其余兵力降序（平局 id 升序）」、限 10。
  const governor = governorOf(state, targetCityId)
  const pool = explicitDefenderIds
    ? explicitDefenderIds.map((id) => state.officers[id]!)
    : defendingOfficers(state, targetCityId)
  const governorLeads = governor && pool.some((o) => o.id === governor.id) ? [governor.id] : []
  const rest = pool
    .filter((o) => o.id !== governor?.id)
    .sort((a, b) => b.troops - a.troops || (a.id < b.id ? -1 : 1))
  const defenderIds = [...governorLeads, ...rest.map((o) => o.id)].slice(0, MAX_BATTLE_UNITS)
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
    attackerCommanderId: attackerIds[0] ?? 0,
    defenderCommanderId: defenderIds[0] ?? 0,
    outcome: null,
    targetCityId,
  }
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
  for (const id of Object.keys(units)
    .map(Number)
    .sort((a, b) => a - b)) {
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

/**
 * 对手方（AI）回合：循环「选将→决策（battle-ai）→应用（battle-core）」直到无可动 AI 单位
 * 或已分胜负。每步即时胜负在 applyActResolved 内检查。返回推进后的 state。
 */
function runOpponentTurn(state: GameState): GameState {
  let s = state
  // 兜底防御：单位数有限、每个被处理后置 acted，循环必终止；上限按单位数 ×2 守护。
  const guard = Object.keys(s.activeBattle?.units ?? {}).length * 2 + 1
  for (let i = 0; i < guard; i++) {
    const battle = s.activeBattle
    if (!battle || battle.outcome) break
    const decided = nextOpponentAction(s)
    if (!decided) break
    s = applyActResolved(decided.state, decided.state.activeBattle!, decided.action)
  }
  return s
}

/**
 * endDay：对手方（AI）行动 → 双方扣当日粮草 → 进入下一天 → 交给 startDay
 * （刷新天气/状态判定/重置行动/日界与即时胜负）。
 */
function advanceDay(state: GameState, battle: BattleState): GameState {
  const afterAi = runOpponentTurn({ ...state, activeBattle: battle })
  const b = afterAi.activeBattle!
  if (b.outcome) return afterAi // AI 行动已分胜负，交 resumeMonth 收尾
  const playerProvisions = Math.max(0, b.playerProvisions - dailyFoodCost(sideTroops(b, 'player')))
  const opponentProvisions = Math.max(
    0,
    b.opponentProvisions - dailyFoodCost(sideTroops(b, 'opponent'))
  )
  const advanced: BattleState = {
    ...b,
    day: b.day + 1,
    playerProvisions,
    opponentProvisions,
  }
  return startDay({ ...afterAi, activeBattle: advanced })
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
      return canBattle(state, action).ok ? applyActResolved(state, battle, action) : state
  }
}

/**
 * 分胜负后写回（不 import turn）：每单位 troops/experience/level 写回 Officer；
 * 从 BattleState 组装 CampaignOutcome（attackerWins 由 mode+outcome、攻/守名单由 units.side 派生、
 * attackerLord 由攻方单位 Officer.lordId 派生、mergedFood=双方剩余战场粮草之和），
 * 交 resolveCampaignOutcome 做完整战后处理；清空 activeBattle。
 * 要求 battle.outcome 非空。
 */
export function concludeBattle(state: GameState): WithEvents<GameState> {
  const battle = state.activeBattle
  if (!battle || !battle.outcome) return withEvents(state)

  const officers = { ...state.officers }
  for (const u of Object.values(battle.units)) {
    const o = officers[u.officerId]
    if (!o) continue
    officers[u.officerId] = { ...o, troops: u.troops, experience: u.experience, level: u.level }
  }
  const attackerWins =
    battle.mode === 'attack' ? battle.outcome === 'playerWin' : battle.outcome === 'playerLose'
  const attackerSide: BattleSide = battle.mode === 'attack' ? 'player' : 'opponent'
  const idsBySide = (side: BattleSide): OfficerId[] =>
    Object.values(battle.units)
      .filter((u) => u.side === side)
      .map((u) => u.officerId)
  const attackerIds = idsBySide(attackerSide)
  // 攻方君主 = 任一攻方单位对应 Officer 的 lordId（整场不变；占城前 officers 必含且必有主）。
  const attackerLord = officers[attackerIds[0]!]!.lordId!
  const withTroops: GameState = { ...state, officers, activeBattle: null }
  return resolveCampaignOutcome(withTroops, {
    attackerWins,
    attackerLord,
    targetCityId: battle.targetCityId,
    attackerIds,
    defenderIds: idsBySide(attackerSide === 'player' ? 'opponent' : 'player'),
    mergedFood: battle.playerProvisions + battle.opponentProvisions,
  })
}
