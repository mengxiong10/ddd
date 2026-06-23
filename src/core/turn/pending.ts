import type { GameState, PendingCommand } from '../game-state'
import type { GameConfig } from '../shared/config'
import { step, withEvents, type WithEvents } from '../shared/outcome'
import { economyMonthRun } from '../economy'

/**
 * 月末执行「非 campaign」待执行指令（掠夺/移动/输送/搜寻/招降/外交有月末效果；即时类 reclaim/commerce/patrol/
 * govern/trade/scout/recruit 仅作占用标记、月末空操作），按入队序经 economy/registry 的 economyMonthRun
 * 表分派到各命令的 run 阶段，执行后从队列移除（仅保留 campaign 项交由 end-month 逐条结算/挂起战斗）——
 * 出队即释放派生占用（queries.isBusy）。
 * campaign 不在此执行：玩家参与的出征会进入交互式战斗（end-month.advanceCampaigns）。
 * config 预留给后续需成本/系数的月末指令。
 */
export function runNonCampaignPending(state: GameState, config: GameConfig): WithEvents<GameState> {
  if (state.pendingCommands.length === 0) return withEvents(state)
  const isCampaign = (c: PendingCommand) => c.type === 'campaign'
  const others = state.pendingCommands.filter((c) => !isCampaign(c))
  if (others.length === 0) return withEvents(state) // 仅余 campaign：原样保留，交给 end-month

  let acc: WithEvents<GameState> = withEvents(state)
  for (const cmd of others) {
    acc = step(acc, (next) => {
      // 延后效果命令查表执行其 run 阶段；即时类无 run、月末空操作（出队即释放派生占用）。
      const run = economyMonthRun[cmd.type]
      return run ? run(next, cmd, config) : withEvents(next)
    })
  }
  return {
    state: { ...acc.state, pendingCommands: state.pendingCommands.filter(isCampaign) },
    events: acc.events,
  }
}
