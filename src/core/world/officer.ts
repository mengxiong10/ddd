import type { CityId, OfficerId } from '../shared/ids'

/** 体力量纲上限（百分制，固定值；规则身份，不入 config）。 */
export const STAMINA_MAX = 100

/** 忠诚量纲上限（百分制，固定值；规则身份，不入 config）。 */
export const LOYALTY_MAX = 100

/**
 * 武将性格：单值 0..4，存储一处、两套表解读同一值（由 lordId===id 派生切换）：
 * - 君主（lordId===自身）：0 和平 / 1 大义 / 2 奸诈 / 3 狂人 / 4 冒进。
 * - 普通武将：0 忠义 / 1 大志 / 2 贪财 / 3 怕死 / 4 卤莽（驱动招降难度）。
 * 文字标签属 UI 展示，不入 core。
 */
export type Personality = 0 | 1 | 2 | 3 | 4

/** 武将聚合。君主也是一名武将；归属与时间无关的属性为静态。 */
export interface Officer {
  readonly id: OfficerId
  readonly name: string
  /** 静态属性，参与开垦/招商增量公式；本游戏不做成长。 */
  readonly intelligence: number
  /** 归属君主；君主本人 lordId 指向自身。null = 无主（覆盖未登场/在野），仅可经搜寻招募。 */
  readonly lordId: OfficerId | null
  /** 所属城（本切片不跨城移动）。 */
  readonly cityId: CityId
  /** 体力，取值 [0, STAMINA_MAX]。 */
  readonly stamina: number
  /** 本月是否已被指令占用（离城）；月末回城时置回 false。 */
  readonly busy: boolean
  /** 当前带兵数，取值 [0, 带兵量上限]。 */
  readonly troops: number
  /** 等级，静态属性，参与带兵量公式；本切片不成长。 */
  readonly level: number
  /** 武力，静态属性，参与带兵量公式。 */
  readonly force: number
  /**
   * 武将忠诚，取值 [0, LOYALTY_MAX]。与城的「民忠」是不同事实。
   * 对外读取应走 queries.officerLoyalty（君主派生恒 100）；此存储值对君主无意义。
   */
  readonly loyalty: number
  /** 伯乐：能招募该（在野）武将的特定武将 id；null = 无指定（搜寻时按执行人智力判定）。 */
  readonly recruiterId: OfficerId | null
  /** 性格（0..4），见 Personality。君主/普通两套表解读同一值。 */
  readonly personality: Personality
}

/**
 * 带兵量公式系数（规则身份，内联常量，不入 config）：
 * 带兵量上限 = 等级×100 + 武力×10 + 智力×10。整组系数即规则身份，改它就是改游戏规则。
 */
const TROOP_CAP_PER_LEVEL = 100
const TROOP_CAP_PER_FORCE = 10
const TROOP_CAP_PER_INTEL = 10

/** 带兵量上限（派生）= 等级×100 + 武力×10 + 智力×10。 */
export function troopCapacity(o: Officer): number {
  return o.level * TROOP_CAP_PER_LEVEL + o.force * TROOP_CAP_PER_FORCE + o.intelligence * TROOP_CAP_PER_INTEL
}

/** 设置武将兵，不低于 0（不变量）。调用方应已校验不超带兵量上限。 */
export function setTroops(o: Officer, troops: number): Officer {
  return { ...o, troops: Math.max(0, troops) }
}

/** 扣减体力，不低于 0（不变量）。 */
export function spendStamina(o: Officer, amount: number): Officer {
  return { ...o, stamina: Math.max(0, o.stamina - amount) }
}

/** 恢复体力，封顶 STAMINA_MAX（不变量）。 */
export function recoverStamina(o: Officer, amount: number): Officer {
  return { ...o, stamina: Math.min(STAMINA_MAX, o.stamina + amount) }
}

/** 设置占用状态（下令离城 / 月末回城）。 */
export function setBusy(o: Officer, busy: boolean): Officer {
  return { ...o, busy }
}

/** 增减忠诚，钳制 [0, LOYALTY_MAX]（不变量）。调用方负责跳过君主（君主忠诚派生恒 100）。 */
export function adjustLoyalty(o: Officer, delta: number): Officer {
  return { ...o, loyalty: Math.max(0, Math.min(LOYALTY_MAX, o.loyalty + delta)) }
}
