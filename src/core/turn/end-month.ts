import type { GameState } from '../game-state'
import type { GameConfig } from '../shared/config'
import type { OfficerId } from '../shared/ids'
import { settle } from '../economy/settle'
import { aiTakeTurn } from '../ai/ai'
import { recoverStamina, setBusy } from '../world/officer'
import { runPendingCommands } from './pending'

/**
 * 推进一个月——唯一掌握"月末顺序"的地方：
 * AI 下令(本切片空步) → 执行待月末指令(掠夺等) → 结算收粮/收税 → 占用武将回城 + 体力恢复 → 月份 +1（跨年）。
 */
export function endMonth(state: GameState, config: GameConfig): GameState {
  // 1. AI 下令（本切片空步）
  const afterAi = aiTakeTurn(state, config)
  // 2. 执行本月待月末执行的指令（掠夺破坏+收益），先于结算
  const afterPending = runPendingCommands(afterAi, config)
  // 3. 月末结算（收粮/收税）
  const settled = settle(afterPending)
  // 3. 占用武将回城 + 体力恢复（封顶）
  const officers: Record<OfficerId, GameState['officers'][OfficerId]> = { ...settled.officers }
  for (const id of Object.keys(officers)) {
    officers[id] = setBusy(
      recoverStamina(officers[id]!, config.staminaRecoveryPerMonth),
      false,
    )
  }
  // 4. 月份推进（12 月 -> 次年 1 月）
  const month = settled.month === 12 ? 1 : settled.month + 1
  const year = settled.month === 12 ? settled.year + 1 : settled.year

  return { ...settled, officers, month, year }
}
