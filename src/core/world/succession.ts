import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import { isCaptive, citiesOfLord, effectiveOfficer } from './queries'

/**
 * 被俘君主的重选/灭亡（战后处理，由 military/executeCampaign 调用）：
 * - 君主未被俘 → 原样返回。
 * - 君主被俘且该势力仍有城 → 从「剩余未被俘武将」中取智力最高者（平局取 id 字典序最小）为新君主，
 *   把该势力所有城与未被俘武将的 lordId 改归新君主；被俘君主与其余俘虏保持原 lordId。
 * - 君主被俘且已无城（或无可立的未被俘武将）→ 灭亡，原样返回（无新君主）。
 */
export function resolveSuccession(state: GameState, lordId: OfficerId): GameState {
  if (!state.officers[lordId]) return state
  if (!isCaptive(state, lordId)) return state
  if (citiesOfLord(state, lordId).length === 0) return state

  const candidates = Object.values(state.officers).filter(
    (o) => o.lordId === lordId && !isCaptive(state, o.id),
  )
  if (candidates.length === 0) return state

  // 取有效智力（含道具加成）最高者；平局取 id 字典序最小，保确定性。
  const newLord = candidates.reduce((best, o) => {
    const oi = effectiveOfficer(state, o.id).intelligence
    const bi = effectiveOfficer(state, best.id).intelligence
    return oi > bi || (oi === bi && o.id < best.id) ? o : best
  })
  const newLordId = newLord.id
  const promotedIds = new Set(candidates.map((o) => o.id))

  const cities = { ...state.cities }
  for (const id of Object.keys(cities)) {
    if (cities[id]!.lordId === lordId) cities[id] = { ...cities[id]!, lordId: newLordId }
  }
  const officers = { ...state.officers }
  for (const id of promotedIds) {
    officers[id] = { ...officers[id]!, lordId: newLordId }
  }
  return { ...state, cities, officers }
}
