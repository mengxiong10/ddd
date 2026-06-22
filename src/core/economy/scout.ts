import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import { commandOk, commandFail, type WithCheck } from '../shared/outcome'
import { spendGold } from '../world/city'
import { spendStamina } from '../world/officer'
import { isBusy } from '../world/queries'

/**
 * 校验侦察前置条件（不修改状态）。本城 = 武将所在城（officer.cityId!）。
 * 武将存在且未占用 → 本城金 ≥ scoutGoldCost → 体力 ≥ scoutStaminaCost
 * → 目标城存在且非己方（target.lordId ≠ 执行人 lordId，已涵盖「非本城」）。
 */
export function canScout(
  state: GameState,
  officerId: OfficerId,
  targetCityId: CityId,
  config: GameConfig
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  const city = state.cities[officer.cityId!]
  if (!city) return { ok: false, reason: 'city-not-found' }
  if (city.gold < config.scoutGoldCost) return { ok: false, reason: 'gold-insufficient' }
  if (officer.stamina < config.scoutStaminaCost)
    return { ok: false, reason: 'stamina-insufficient' }

  const target = state.cities[targetCityId]
  if (!target) return { ok: false, reason: 'target-city-not-found' }
  if (target.lordId === officer.lordId) return { ok: false, reason: 'target-not-enemy-city' }
  return { ok: true }
}

/**
 * 执行侦察：效果在下令当下立即结算（扣本城金 + 扣体力）。
 * 「弹出目标城详情面板」是 UI 行为（成功 apply 后读取目标城渲染），core 无额外状态。
 * 占用武将由入队 scout 命令派生（queries.isBusy），出队即释放；月末分支无效果。不动 RNG。
 * 前置条件不满足时为 no-op，原样返回 state。
 */
export function scout(
  state: GameState,
  officerId: OfficerId,
  targetCityId: CityId,
  config: GameConfig
): WithCheck<GameState> {
  const check = canScout(state, officerId, targetCityId, config)
  if (!check.ok) return commandFail(check, state)

  const officer = state.officers[officerId]!
  const city = state.cities[officer.cityId!]!
  const nextCity = spendGold(city, config.scoutGoldCost)
  const nextOfficer = spendStamina(officer, config.scoutStaminaCost)

  return commandOk({
    ...state,
    cities: { ...state.cities, [officer.cityId!]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
    pendingCommands: [...state.pendingCommands, { type: 'scout', officerId }],
  })
}
