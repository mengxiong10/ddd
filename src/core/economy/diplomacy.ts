import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import {
  withEvents,
  commandOk,
  commandFail,
  type WithEvents,
  type WithCheck,
} from '../shared/outcome'
import type { Rng } from '../shared/rng'
import { randInt } from '../shared/rng'
import { spendGold } from '../world/city'
import { spendStamina, adjustLoyalty } from '../world/officer'
import { effectiveOfficer, isBusy, isCaptive, citiesOfLord, governorOf } from '../world/queries'

/**
 * 外交规则身份（内联常量，不入 config——皆为公式系数/阈值/概率/量纲）：
 * - ROLL_MAX：各关掷骰量纲 RandInt(0,99)。
 * - INTEL_SAFETY：离间/策反/劝降的智力差安全线 +50；招揽无安全线（=0）。
 * - 四张性格系数表（性格关 R < S 通过，S 即通过率百分比）：
 *   招揽/离间/策反按普通武将性格表（0忠义/1大志/2贪财/3怕死/4卤莽），
 *   劝降按君主性格表（0和平/1大义/2奸诈/3狂人/4冒进）。
 * - 招揽成功后忠诚 RandInt(40,79)；离间成功忠诚 −4（下限0）；劝降城池压制倍数 ×2。
 */
const ROLL_MAX = 99
const INTEL_SAFETY = 50
const ENTICE_COEFF: readonly number[] = [5, 20, 30, 40, 15]
const ALIENATE_COEFF: readonly number[] = [5, 30, 40, 30, 50]
const INSTIGATE_COEFF: readonly number[] = [5, 60, 20, 10, 30]
const INDUCE_COEFF: readonly number[] = [15, 5, 20, 1, 10]
const ENTICE_OK_LOYALTY_MIN = 40
const ENTICE_OK_LOYALTY_MAX = 79
const ALIENATE_LOYALTY_DROP = 4
const INDUCE_CITY_RATIO = 2

type DiplomacyType = 'entice' | 'alienate' | 'instigate' | 'induce'

/** 敌方在任非君主武将（招揽/离间目标）：存在、非在野(null)、非己方、非君主、非俘虏。 */
export function isEnemyServingNonLord(
  state: GameState,
  execLord: OfficerId | null,
  targetId: OfficerId
): boolean {
  const t = state.officers[targetId]
  if (!t) return false
  if (t.lordId === null) return false
  if (t.lordId === execLord) return false
  if (t.lordId === t.id) return false
  return !isCaptive(state, targetId)
}

/** 策反目标：敌方在任非君主武将，且恰为其所在城太守（君主驻该城时太守=君主 → 自动排除）。 */
export function isInstigateTarget(
  state: GameState,
  execLord: OfficerId | null,
  targetId: OfficerId
): boolean {
  if (!isEnemyServingNonLord(state, execLord, targetId)) return false
  const gov = governorOf(state, state.officers[targetId]!.cityId!)
  return gov !== null && gov.id === targetId
}

/** 共享前置：执行人在任（存在/未占用/非俘虏）+ 体力 ≥ 成本 + 本城金 ≥ 成本。不校验归属。 */
function checkExecutor(
  state: GameState,
  officerId: OfficerId,
  staminaCost: number,
  goldCost: number
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  if (isCaptive(state, officerId)) return { ok: false, reason: 'is-captive' }
  if (officer.stamina < staminaCost) return { ok: false, reason: 'stamina-insufficient' }
  const city = state.cities[officer.cityId!]
  if (!city) return { ok: false, reason: 'city-not-found' }
  if (city.gold < goldCost) return { ok: false, reason: 'gold-insufficient' }
  return { ok: true }
}

/** 下令通用：扣体力、扣本城金、入对应 pending 分支（占用由队列派生）；不动 RNG。调用方已校验。 */
function enqueueDiplomacy(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  staminaCost: number,
  goldCost: number,
  type: DiplomacyType
): GameState {
  const officer = state.officers[officerId]!
  const city = state.cities[officer.cityId!]!
  return {
    ...state,
    cities: { ...state.cities, [officer.cityId!]: spendGold(city, goldCost) },
    officers: { ...state.officers, [officerId]: spendStamina(officer, staminaCost) },
    pendingCommands: [...state.pendingCommands, { type, officerId, targetOfficerId }],
  }
}

/**
 * 招揽/离间/策反共用三关（智力差→忠诚→性格），按序消费 RNG，返回 [是否全过, 推进后 rng]。
 * 智力取 effectiveOfficer 有效值；忠诚读 target.loyalty raw（目标恒非君主）。
 * intelSafety：招揽 0、离间/策反 50。
 */
function runThreeGates(
  state: GameState,
  execId: OfficerId,
  targetId: OfficerId,
  intelSafety: number,
  coeff: readonly number[]
): readonly [passed: boolean, next: Rng] {
  const execIntel = effectiveOfficer(state, execId).intelligence
  const target = state.officers[targetId]!
  const targetIntel = effectiveOfficer(state, targetId).intelligence

  const [r1, rng1] = randInt(state.rng, 0, ROLL_MAX)
  if (r1 > execIntel - targetIntel + intelSafety) return [false, rng1]
  const [r2, rng2] = randInt(rng1, 0, ROLL_MAX)
  if (r2 < target.loyalty) return [false, rng2]
  const [r3, rng3] = randInt(rng2, 0, ROLL_MAX)
  return [r3 < coeff[target.personality]!, rng3]
}

// —— 招揽（Entice）——
export function canEntice(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): CommandCheck {
  const base = checkExecutor(state, officerId, config.enticeStaminaCost, config.enticeGoldCost)
  if (!base.ok) return base
  if (!isEnemyServingNonLord(state, state.officers[officerId]!.lordId, targetOfficerId))
    return { ok: false, reason: 'target-not-enemy-officer' }
  return { ok: true }
}

/** 下令招揽：扣体力/城金、busy、入队 {entice}；不动 RNG。非法 no-op。 */
export function entice(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): WithCheck<GameState> {
  const check = canEntice(state, officerId, targetOfficerId, config)
  if (!check.ok) return commandFail(check, state)
  return commandOk(
    enqueueDiplomacy(
      state,
      officerId,
      targetOfficerId,
      config.enticeStaminaCost,
      config.enticeGoldCost,
      'entice'
    )
  )
}

/**
 * 月末执行招揽（turn 分派）：三关（安全线0, ENTICE_COEFF）；成功则目标迁入执行人城、归执行人君主、忠诚 RandInt(40,79)。
 * 守卫：目标已非合法（不存在/已易主/已俘获/已为君主）→ 原样返回、不动 RNG。
 */
export function executeEntice(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId
): WithEvents<GameState> {
  const officer = state.officers[officerId]
  if (!officer || !isEnemyServingNonLord(state, officer.lordId, targetOfficerId))
    return withEvents(state)
  const result = (s: GameState, success: boolean): WithEvents<GameState> =>
    withEvents(s, [
      { kind: 'diplomacy-result', command: 'entice', officerId, targetOfficerId, success },
    ])

  const [passed, rng] = runThreeGates(state, officerId, targetOfficerId, 0, ENTICE_COEFF)
  if (!passed) return result({ ...state, rng }, false)

  const [loyalty, rng2] = randInt(rng, ENTICE_OK_LOYALTY_MIN, ENTICE_OK_LOYALTY_MAX)
  const target = {
    ...state.officers[targetOfficerId]!,
    cityId: officer.cityId!,
    lordId: officer.lordId,
    loyalty,
  }
  return result(
    { ...state, rng: rng2, officers: { ...state.officers, [targetOfficerId]: target } },
    true
  )
}

// —— 离间（Alienate）——
export function canAlienate(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): CommandCheck {
  const base = checkExecutor(state, officerId, config.alienateStaminaCost, config.alienateGoldCost)
  if (!base.ok) return base
  if (!isEnemyServingNonLord(state, state.officers[officerId]!.lordId, targetOfficerId))
    return { ok: false, reason: 'target-not-enemy-officer' }
  return { ok: true }
}

/** 下令离间：扣体力/城金、busy、入队 {alienate}；不动 RNG。非法 no-op。 */
export function alienate(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): WithCheck<GameState> {
  const check = canAlienate(state, officerId, targetOfficerId, config)
  if (!check.ok) return commandFail(check, state)
  return commandOk(
    enqueueDiplomacy(
      state,
      officerId,
      targetOfficerId,
      config.alienateStaminaCost,
      config.alienateGoldCost,
      'alienate'
    )
  )
}

/** 月末执行离间：三关（安全线50, ALIENATE_COEFF）；成功仅目标忠诚 −4（下限0），无成功 RNG。守卫同招揽。 */
export function executeAlienate(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId
): WithEvents<GameState> {
  const officer = state.officers[officerId]
  if (!officer || !isEnemyServingNonLord(state, officer.lordId, targetOfficerId))
    return withEvents(state)
  const result = (s: GameState, success: boolean): WithEvents<GameState> =>
    withEvents(s, [
      { kind: 'diplomacy-result', command: 'alienate', officerId, targetOfficerId, success },
    ])

  const [passed, rng] = runThreeGates(
    state,
    officerId,
    targetOfficerId,
    INTEL_SAFETY,
    ALIENATE_COEFF
  )
  if (!passed) return result({ ...state, rng }, false)

  const target = adjustLoyalty(state.officers[targetOfficerId]!, -ALIENATE_LOYALTY_DROP)
  return result({ ...state, rng, officers: { ...state.officers, [targetOfficerId]: target } }, true)
}

// —— 策反（Instigate）——
export function canInstigate(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): CommandCheck {
  const base = checkExecutor(
    state,
    officerId,
    config.instigateStaminaCost,
    config.instigateGoldCost
  )
  if (!base.ok) return base
  if (!isInstigateTarget(state, state.officers[officerId]!.lordId, targetOfficerId))
    return { ok: false, reason: 'target-not-enemy-governor' }
  return { ok: true }
}

/** 下令策反：扣体力/城金、busy、入队 {instigate}；不动 RNG。非法 no-op。 */
export function instigate(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): WithCheck<GameState> {
  const check = canInstigate(state, officerId, targetOfficerId, config)
  if (!check.ok) return commandFail(check, state)
  return commandOk(
    enqueueDiplomacy(
      state,
      officerId,
      targetOfficerId,
      config.instigateStaminaCost,
      config.instigateGoldCost,
      'instigate'
    )
  )
}

/**
 * 月末执行策反：三关（安全线50, INSTIGATE_COEFF）；成功则目标自立为君——
 * 目标 lordId=自身、其城 lordId=自身、该城原势力其余武将改归目标（第三方俘虏不动）。
 * 因君主即太守不可策反，分裂城不含原君主 → 不触发重选君主。守卫同招揽（须仍为太守）。
 */
export function executeInstigate(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId
): WithEvents<GameState> {
  const officer = state.officers[officerId]
  if (!officer || !isInstigateTarget(state, officer.lordId, targetOfficerId))
    return withEvents(state)

  const [passed, rng] = runThreeGates(
    state,
    officerId,
    targetOfficerId,
    INTEL_SAFETY,
    INSTIGATE_COEFF
  )
  if (!passed)
    return withEvents({ ...state, rng }, [
      {
        kind: 'diplomacy-result',
        command: 'instigate',
        officerId,
        targetOfficerId,
        success: false,
      },
    ])

  const target = state.officers[targetOfficerId]!
  const oldLord = target.lordId
  const cityId = target.cityId!
  const officers = { ...state.officers }
  for (const o of Object.values(state.officers)) {
    if (o.cityId === cityId && o.lordId === oldLord)
      officers[o.id] = { ...o, lordId: targetOfficerId }
  }
  const cities = {
    ...state.cities,
    [cityId]: { ...state.cities[cityId]!, lordId: targetOfficerId },
  }
  return withEvents({ ...state, rng, officers, cities }, [
    { kind: 'diplomacy-result', command: 'instigate', officerId, targetOfficerId, success: true },
    { kind: 'lord-instigated', officerId: targetOfficerId, fromLordId: oldLord! },
  ])
}

// —— 劝降（Induce）——
export function canInduce(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): CommandCheck {
  const base = checkExecutor(state, officerId, config.induceStaminaCost, config.induceGoldCost)
  if (!base.ok) return base
  const officer = state.officers[officerId]!
  const target = state.officers[targetOfficerId]
  if (!target) return { ok: false, reason: 'target-not-found' }
  if (target.lordId !== target.id || isCaptive(state, targetOfficerId))
    return { ok: false, reason: 'target-not-enemy-lord' }
  if (target.lordId === officer.lordId) return { ok: false, reason: 'cannot-induce-own-lord' }
  if (
    citiesOfLord(state, officer.lordId!).length <
    citiesOfLord(state, target.id).length * INDUCE_CITY_RATIO
  )
    return { ok: false, reason: 'city-power-insufficient' }
  return { ok: true }
}

/** 下令劝降：扣体力/城金、busy、入队 {induce}；不动 RNG。非法 no-op。 */
export function induce(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): WithCheck<GameState> {
  const check = canInduce(state, officerId, targetOfficerId, config)
  if (!check.ok) return commandFail(check, state)
  return commandOk(
    enqueueDiplomacy(
      state,
      officerId,
      targetOfficerId,
      config.induceStaminaCost,
      config.induceGoldCost,
      'induce'
    )
  )
}

/**
 * 月末执行劝降：①目标=玩家君主直接失败（无 RNG，游戏规则非归属校验）②城池压制重校
 * ③智力差关（安全线50）④君主性格关（INDUCE_COEFF）。成功则整体吸收：
 * 目标君主全部城与城内臣属（含君主本人）归执行人君主、其散落（不在其城内）武将转在野（lordId=null）。
 * 先按原势力快照算城集与待迁武将再写回。守卫：目标已非敌方君主 → 原样返回、不动 RNG。
 */
export function executeInduce(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId
): WithEvents<GameState> {
  const officer = state.officers[officerId]
  if (!officer) return withEvents(state)
  const target = state.officers[targetOfficerId]
  if (
    !target ||
    target.lordId !== target.id ||
    target.lordId === officer.lordId ||
    isCaptive(state, targetOfficerId)
  )
    return withEvents(state)
  const fail = (s: GameState): WithEvents<GameState> =>
    withEvents(s, [
      { kind: 'diplomacy-result', command: 'induce', officerId, targetOfficerId, success: false },
    ])

  // ① 玩家君主免疫（防 AI 劝降玩家君主）
  if (target.id === state.playerLordId) return fail(state)

  const execLord = officer.lordId!
  const targetLord = target.id
  // ② 城池压制重校
  if (
    citiesOfLord(state, execLord).length <
    citiesOfLord(state, targetLord).length * INDUCE_CITY_RATIO
  )
    return fail(state)

  // ③ 智力差关
  const [r1, rng1] = randInt(state.rng, 0, ROLL_MAX)
  const execIntel = effectiveOfficer(state, officerId).intelligence
  const targetIntel = effectiveOfficer(state, targetOfficerId).intelligence
  if (r1 > execIntel - targetIntel + INTEL_SAFETY) return fail({ ...state, rng: rng1 })

  // ④ 君主性格关
  const [r2, rng2] = randInt(rng1, 0, ROLL_MAX)
  if (r2 >= INDUCE_COEFF[target.personality]!) return fail({ ...state, rng: rng2 })

  // 成功：按原势力快照吸收
  const cityIdSet = new Set(citiesOfLord(state, targetLord).map((c) => c.id))
  const cities = { ...state.cities }
  for (const id of cityIdSet) cities[id] = { ...cities[id]!, lordId: execLord }
  const officers = { ...state.officers }
  for (const o of Object.values(state.officers)) {
    if (o.lordId === targetLord)
      officers[o.id] = {
        ...o,
        lordId: o.cityId !== null && cityIdSet.has(o.cityId) ? execLord : null,
      }
  }
  return withEvents({ ...state, rng: rng2, officers, cities }, [
    { kind: 'diplomacy-result', command: 'induce', officerId, targetOfficerId, success: true },
    { kind: 'lord-surrendered', fromLordId: targetLord, toLordId: execLord },
  ])
}
