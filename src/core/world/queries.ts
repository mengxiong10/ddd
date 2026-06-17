import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { City } from './city'
import type { Officer } from './officer'
import { LOYALTY_MAX } from './officer'
import type { Item } from './item'

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

/** 取归属某城的道具（按 holder 派生，无第二份存储）。 */
export function itemsInCity(state: GameState, cityId: CityId): Item[] {
  return Object.values(state.items).filter((i) => i.holder.kind === 'city' && i.holder.cityId === cityId)
}

/** 取归属某武将的道具（按 holder 派生）。 */
export function itemsOfOfficer(state: GameState, officerId: OfficerId): Item[] {
  return Object.values(state.items).filter((i) => i.holder.kind === 'officer' && i.holder.officerId === officerId)
}

/**
 * 有效武将（派生）：force/intel 叠加所持道具加成之和，其余字段原样。
 * 所有用到武力/智力的公式都应取此值——道具加成的唯一收敛处。
 */
export function effectiveOfficer(state: GameState, officerId: OfficerId): Officer {
  const officer = state.officers[officerId]!
  const items = itemsOfOfficer(state, officerId)
  if (items.length === 0) return officer
  const force = officer.force + items.reduce((s, i) => s + i.forceBonus, 0)
  const intelligence = officer.intelligence + items.reduce((s, i) => s + i.intelBonus, 0)
  return { ...officer, force, intelligence }
}

/** 武将忠诚（派生）：君主（lordId===自身）恒 LOYALTY_MAX，否则取存储值。 */
export function officerLoyalty(state: GameState, officerId: OfficerId): number {
  const officer = state.officers[officerId]!
  return officer.lordId === officer.id ? LOYALTY_MAX : officer.loyalty
}
