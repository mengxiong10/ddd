/** 内政开发的种类：开垦提升农业，招商提升商业。两者共用同一套规则，仅作用属性不同。 */
export type DevelopKind = 'agriculture' | 'commerce'

/**
 * 全局不可变数值配置（与可变的 GameState 分离）。
 * 仅收敛「平衡旋钮」——玩家行动的成本与恢复速率；游戏规则本身（产出/转化公式、
 * 结算日历、量纲上限）为「规则身份」，内联在各领域模块，不进 config（见 CONSTITUTION「配置 vs 内联常量」）。
 * 注意：农业/商业上限是城级领域数据（各城可不同），见 City，也不在此。
 */
export interface GameConfig {
  /** 执行一次开垦/招商消耗的城金。 */
  readonly commandGoldCost: number
  /** 执行一次开垦/招商消耗的武将体力。 */
  readonly commandStaminaCost: number
  /** 每月末所有已登场武将恢复的体力，封顶 STAMINA_MAX（见 officer.ts）。 */
  readonly staminaRecoveryPerMonth: number
  /** 征兵消耗的执行人体力（扁平成本，可调）。 */
  readonly recruitStaminaCost: number
  /** 掠夺消耗的执行人体力（扁平成本，门槛同值）。 */
  readonly plunderStaminaCost: number
  /** 侦察消耗的执行人体力（扁平成本，门槛同值）。 */
  readonly scoutStaminaCost: number
  /** 侦察消耗的本城金（扁平成本，门槛同值）。 */
  readonly scoutGoldCost: number
  /** 出巡消耗的执行人体力（扁平成本，门槛同值）。 */
  readonly patrolStaminaCost: number
  /** 出巡消耗的本城金（扁平成本，门槛同值）。 */
  readonly patrolGoldCost: number
  /** 宴请消耗的本城金（扁平成本，门槛同值）。 */
  readonly banquetGoldCost: number
  /** 输送消耗的执行人体力（扁平成本，门槛同值）。 */
  readonly transportStaminaCost: number
  /** 交易消耗的执行人体力（扁平成本，门槛同值）。 */
  readonly tradeStaminaCost: number
  /** 搜寻消耗的执行人体力（扁平成本，门槛同值）。 */
  readonly searchStaminaCost: number
}

/** 默认配置：当前数值为可调默认值，待平衡阶段再细调。 */
export const DEFAULT_CONFIG: GameConfig = {
  commandGoldCost: 50,
  commandStaminaCost: 8,
  staminaRecoveryPerMonth: 4,
  recruitStaminaCost: 12,
  plunderStaminaCost: 12,
  scoutStaminaCost: 10,
  scoutGoldCost: 20,
  patrolStaminaCost: 8,
  patrolGoldCost: 50,
  banquetGoldCost: 100,
  transportStaminaCost: 8,
  tradeStaminaCost: 12,
  searchStaminaCost: 8,
}
