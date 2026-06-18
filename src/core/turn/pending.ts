import type { GameState, PendingCommand } from '../game-state'
import type { GameConfig } from '../shared/config'
import { executePlunder } from '../economy/plunder'
import { executeMove } from '../economy/move'
import { executeTransport } from '../economy/transport'
import { executeSearch } from '../economy/search'
import { executeSuborn } from '../economy/suborn'
import { executeEntice, executeAlienate, executeInstigate, executeInduce } from '../economy/diplomacy'

/**
 * 月末执行「非 campaign」待执行指令（掠夺/移动/输送/搜寻/招降/外交），按入队序分派到领域服务，
 * 执行后从队列移除（仅保留 campaign 项交由 end-month 逐条结算/挂起战斗）。
 * campaign 不在此执行：玩家参与的出征会进入交互式战斗（end-month.advanceCampaigns）。
 * config 预留给后续需成本/系数的月末指令。
 */
export function runNonCampaignPending(state: GameState, _config: GameConfig): GameState {
  if (state.pendingCommands.length === 0) return state
  const isCampaign = (c: PendingCommand) => c.type === 'campaign'
  const others = state.pendingCommands.filter((c) => !isCampaign(c))
  if (others.length === 0) return state // 仅余 campaign：原样保留，交给 end-month

  let next = state
  for (const cmd of others) {
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
    }
  }
  return { ...next, pendingCommands: state.pendingCommands.filter(isCampaign) }
}
