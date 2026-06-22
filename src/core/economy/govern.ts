import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import { commandOk, commandFail, type WithCheck } from '../shared/outcome'
import { randInt } from '../shared/rng'
import { DISASTER_PREVENTION_MAX, raisePrevention, setStatus, spendGold } from '../world/city'
import { spendStamina } from '../world/officer'
import { isBusy } from '../world/queries'

/**
 * 治理防灾增量（规则身份，内联常量，不入 config）：
 * 防灾 += RandInt(GOVERN_PREVENTION_RAND_MIN, GOVERN_PREVENTION_RAND_MAX)（封顶 DISASTER_PREVENTION_MAX）。
 */
const GOVERN_PREVENTION_RAND_MIN = 1
const GOVERN_PREVENTION_RAND_MAX = 4

/**
 * 校验治理前置条件（不修改状态）。作用城 = 武将所在城（officer.cityId!）。
 * 武将存在、未占用、非俘虏 → 本城金 ≥ governGoldCost → 体力 ≥ governStaminaCost
 * → 非「已正常且防灾已满」（避免浪费；异常城即使防灾满仍可治理清灾）。
 */
export function canGovern(
  state: GameState,
  officerId: OfficerId,
  config: GameConfig
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  const city = state.cities[officer.cityId!]
  if (!city) return { ok: false, reason: 'city-not-found' }
  if (officer.lordId !== city.lordId) return { ok: false, reason: 'is-captive' }
  if (city.gold < config.governGoldCost) return { ok: false, reason: 'gold-insufficient' }
  if (officer.stamina < config.governStaminaCost)
    return { ok: false, reason: 'stamina-insufficient' }
  if (city.status === 'normal' && city.disasterPrevention >= DISASTER_PREVENTION_MAX) {
    return { ok: false, reason: 'prevention-capped' }
  }
  return { ok: true }
}

/**
 * 执行治理：效果在下令当下立即结算（清异常状态 + 防灾回升 + 扣金扣体力 + 推进 RNG）。
 * 占用武将由入队 govern 命令派生（queries.isBusy），出队即释放；月末分支无效果。
 * 前置条件不满足时为 no-op，原样返回 state。
 */
export function govern(
  state: GameState,
  officerId: OfficerId,
  config: GameConfig
): WithCheck<GameState> {
  const check = canGovern(state, officerId, config)
  if (!check.ok) return commandFail(check, state)

  const officer = state.officers[officerId]!
  const city = state.cities[officer.cityId!]!
  const [preventionGain, nextRng] = randInt(
    state.rng,
    GOVERN_PREVENTION_RAND_MIN,
    GOVERN_PREVENTION_RAND_MAX
  )

  const nextCity = spendGold(
    raisePrevention(setStatus(city, 'normal'), preventionGain),
    config.governGoldCost
  )
  const nextOfficer = spendStamina(officer, config.governStaminaCost)

  const next: GameState = {
    ...state,
    rng: nextRng,
    cities: { ...state.cities, [officer.cityId!]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
    pendingCommands: [...state.pendingCommands, { type: 'govern', officerId }],
  }
  return commandOk(next, [
    {
      kind: 'govern-done',
      officerId,
      cityId: officer.cityId!,
      newPrevention: nextCity.disasterPrevention,
      delta: nextCity.disasterPrevention - city.disasterPrevention,
    },
  ])
}
