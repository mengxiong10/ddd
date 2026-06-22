import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import { commandOk, commandFail, type WithCheck } from '../shared/outcome'
import { spendGold } from '../world/city'
import { adjustLoyalty, recoverStamina } from '../world/officer'
import { isBusy, isCaptive } from '../world/queries'

/**
 * 宴请效果（规则身份，内联常量，不入 config）：
 * 体力 += BANQUET_STAMINA_GAIN（封顶 STAMINA_MAX）；非君主忠诚 += BANQUET_LOYALTY_GAIN（封顶 LOYALTY_MAX）。
 */
const BANQUET_STAMINA_GAIN = 50
const BANQUET_LOYALTY_GAIN = 1

/**
 * 校验宴请前置（不改状态）。作用城 = 目标武将所在城。不占人。
 * 目标武将存在、未占用且非俘虏（在任）→ 本城存在 → 本城金 ≥ banquetGoldCost。
 */
export function canBanquet(
  state: GameState,
  officerId: OfficerId,
  config: GameConfig
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  if (isCaptive(state, officerId)) return { ok: false, reason: 'is-captive' }
  const city = state.cities[officer.cityId!]
  if (!city) return { ok: false, reason: 'city-not-found' }
  if (city.gold < config.banquetGoldCost) return { ok: false, reason: 'gold-insufficient' }
  return { ok: true }
}

/**
 * 执行宴请：即时、不占人、不耗 RNG。扣本城金，目标体力 +50（封顶），非君主忠诚 +1（封顶）。
 * 君主跳过忠诚写入（君主忠诚派生恒 100）。前置不满足时为 no-op。
 */
export function banquet(
  state: GameState,
  officerId: OfficerId,
  config: GameConfig
): WithCheck<GameState> {
  const check = canBanquet(state, officerId, config)
  if (!check.ok) return commandFail(check, state)

  const officer0 = state.officers[officerId]!
  const cityId = officer0.cityId!
  const city = spendGold(state.cities[cityId]!, config.banquetGoldCost)
  const isLord = officer0.lordId === officer0.id
  const recovered = recoverStamina(officer0, BANQUET_STAMINA_GAIN)
  const officer = isLord ? recovered : adjustLoyalty(recovered, BANQUET_LOYALTY_GAIN)

  return commandOk({
    ...state,
    cities: { ...state.cities, [cityId]: city },
    officers: { ...state.officers, [officerId]: officer },
  })
}
