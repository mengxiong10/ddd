import type { GameState, PendingCommand } from '../game-state'
import type { GameConfig } from '../shared/config'
import { executePlunder } from '../economy/plunder'
import { executeMove } from '../economy/move'
import { executeTransport } from '../economy/transport'
import { executeSearch } from '../economy/search'
import { executeSuborn } from '../economy/suborn'
import { executeEntice, executeAlienate, executeInstigate, executeInduce } from '../economy/diplomacy'
import { executeCampaign } from '../military/campaign'

/**
 * 月末执行 pendingCommands：两趟执行——先所有非 campaign（掠夺等）按入队序，
 * 再所有 campaign（出征）按入队序，兑现「出征排在普通待执行指令之后」。
 * 各按 type 分派到对应领域服务（与 game.apply 同构），执行后清空队列（不跨月残留）。
 * turn 层编排，不含领域规则。config 预留给后续需成本/系数的月末指令。
 */
export function runPendingCommands(state: GameState, _config: GameConfig): GameState {
  if (state.pendingCommands.length === 0) return state

  const isCampaign = (c: PendingCommand) => c.type === 'campaign'
  const ordered = [
    ...state.pendingCommands.filter((c) => !isCampaign(c)),
    ...state.pendingCommands.filter(isCampaign),
  ]

  let next = state
  for (const cmd of ordered) {
    switch (cmd.type) {
      case 'plunder':
        next = executePlunder(next, cmd.officerId)
        break
      case 'move':
        next = executeMove(next, cmd.officerId, cmd.targetCityId)
        break
      case 'transport':
        next = executeTransport(next, cmd.officerId, cmd.targetCityId, cmd.food, cmd.gold, cmd.troops)
        break
      case 'search':
        next = executeSearch(next, cmd.officerId)
        break
      case 'suborn':
        next = executeSuborn(next, cmd.officerId, cmd.captiveId)
        break
      case 'entice':
        next = executeEntice(next, cmd.officerId, cmd.targetOfficerId)
        break
      case 'alienate':
        next = executeAlienate(next, cmd.officerId, cmd.targetOfficerId)
        break
      case 'instigate':
        next = executeInstigate(next, cmd.officerId, cmd.targetOfficerId)
        break
      case 'induce':
        next = executeInduce(next, cmd.officerId, cmd.targetOfficerId)
        break
      case 'campaign':
        next = executeCampaign(next, cmd.officerIds, cmd.targetCityId, cmd.provisions)
        break
    }
  }
  return { ...next, pendingCommands: [] }
}
