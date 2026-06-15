/** 内政开发的种类：开垦提升农业，招商提升商业。两者共用同一套规则，仅作用属性不同。 */
export type DevelopKind = 'agriculture' | 'commerce'

/**
 * 全局不可变数值配置（与可变的 GameState 分离）。
 * 所有规则数值集中于此，便于平衡调整与注入测试；不随对局变化。
 * 注意：农业/商业上限不在这里——它是城级字段（各城可不同），见 City。
 */
export interface GameConfig {
  /** 执行一次开垦/招商消耗的城金。 */
  readonly commandGoldCost: number
  /** 执行一次开垦/招商消耗的武将体力。 */
  readonly commandStaminaCost: number
  /** 武将体力上限（恢复时的封顶值）。 */
  readonly staminaMax: number
  /** 每月末所有已登场武将恢复的体力，封顶 staminaMax。 */
  readonly staminaRecoveryPerMonth: number
  /** 开垦/招商增量公式中的智力除数：增量 = floor(智力 / developIntelDivisor) + RandInt(0, developRandMax)。 */
  readonly developIntelDivisor: number
  /** 开垦/招商增量公式中的随机上限（含两端的 RandInt(0, developRandMax)）。 */
  readonly developRandMax: number
  /** 收粮公式除数：本次收粮 = floor(农业 / harvestDivisor)。 */
  readonly harvestDivisor: number
  /** 收税公式除数：本次收税 = floor(商业 / taxDivisor)。 */
  readonly taxDivisor: number
  /** 触发收粮的月份（含）。 */
  readonly harvestMonths: readonly number[]
  /** 触发收税的月份（含）。 */
  readonly taxMonths: readonly number[]
}

/** 默认配置：当前数值为可调默认值，待平衡阶段再细调。 */
export const DEFAULT_CONFIG: GameConfig = {
  commandGoldCost: 50,
  commandStaminaCost: 8,
  staminaMax: 100,
  staminaRecoveryPerMonth: 4,
  developIntelDivisor: 5,
  developRandMax: 30,
  harvestDivisor: 4,
  taxDivisor: 2,
  harvestMonths: [6, 10],
  taxMonths: [3, 6, 9, 12],
}
