import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { Officer } from './officer'
import { LOYALTY_MAX } from './officer'
import type { CommandCheck } from '../shared/command'
import { isCaptive, effectiveOfficer } from './queries'

/**
 * 重选君主的 actor-agnostic 纯工具（`14-campaign-aftermath`）。
 * 不读 playerLordId——「AI 自动 / 玩家手动」的分支由 military/aftermath 决定。
 */

/** 重选候选 = 该势力非俘虏、非君主自身的武将。 */
export function successionCandidates(state: GameState, lordId: OfficerId): Officer[] {
  return Object.values(state.officers).filter(
    (o) => o.lordId === lordId && o.id !== lordId && !isCaptive(state, o.id)
  )
}

/** 自动选新君：候选中有效智力最高（平局取 id 字典序最小）；无候选→null。 */
export function pickSuccessor(state: GameState, lordId: OfficerId): OfficerId | null {
  const candidates = successionCandidates(state, lordId)
  if (candidates.length === 0) return null
  return candidates.reduce((best, o) => {
    const oi = effectiveOfficer(state, o.id).intelligence
    const bi = effectiveOfficer(state, best.id).intelligence
    return oi > bi || (oi === bi && o.id < best.id) ? o : best
  }).id
}

/**
 * 换主：oldLord 的全部城 + 非俘虏武将 lordId→newLord、newLord 忠诚强制 100；
 * 若 oldLord===playerLordId 则一并把 playerLordId→newLord。
 * 被俘/已删的 oldLord 自身不被改（俘虏排除在迁移外、保持原 lordId）。
 */
export function promoteLord(
  state: GameState,
  oldLordId: OfficerId,
  newLordId: OfficerId
): GameState {
  const promotedIds = successionCandidates(state, oldLordId).map((o) => o.id)
  const cities = { ...state.cities }
  for (const id of Object.keys(cities)) {
    if (cities[id]!.lordId === oldLordId) cities[id] = { ...cities[id]!, lordId: newLordId }
  }
  const officers = { ...state.officers }
  for (const id of promotedIds) officers[id] = { ...officers[id]!, lordId: newLordId }
  officers[newLordId] = { ...officers[newLordId]!, loyalty: LOYALTY_MAX }
  const playerLordId = state.playerLordId === oldLordId ? newLordId : state.playerLordId
  return { ...state, cities, officers, playerLordId }
}

/** 校验玩家选新君（供 canApply）：pendingSuccession 非空 + officerId 为其候选。 */
export function canChooseSuccessor(state: GameState, officerId: OfficerId): CommandCheck {
  const pending = state.pendingSuccession
  if (!pending) return { ok: false, reason: '当前无待选新君' }
  if (!successionCandidates(state, pending.lordId).some((o) => o.id === officerId)) {
    return { ok: false, reason: '该武将不是合法的新君候选' }
  }
  return { ok: true }
}
