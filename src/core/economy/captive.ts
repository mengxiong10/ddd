import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { CommandCheck } from '../shared/command'
import { holdByCity, discover } from '../world/item'
import { isCaptive, itemsOfOfficer } from '../world/queries'
import { pickRandomCity } from '../world/placement'

/**
 * 处斩 / 流放——即时、不占人、无执行人的俘虏处置（下令瞬间结算）。
 * core 仅校验游戏规则前置，不校验归属（处斩/流放按作用城归属在 store 派发口校验）。
 */

/** 校验处斩：captiveId 存在且为某城俘虏。 */
export function canBehead(state: GameState, captiveId: OfficerId): CommandCheck {
  const captive = state.officers[captiveId]
  if (!captive) return { ok: false, reason: '俘虏不存在' }
  if (!isCaptive(state, captiveId)) return { ok: false, reason: '目标不是俘虏' }
  return { ok: true }
}

/**
 * 处斩：永久消除本城俘虏。其所持道具全部归还其所在城（holder=城）并标记已发现；
 * 该武将从 state.officers 永久删除。无 RNG / 体力 / 金成本。前置不满足 no-op。
 */
export function behead(state: GameState, captiveId: OfficerId): GameState {
  if (!canBehead(state, captiveId).ok) return state

  const captive = state.officers[captiveId]!
  const items = { ...state.items }
  for (const item of itemsOfOfficer(state, captiveId)) {
    items[item.id] = discover(holdByCity(item, captive.cityId))
  }
  const { [captiveId]: _removed, ...officers } = state.officers
  return { ...state, items, officers }
}

/** 校验流放：目标存在、非在野（lordId≠null）；俘虏可流放，己方在任武将（非占用、非君主）可流放，在任君主不可。 */
export function canBanish(state: GameState, officerId: OfficerId): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: '武将不存在' }
  if (officer.lordId === null) return { ok: false, reason: '在野武将无需流放' }
  if (isCaptive(state, officerId)) return { ok: true } // 俘虏（含被俘君主）可流放
  if (officer.busy) return { ok: false, reason: '武将本月已被占用' }
  if (officer.lordId === officer.id) return { ok: false, reason: '不能流放在任君主' }
  return { ok: true }
}

/**
 * 流放：把目标变在野（lordId=null）、随机落到一座城（消耗 RNG），其道具随人保留（holder 不变）。
 * 无体力 / 金成本、不占人。前置不满足 no-op。
 */
export function banish(state: GameState, officerId: OfficerId): GameState {
  if (!canBanish(state, officerId).ok) return state

  const officer = state.officers[officerId]!
  const [cityId, rng] = pickRandomCity(state)
  const banished = { ...officer, lordId: null, cityId }
  return { ...state, rng, officers: { ...state.officers, [officerId]: banished } }
}
