/** 指令前置校验结果：ok 为 false 时 reason 给出可展示给玩家的原因。 */
export interface CommandCheck {
  readonly ok: boolean
  readonly reason?: string
}
