import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import { spendGold } from '../world/city'
import { setBusy, spendStamina } from '../world/officer'

/**
 * 校验侦察前置条件（不修改状态）。
 * 本城/武将存在 → 武将在本城且未占用 → 本城金 ≥ scoutGoldCost → 体力 ≥ scoutStaminaCost
 * → 目标城存在且非己方（target.lordId ≠ 执行人 lordId，已涵盖「非本城」）。
 */
export function canScout(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  targetCityId: CityId,
  config: GameConfig,
): CommandCheck {
  const city = state.cities[cityId]
  if (!city) return { ok: false, reason: '城不存在' }
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: '武将不存在' }
  if (officer.cityId !== cityId) return { ok: false, reason: '武将不在该城' }
  if (officer.busy) return { ok: false, reason: '武将本月已被占用' }
  if (city.gold < config.scoutGoldCost) return { ok: false, reason: '城金不足' }
  if (officer.stamina < config.scoutStaminaCost) return { ok: false, reason: '体力不足' }

  const target = state.cities[targetCityId]
  if (!target) return { ok: false, reason: '目标城不存在' }
  if (target.lordId === officer.lordId) return { ok: false, reason: '只能侦察非己方城' }
  return { ok: true }
}

/**
 * 执行侦察：效果在下令当下立即结算（扣本城金 + 扣体力 + 占用武将）。
 * 「弹出目标城详情面板」是 UI 行为（成功 apply 后读取目标城渲染），core 无额外状态。
 * 不入待执行队列、不动 RNG。前置条件不满足时为 no-op，原样返回 state。
 */
export function scout(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  targetCityId: CityId,
  config: GameConfig,
): GameState {
  if (!canScout(state, cityId, officerId, targetCityId, config).ok) return state

  const city = state.cities[cityId]!
  const officer = state.officers[officerId]!
  const nextCity = spendGold(city, config.scoutGoldCost)
  const nextOfficer = setBusy(spendStamina(officer, config.scoutStaminaCost), true)

  return {
    ...state,
    cities: { ...state.cities, [cityId]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
  }
}
