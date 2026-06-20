import type { GameState, PendingCommand } from '../game-state'
import type { GameConfig } from '../shared/config'
import { step, withEvents, type WithEvents } from '../shared/outcome'
import { executePlunder } from '../economy/plunder'
import { executeMove } from '../economy/move'
import { executeTransport } from '../economy/transport'
import { executeSearch } from '../economy/search'
import { executeSuborn } from '../economy/suborn'
import {
  executeEntice,
  executeAlienate,
  executeInstigate,
  executeInduce,
} from '../economy/diplomacy'

/**
 * 月末执行「非 campaign」待执行指令（掠夺/移动/输送/搜寻/招降/外交有月末效果；即时类 develop/patrol/govern/
 * trade/scout/recruit 仅作占用标记、月末空操作），按入队序分派到领域服务，
 * 执行后从队列移除（仅保留 campaign 项交由 end-month 逐条结算/挂起战斗）——出队即释放派生占用（queries.isBusy）。
 * campaign 不在此执行：玩家参与的出征会进入交互式战斗（end-month.advanceCampaigns）。
 * config 预留给后续需成本/系数的月末指令。
 */
export function runNonCampaignPending(
  state: GameState,
  _config: GameConfig
): WithEvents<GameState> {
  if (state.pendingCommands.length === 0) return withEvents(state)
  const isCampaign = (c: PendingCommand) => c.type === 'campaign'
  const others = state.pendingCommands.filter((c) => !isCampaign(c))
  if (others.length === 0) return withEvents(state) // 仅余 campaign：原样保留，交给 end-month

  let acc: WithEvents<GameState> = withEvents(state)
  for (const cmd of others) {
    acc = step(acc, (next) => {
      switch (cmd.type) {
        case 'plunder':
          return executePlunder(next, cmd.officerId)
        case 'move':
          return withEvents(executeMove(next, cmd.officerId, cmd.targetCityId))
        case 'transport':
          return executeTransport(
            next,
            cmd.officerId,
            cmd.targetCityId,
            cmd.food,
            cmd.gold,
            cmd.troops
          )
        case 'search':
          return executeSearch(next, cmd.officerId)
        case 'suborn':
          return executeSuborn(next, cmd.officerId, cmd.captiveId)
        case 'entice':
          return executeEntice(next, cmd.officerId, cmd.targetOfficerId)
        case 'alienate':
          return executeAlienate(next, cmd.officerId, cmd.targetOfficerId)
        case 'instigate':
          return executeInstigate(next, cmd.officerId, cmd.targetOfficerId)
        case 'induce':
          return executeInduce(next, cmd.officerId, cmd.targetOfficerId)
        // 即时生效指令：效果已于下令时结算，月末无操作；出队即释放派生占用（isBusy）。
        default:
          return withEvents(next)
      }
    })
  }
  return {
    state: { ...acc.state, pendingCommands: state.pendingCommands.filter(isCampaign) },
    events: acc.events,
  }
}
