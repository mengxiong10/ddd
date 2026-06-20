import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { CommandCheck } from '../shared/command'
import { commandOk, commandFail, type WithCheck } from '../shared/outcome'
import type { City } from '../world/city'
import type { Officer } from '../world/officer'
import { addReserveTroops } from '../world/city'
import { setTroops, troopCapacity } from '../world/officer'
import { effectiveOfficer, isBusy } from '../world/queries'

/** 可分配上限 = min(带兵量上限, 后备兵 + 武将现有兵)。 */
export function allocateMaxTroops(officer: Officer, city: City): number {
  return Math.min(troopCapacity(officer), city.reserveTroops + officer.troops)
}

/**
 * 校验分配前置条件（不修改状态）。分配不占人，作用城 = 武将所在城（officer.cityId）。
 * 武将存在且未占用 → 0 ≤ amount ≤ 可分配上限。
 */
export function canAllocate(state: GameState, officerId: OfficerId, amount: number): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  const city = state.cities[officer.cityId]
  if (!city) return { ok: false, reason: 'city-not-found' }

  if (amount < 0) return { ok: false, reason: 'invalid-amount' }
  if (amount > allocateMaxTroops(effectiveOfficer(state, officerId), city))
    return { ok: false, reason: 'exceeds-allocatable' }
  return { ok: true }
}

/**
 * 执行分配：在城后备兵与该武将现有兵之间重分配，立即生效。
 * 后备兵 += (武将原兵 − N)；武将兵 = N。不占人、不扣体力/金、不动 RNG。
 * 前置条件不满足时为 no-op，原样返回 state。
 */
export function allocate(
  state: GameState,
  officerId: OfficerId,
  amount: number
): WithCheck<GameState> {
  const check = canAllocate(state, officerId, amount)
  if (!check.ok) return commandFail(check, state)

  const officer = state.officers[officerId]!
  const city = state.cities[officer.cityId]!

  const nextCity = addReserveTroops(city, officer.troops - amount)
  const nextOfficer = setTroops(officer, amount)

  return commandOk({
    ...state,
    cities: { ...state.cities, [officer.cityId]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
  })
}
