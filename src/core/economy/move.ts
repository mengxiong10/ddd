import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { CommandCheck } from '../shared/command'
import { commandOk, commandFail, type WithCheck } from '../shared/outcome'
import { isBusy, isCaptive } from '../world/queries'

/**
 * 校验移动前置（不改状态）。被移动者即被占用者本人；不扣体力/金。
 * 武将存在、未占用、非俘虏 → 目标城存在、非本城、与本城同势力（己方城）。
 */
export function canMove(
  state: GameState,
  officerId: OfficerId,
  targetCityId: CityId
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  if (isCaptive(state, officerId)) return { ok: false, reason: 'is-captive' }
  const target = state.cities[targetCityId]
  if (!target) return { ok: false, reason: 'target-city-not-found' }
  if (targetCityId === officer.cityId!) return { ok: false, reason: 'target-is-self-city' }
  if (target.lordId !== officer.lordId) return { ok: false, reason: 'target-not-friendly-city' }
  return { ok: true }
}

/**
 * 下令移动：入队（占用由队列派生），效果延到月末（见 executeMove）。不扣体力/金、不耗 RNG。
 * 前置不满足时为 no-op。
 */
export function move(
  state: GameState,
  officerId: OfficerId,
  targetCityId: CityId
): WithCheck<GameState> {
  const check = canMove(state, officerId, targetCityId)
  if (!check.ok) return commandFail(check, state)

  return commandOk({
    ...state,
    pendingCommands: [...state.pendingCommands, { type: 'move', officerId, targetCityId }],
  })
}

/**
 * 月末执行移动（供 turn 分派，非 campaign 趟）：把武将 cityId 改为目标城。
 * 占人例外：武将不回出发城；占用随该命令出队即释放（派生 isBusy）。
 */
export function executeMove(
  state: GameState,
  officerId: OfficerId,
  targetCityId: CityId
): GameState {
  const officer = { ...state.officers[officerId]!, cityId: targetCityId }
  return { ...state, officers: { ...state.officers, [officerId]: officer } }
}
