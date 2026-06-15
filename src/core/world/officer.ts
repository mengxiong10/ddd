import type { CityId, OfficerId } from '../shared/ids'

/** 武将聚合。君主也是一名武将；归属与时间无关的属性为静态。 */
export interface Officer {
  readonly id: OfficerId
  readonly name: string
  /** 静态属性，参与开垦/招商增量公式；本游戏不做成长。 */
  readonly intelligence: number
  /** 归属君主；君主本人 lordId 指向自身。 */
  readonly lordId: OfficerId
  /** 所属城（本切片不跨城移动）。 */
  readonly cityId: CityId
  /** 体力，取值 [0, staminaMax]。 */
  readonly stamina: number
  /** 本月是否已被指令占用（离城）；月末回城时置回 false。 */
  readonly busy: boolean
}

/** 扣减体力，不低于 0（不变量）。 */
export function spendStamina(o: Officer, amount: number): Officer {
  return { ...o, stamina: Math.max(0, o.stamina - amount) }
}

/** 恢复体力，封顶 max（不变量）。 */
export function recoverStamina(o: Officer, amount: number, max: number): Officer {
  return { ...o, stamina: Math.min(max, o.stamina + amount) }
}

/** 设置占用状态（下令离城 / 月末回城）。 */
export function setBusy(o: Officer, busy: boolean): Officer {
  return { ...o, busy }
}
