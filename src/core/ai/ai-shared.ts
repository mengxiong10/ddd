import type { GameState, PendingCommand } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { Officer } from '../world/officer'
import { setBusy } from '../world/officer'
import { officersInCity } from '../world/queries'

/** 按 id 升序比较（AI 全程遍历序，保确定性）。 */
export function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 本城在任武将（onlyAvailable），按 id 升序——AI 模块统一遍历序
 * （决定内政移动的「武将序号 i」）。
 */
export function aiServingOfficers(state: GameState, cityId: CityId): Officer[] {
  return officersInCity(state, cityId, { onlyAvailable: true }).sort(byId)
}

/**
 * AI 入队：置执行人 busy + 追加 PendingCommand；不扣任何成本、不动 RNG、不走 canX。
 * AI 作弊简化下令的唯一入队口（搜寻/移动/外交），月末复用现有 executeX 结算。
 */
export function busyEnqueue(
  state: GameState,
  officerId: OfficerId,
  cmd: PendingCommand
): GameState {
  return {
    ...state,
    officers: { ...state.officers, [officerId]: setBusy(state.officers[officerId]!, true) },
    pendingCommands: [...state.pendingCommands, cmd],
  }
}
