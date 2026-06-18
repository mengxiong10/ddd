import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { CommandCheck } from '../shared/command'
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
  if (!officer) return { ok: false, reason: '武将不存在' }
  if (isBusy(state, officerId)) return { ok: false, reason: '武将本月已被占用' }
  if (isCaptive(state, officerId)) return { ok: false, reason: '俘虏不可移动' }
  const target = state.cities[targetCityId]
  if (!target) return { ok: false, reason: '目标城不存在' }
  if (targetCityId === officer.cityId) return { ok: false, reason: '目标城不能是本城' }
  if (target.lordId !== officer.lordId) return { ok: false, reason: '只能移动到己方城' }
  return { ok: true }
}

/**
 * 下令移动：入队（占用由队列派生），效果延到月末（见 executeMove）。不扣体力/金、不耗 RNG。
 * 前置不满足时为 no-op。
 */
export function move(state: GameState, officerId: OfficerId, targetCityId: CityId): GameState {
  if (!canMove(state, officerId, targetCityId).ok) return state

  return {
    ...state,
    pendingCommands: [...state.pendingCommands, { type: 'move', officerId, targetCityId }],
  }
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
