import type { GameState } from '../game-state'
import type { GameConfig } from '../shared/config'

// 本切片 AI 静止：直接返回原 state。
// 保留此 seam，未来接入 AI 决策时只动这里，不必改 endMonth 编排。
export function aiTakeTurn(state: GameState, _config: GameConfig): GameState {
  return state
}
