import type { GameState } from '../game-state'
import type { GameConfig } from '../shared/config'
import { executePlunder } from '../economy/plunder'

/**
 * 月末执行 pendingCommands：按下令顺序遍历，按 type 分派到对应领域服务（与 game.apply 同构），
 * 执行后清空队列（不跨月残留）。turn 层编排，不含领域规则。
 * config 预留给后续需要成本/系数的月末指令；当前掠夺执行无需 config。
 */
export function runPendingCommands(state: GameState, _config: GameConfig): GameState {
  if (state.pendingCommands.length === 0) return state

  let next = state
  for (const cmd of state.pendingCommands) {
    switch (cmd.type) {
      case 'plunder':
        next = executePlunder(next, cmd.officerId)
        break
    }
  }
  return { ...next, pendingCommands: [] }
}
