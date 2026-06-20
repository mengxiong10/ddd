/**
 * 指令校验失败原因码（`18-command-feedback`）：core 反馈零中文，中文文案由 UI 映射
 * （对照 docs/business-command-rules.md）。跨命令复用同一语义码（单一真相源）。
 */
export type ReasonCode =
  // —— 通用前置 ——
  | 'officer-not-found'
  | 'officer-busy'
  | 'officer-not-available'
  | 'is-captive'
  | 'city-not-found'
  | 'gold-insufficient'
  | 'stamina-insufficient'
  | 'food-insufficient'
  | 'reserve-troops-insufficient'
  // —— 目标城 ——
  | 'target-city-not-found'
  | 'target-is-self-city'
  | 'target-not-friendly-city'
  | 'target-not-enemy-city'
  | 'target-is-friendly-city'
  | 'target-not-adjacent'
  // —— 数量/上限 ——
  | 'invalid-amount'
  | 'exceeds-allocatable'
  | 'exceeds-recruitable'
  | 'invalid-provisions'
  | 'agriculture-capped'
  | 'commerce-capped'
  | 'prevention-capped'
  // —— 出征编队 ——
  | 'invalid-campaign-size'
  | 'duplicate-officers'
  | 'officers-not-same-city'
  // —— 俘虏/招降 ——
  | 'captive-not-found'
  | 'captive-not-in-city'
  | 'target-not-captive'
  // —— 道具 ——
  | 'item-not-found'
  | 'item-not-in-city'
  | 'item-undiscovered'
  | 'officer-items-full'
  | 'item-not-held-by-officer'
  // —— 外交目标 ——
  | 'target-not-found'
  | 'target-not-enemy-officer'
  | 'target-not-enemy-governor'
  | 'target-not-enemy-lord'
  | 'cannot-induce-own-lord'
  | 'city-power-insufficient'
  // —— 流放 ——
  | 'already-wandering'
  | 'cannot-banish-active-lord'
  // —— 重选君主 / 守军 / 阶段推进 ——
  | 'no-pending-succession'
  | 'invalid-successor'
  | 'no-pending-defense'
  | 'duplicate-defenders'
  | 'too-many-defenders'
  | 'invalid-defenders'
  | 'battle-in-progress'
  | 'pending-succession'
  | 'pending-defense'
  // —— 战斗（battle-core）——
  | 'no-active-battle'
  | 'battle-ended'
  | 'unit-not-found-or-routed'
  | 'not-player-unit'
  | 'unit-already-acted'
  | 'cannot-act-status'
  | 'move-unreachable'
  | 'attack-out-of-range'
  | 'no-enemy-at-target'
  | 'cannot-cast-status'
  | 'skill-not-found'
  | 'skill-not-learned'
  | 'mp-insufficient'
  | 'weather-terrain-forbidden'
  | 'target-required'
  | 'skill-out-of-range'
  | 'no-unit-at-target'
  | 'skill-needs-enemy'
  | 'skill-needs-ally'
  | 'weather-terrain-troop-forbidden'

/** 指令前置校验结果：ok 为 false 时 reason 给出可供 UI 映射的失败原因码。 */
export interface CommandCheck {
  readonly ok: boolean
  readonly reason?: ReasonCode
}
