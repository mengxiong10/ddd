import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { CommandCheck } from '../shared/command'
import { commandOk, commandFail, type WithCheck } from '../shared/outcome'
import { holdByCity, discover } from '../world/item'
import { isBusy, isCaptive, itemsOfOfficer } from '../world/queries'
import { pickRandomCity } from '../world/placement'

/**
 * 处斩 / 流放——即时、不占人、无执行人的俘虏处置（下令瞬间结算）。
 * core 仅校验游戏规则前置，不校验归属（处斩/流放按作用城归属在 store 派发口校验）。
 */

/** 校验处斩：captiveId 存在且为某城俘虏。 */
export function canBehead(state: GameState, captiveId: OfficerId): CommandCheck {
  const captive = state.officers[captiveId]
  if (!captive) return { ok: false, reason: 'captive-not-found' }
  if (!isCaptive(state, captiveId)) return { ok: false, reason: 'target-not-captive' }
  return { ok: true }
}

/**
 * 处斩：永久消除本城俘虏。其所持道具全部归还其所在城（holder=城）并标记已发现；
 * 该武将从 state.officers 永久删除。无 RNG / 体力 / 金成本。前置不满足 no-op。
 */
export function behead(state: GameState, captiveId: OfficerId): WithCheck<GameState> {
  const check = canBehead(state, captiveId)
  if (!check.ok) return commandFail(check, state)

  const captive = state.officers[captiveId]!
  const items = { ...state.items }
  for (const item of itemsOfOfficer(state, captiveId)) {
    items[item.id] = discover(holdByCity(item, captive.cityId!))
  }
  const { [captiveId]: _removed, ...officers } = state.officers
  return commandOk({ ...state, items, officers })
}

/** 校验流放：目标存在、非在野（lordId≠null）；俘虏可流放，己方在任武将（非占用、非君主）可流放，在任君主不可。 */
export function canBanish(state: GameState, officerId: OfficerId): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (officer.lordId === null) return { ok: false, reason: 'already-wandering' }
  if (isCaptive(state, officerId)) return { ok: true } // 俘虏（含被俘君主）可流放
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  if (officer.lordId === officer.id) return { ok: false, reason: 'cannot-banish-active-lord' }
  return { ok: true }
}

/**
 * 流放：把目标变在野（lordId=null）、随机落到一座城（消耗 RNG），其道具随人保留（holder 不变）。
 * 无体力 / 金成本、不占人。前置不满足 no-op。
 */
export function banish(state: GameState, officerId: OfficerId): WithCheck<GameState> {
  const check = canBanish(state, officerId)
  if (!check.ok) return commandFail(check, state)

  const officer = state.officers[officerId]!
  const [cityId, rng] = pickRandomCity(state)
  const banished = { ...officer, lordId: null, cityId }
  return commandOk({ ...state, rng, officers: { ...state.officers, [officerId]: banished } })
}
