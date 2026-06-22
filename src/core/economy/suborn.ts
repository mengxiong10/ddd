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
import { spendGold } from '../world/city'
import { spendStamina } from '../world/officer'
import { effectiveOfficer, isBusy, isCaptive } from '../world/queries'
import { randInt } from '../shared/rng'

/**
 * 招降规则身份（内联常量，不入 config）：
 * - 智力差安全线：阈值 = 执行人有效智力 − 目标有效智力 + 50。
 * - 性格招降系数 S（按目标普通武将性格 0..4 取）：0忠义1 / 1大志3 / 2贪财4 / 3怕死5 / 4卤莽2。
 *   S 越大终判失败阈值越小、越易招降。
 * - 降忠诚门槛 60：降之前忠诚 > 60 直接失败。
 * - 降忠诚扣减 = floor(L0/10)（智力关通过后恒扣、持久化）。
 * - 成功后忠诚 RandInt(40,79)。
 */
const SUBORN_INTEL_SAFETY = 50
const SUBORN_COEFF: readonly number[] = [1, 3, 4, 5, 2]
const SUBORN_LOYALTY_GATE = 60
const SUBORN_LOYALTY_DROP_DIV = 10
const SUBORN_OK_LOYALTY_MIN = 40
const SUBORN_OK_LOYALTY_MAX = 79
/** 智力关/终判掷骰量纲：RandInt(0, 99)。 */
const ROLL_MAX = 99

/**
 * 校验招降前置（不修改状态）。本城 = 执行人所在城（officer.cityId!）。
 * 执行人存在且未占用 → captiveId 为本城俘虏 → 体力 ≥ subornStaminaCost → 城金 ≥ subornGoldCost。
 */
export function canSuborn(
  state: GameState,
  officerId: OfficerId,
  captiveId: OfficerId,
  config: GameConfig
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  const captive = state.officers[captiveId]
  if (!captive) return { ok: false, reason: 'captive-not-found' }
  if (captive.cityId !== officer.cityId!) return { ok: false, reason: 'captive-not-in-city' }
  if (!isCaptive(state, captiveId)) return { ok: false, reason: 'target-not-captive' }
  if (officer.stamina < config.subornStaminaCost)
    return { ok: false, reason: 'stamina-insufficient' }
  const city = state.cities[officer.cityId!]
  if (!city) return { ok: false, reason: 'city-not-found' }
  if (city.gold < config.subornGoldCost) return { ok: false, reason: 'gold-insufficient' }
  return { ok: true }
}

/**
 * 下令招降：效果延到月末（见 executeSuborn）。下令当下扣执行人体力、扣本城金、入队（占用由队列派生），不动 RNG。
 * 前置不满足时为 no-op，原样返回 state。
 */
export function suborn(
  state: GameState,
  officerId: OfficerId,
  captiveId: OfficerId,
  config: GameConfig
): WithCheck<GameState> {
  const check = canSuborn(state, officerId, captiveId, config)
  if (!check.ok) return commandFail(check, state)

  const officer = state.officers[officerId]!
  const city = state.cities[officer.cityId!]!
  const nextOfficer = spendStamina(officer, config.subornStaminaCost)
  const nextCity = spendGold(city, config.subornGoldCost)

  return commandOk({
    ...state,
    cities: { ...state.cities, [officer.cityId!]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
    pendingCommands: [...state.pendingCommands, { type: 'suborn', officerId, captiveId }],
  })
}

/**
 * 月末单条执行招降（供 turn 层按 type 分派）：四关判定，消耗并写回 state.rng。
 * 智力取 effectiveOfficer 有效值；忠诚读 captive.loyalty raw（被俘君主按其 raw 忠诚处理）。
 * 守卫：目标缺失或已非俘虏（同月已被另一招降/处斩）→ 原样返回、不动 RNG。
 *
 * RNG 调用次序（锁定，保可复现）：
 * 1. R1 = RandInt(0,99) 智力差关；R1 > 阈值 → 失败（仅消耗 R1、忠诚不变）。
 * 2. 降忠诚（持久化）：drop = floor(L0/10)，写回 loyalty = L0 − drop；L0 > 60 → 失败（不掷 R2）。
 * 3. R2 = RandInt(0,99) 终判；R2 < floor((L0−drop)/S) → 失败，否则成功。
 * 4. 成功：captive.lordId = 执行人君主；R3 = RandInt(40,79) 写 loyalty。
 */
export function executeSuborn(
  state: GameState,
  officerId: OfficerId,
  captiveId: OfficerId
): WithEvents<GameState> {
  const officer = state.officers[officerId]
  if (!officer || !state.officers[captiveId] || !isCaptive(state, captiveId))
    return withEvents(state)

  const fail = (s: GameState): WithEvents<GameState> =>
    withEvents(s, [{ kind: 'suborn-result', officerId, captiveId, success: false }])

  const execIntel = effectiveOfficer(state, officerId).intelligence
  const targetIntel = effectiveOfficer(state, captiveId).intelligence

  // 1. 智力差关
  const [r1, rng1] = randInt(state.rng, 0, ROLL_MAX)
  const threshold = execIntel - targetIntel + SUBORN_INTEL_SAFETY
  if (r1 > threshold) return fail({ ...state, rng: rng1 })

  // 2. 降忠诚（持久化）
  const captive = state.officers[captiveId]!
  const l0 = captive.loyalty
  const drop = Math.floor(l0 / SUBORN_LOYALTY_DROP_DIV)
  const loweredLoyalty = l0 - drop
  const lowered = { ...captive, loyalty: loweredLoyalty }
  const afterDrop: GameState = {
    ...state,
    rng: rng1,
    officers: { ...state.officers, [captiveId]: lowered },
  }
  if (l0 > SUBORN_LOYALTY_GATE) return fail(afterDrop)

  // 3. 终判
  const s = SUBORN_COEFF[captive.personality]!
  const [r2, rng2] = randInt(rng1, 0, ROLL_MAX)
  const failThreshold = Math.floor(loweredLoyalty / s)
  if (r2 < failThreshold) return fail({ ...afterDrop, rng: rng2 })

  // 4. 成功：归己 + 重置忠诚
  const [okLoyalty, rng3] = randInt(rng2, SUBORN_OK_LOYALTY_MIN, SUBORN_OK_LOYALTY_MAX)
  const won = { ...lowered, lordId: officer.lordId, loyalty: okLoyalty }
  return withEvents(
    { ...afterDrop, rng: rng3, officers: { ...afterDrop.officers, [captiveId]: won } },
    [{ kind: 'suborn-result', officerId, captiveId, success: true }]
  )
}
