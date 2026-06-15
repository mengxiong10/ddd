import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { City } from './city'
import type { Officer } from './officer'

/**
 * 取驻于某城的武将。onlyAvailable=true 时仅返回「在任」武将（未被占用），
 * 即可被下令的武将；UI 据此列出可指派对象。
 */
export function officersInCity(
  state: GameState,
  cityId: CityId,
  opts?: { onlyAvailable?: boolean },
): Officer[] {
  const onlyAvailable = opts?.onlyAvailable ?? false
  return Object.values(state.officers).filter(
    (o) => o.cityId === cityId && (!onlyAvailable || !o.busy),
  )
}

/** 取归属某君主的全部城池（玩家方传 state.playerLordId）。 */
export function citiesOfLord(state: GameState, lordId: OfficerId): City[] {
  return Object.values(state.cities).filter((c) => c.lordId === lordId)
}
