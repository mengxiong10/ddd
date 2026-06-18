import type { Rng } from '../shared/rng'
import { randInt } from '../shared/rng'

/**
 * 战斗人物状态（含死亡）。纯规则叶模块。
 * 死亡为唯一真相（troops===0 ↔ 'dead'，替代旧 routed 字段）。
 * 其余可控状态由技能施加，每日开头按概率恢复/消失。
 */
export type BattleStatus =
  | 'normal' // 正常
  | 'confused' // 混乱：不能行动
  | 'sealed' // 禁咒：不能施法
  | 'rooted' // 定身：移动力降为 1
  | 'qimen' // 奇门：可穿越接敌停步区
  | 'stone' // 石阵：不能行动且每天损兵 1/8
  | 'dead' // 死亡：击溃，退出行动序列

/** 能否行动（移动/普攻/施法/休息）：混乱、石阵、死亡不能。 */
export function canActWithStatus(s: BattleStatus): boolean {
  return s !== 'confused' && s !== 'stone' && s !== 'dead'
}

/** 能否施放计谋：禁咒、死亡不能（其余可控状态仍可施法，若同时可行动）。 */
export function canCastWithStatus(s: BattleStatus): boolean {
  return s !== 'sealed' && s !== 'dead'
}

/** 石阵每日损兵 = floor(当前兵力 / 8)。 */
export function stoneDamage(troops: number): number {
  return Math.floor(troops / 8)
}

/** 状态判定掷骰量纲（规则身份，内联）。 */
const CHECK_MIN = 0
const CHECK_MAX = 59

/**
 * 每日开头状态判定（§6.6.2，消耗 rng）：判定成功 = randInt(0,59) < floor(有效智力/2)。
 * - 混乱/禁咒/定身/石阵：成功 → 恢复正常。
 * - 奇门：失败 → 恢复正常。
 * - 正常/死亡：不变、不耗 rng（死亡跳过；正常无可恢复项）。
 * 返回新状态 + 推进后的 rng。
 */
export function dailyStatusCheck(
  s: BattleStatus,
  effIntel: number,
  rng: Rng,
): readonly [BattleStatus, Rng] {
  if (s === 'normal' || s === 'dead') return [s, rng]
  const [r, next] = randInt(rng, CHECK_MIN, CHECK_MAX)
  const success = r < Math.floor(effIntel / 2)
  if (s === 'qimen') return [success ? s : 'normal', next]
  return [success ? 'normal' : s, next]
}
