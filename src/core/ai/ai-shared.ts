import type { GameState, PendingCommand } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { City } from '../world/city'
import type { Officer } from '../world/officer'
import { officersInCity } from '../world/queries'
import { areAdjacent } from '../world/adjacency'

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
 * AI 入队：追加 PendingCommand（占用由队列派生 queries.isBusy，入队即占用）；不扣任何成本、不动 RNG、不走 canX。
 * AI 作弊简化下令的唯一入队口（内政/搜寻/移动/外交），月末复用现有 executeX 结算（即时类为空操作）。
 */
export function busyEnqueue(
  state: GameState,
  _officerId: OfficerId,
  cmd: PendingCommand
): GameState {
  return { ...state, pendingCommands: [...state.pendingCommands, cmd] }
}

/**
 * AI 批量入队（出征）：追加一条 PendingCommand（占用由队列派生，officerIds 全部入队即占用）；不扣成本、不动 RNG。
 * 出征是唯一多人占人的 AI 命令，沿用作弊下令口（不走 canCampaign）。
 */
export function busyEnqueueMany(
  state: GameState,
  _officerIds: readonly OfficerId[],
  cmd: PendingCommand
): GameState {
  return { ...state, pendingCommands: [...state.pendingCommands, cmd] }
}

/** 某城的相邻敌城（lordId≠该势力，含玩家城），按 id 升序。供内政移动选城 + 军备选目标共用。 */
export function adjacentEnemyCities(state: GameState, cityId: CityId, lordId: OfficerId): City[] {
  return Object.values(state.cities)
    .filter((c) => c.lordId !== lordId && areAdjacent(state.adjacency, cityId, c.id))
    .sort(byId)
}
