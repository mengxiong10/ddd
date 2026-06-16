import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { City } from './city'
import type { Officer } from './officer'

/**
 * 俘虏判定（派生，非存储字段）：武将自身归属 ≠ 所在城归属即为俘虏。
 * 占领只改 city.lordId，原守军 lordId 不动，自动在此意义上成俘虏。
 */
export function isCaptive(state: GameState, officerId: OfficerId): boolean {
  const officer = state.officers[officerId]
  if (!officer) return false
  const city = state.cities[officer.cityId]
  if (!city) return false
  return officer.lordId !== city.lordId
}

/**
 * 取驻于某城的武将。onlyAvailable=true 时仅返回「在任」武将（未被占用且非俘虏），
 * 即可被下令的武将；UI 据此列出可指派对象。
 */
export function officersInCity(
  state: GameState,
  cityId: CityId,
  opts?: { onlyAvailable?: boolean },
): Officer[] {
  const onlyAvailable = opts?.onlyAvailable ?? false
  return Object.values(state.officers).filter(
    (o) => o.cityId === cityId && (!onlyAvailable || (!o.busy && !isCaptive(state, o.id))),
  )
}

/** 取归属某君主的全部城池（玩家方传 state.playerLordId）。 */
export function citiesOfLord(state: GameState, lordId: OfficerId): City[] {
  return Object.values(state.cities).filter((c) => c.lordId === lordId)
}
