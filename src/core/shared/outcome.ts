import type { CityId, ItemId, OfficerId } from './ids'
import type { CommandCheck } from './command'

/**
 * 命令反馈结果事件（`18-command-feedback`）：core 面向玩家产出的「携数据/决结果分支」结构化事件，
 * 零中文（中文呈现 + 多变体台词的挑选由 UI 负责，对照 docs/business-command-rules.md）。
 *
 * 红线：构造事件**不消耗 `GameState.rng`**；事件与 state **并列返回**（见 WithEvents），绝不进 GameState。
 * 只为有数据/有结果分支者产事件——纯确认（"部队已出发"）与 UI 已知量（征兵/交易/分配量、赏赐/没收目标）不产。
 */
export type OutcomeEvent =
  // —— 即时经营（apply 下令时产出）——
  | {
      readonly kind: 'develop-done'
      readonly officerId: OfficerId
      readonly cityId: CityId
      readonly attr: 'agriculture' | 'commerce'
      readonly newValue: number
      readonly delta: number
    }
  | {
      readonly kind: 'govern-done'
      readonly officerId: OfficerId
      readonly cityId: CityId
      readonly newPrevention: number
      readonly delta: number
    }
  | {
      readonly kind: 'patrol-done'
      readonly officerId: OfficerId
      readonly cityId: CityId
      readonly newLoyalty: number
      readonly loyaltyDelta: number
    }
  // —— 月末经营结算 ——
  | { readonly kind: 'search-none'; readonly officerId: OfficerId; readonly cityId: CityId }
  | {
      readonly kind: 'search-recruited'
      readonly officerId: OfficerId
      readonly cityId: CityId
      readonly targetId: OfficerId
    }
  | {
      readonly kind: 'search-found-not-recruited'
      readonly officerId: OfficerId
      readonly cityId: CityId
      readonly targetId: OfficerId
    }
  | {
      readonly kind: 'search-item'
      readonly officerId: OfficerId
      readonly cityId: CityId
      readonly itemId: ItemId
    }
  | {
      readonly kind: 'search-resource'
      readonly officerId: OfficerId
      readonly cityId: CityId
      readonly resource: 'gold' | 'food'
      readonly amount: number
    }
  | {
      readonly kind: 'plunder-done'
      readonly officerId: OfficerId
      readonly cityId: CityId
      readonly goldGained: number
      readonly foodGained: number
    }
  | {
      readonly kind: 'transport-delivered'
      readonly officerId: OfficerId
      readonly targetCityId: CityId
      readonly food: number
      readonly gold: number
      readonly troops: number
    }
  | {
      readonly kind: 'transport-robbed'
      readonly officerId: OfficerId
      readonly targetCityId: CityId
    }
  | {
      readonly kind: 'suborn-result'
      readonly officerId: OfficerId
      readonly captiveId: OfficerId
      readonly success: boolean
    }
  // —— 外交月末结算 ——
  | {
      readonly kind: 'diplomacy-result'
      readonly command: 'entice' | 'alienate' | 'instigate' | 'induce'
      readonly officerId: OfficerId
      readonly targetOfficerId: OfficerId
      readonly success: boolean
    }
  // —— 战斗逐次反馈（每次普攻产出；UI 按攻击方归属过滤）——
  | {
      readonly kind: 'battle-attack'
      readonly attackerId: OfficerId
      readonly defenderId: OfficerId
      /** 目标实际损失兵力。 */
      readonly troopLoss: number
      /** 攻击方本次获得经验。 */
      readonly expGain: number
      /** 升级后等级；未升级为 null。 */
      readonly leveledTo: number | null
      /** 目标是否被击溃。 */
      readonly routed: boolean
    }
  // —— 系统事件（月末/战后/外交领土变更）——
  | {
      readonly kind: 'lord-surrendered'
      readonly fromLordId: OfficerId
      readonly toLordId: OfficerId
    }
  | {
      readonly kind: 'lord-instigated'
      readonly officerId: OfficerId
      readonly fromLordId: OfficerId
    }
  | {
      readonly kind: 'city-disaster'
      readonly cityId: CityId
      readonly status: 'famine' | 'drought' | 'flood' | 'riot'
    }
  | { readonly kind: 'city-recovered'; readonly cityId: CityId }
  | { readonly kind: 'lord-stricken'; readonly lordId: OfficerId }
  | { readonly kind: 'succession-pending'; readonly lordId: OfficerId }
  | {
      readonly kind: 'lord-succeeded'
      readonly oldLordId: OfficerId
      readonly newLordId: OfficerId
    }
  | { readonly kind: 'lord-eliminated'; readonly lordId: OfficerId }

/**
 * 事件与 state 的并列通道：产事件的函数返回此元组（**不把 events 放进 GameState**）。
 * orchestrator 用 step/lift 逐层组合并拼接事件；apply 丢弃事件、行为与既往一致。
 */
export interface WithEvents<S> {
  readonly state: S
  readonly events: readonly OutcomeEvent[]
}

/** 包成 WithEvents；缺省事件为空。 */
export const withEvents = <S>(state: S, events: readonly OutcomeEvent[] = []): WithEvents<S> => ({
  state,
  events,
})

/** 串接一个产事件步骤：在前序结果上施加 fn，拼接两段事件。 */
export const step = <S>(prev: WithEvents<S>, fn: (state: S) => WithEvents<S>): WithEvents<S> => {
  const next = fn(prev.state)
  return { state: next.state, events: [...prev.events, ...next.events] }
}

/** 提升一个纯 state→state 步骤为产空事件的步骤（接入 step 折叠）。 */
export const lift =
  <S>(fn: (state: S) => S) =>
  (state: S): WithEvents<S> =>
    withEvents(fn(state))

/**
 * 下令结果（`18-command-feedback` 接口统一）：校验结果（ok/reason）与 状态/事件 并列。
 * 每个下令函数 X **自报告**——把内部本就计算的 canX 结果一并带出，使外层一次调用即得 ok/reason/state/events，
 * 校验只在 X 内跑一次。与 WithEvents<S> 并列（events 仍不进 GameState）。
 */
export type WithCheck<S> = CommandCheck & WithEvents<S>

/** 自报告成功：ok + 新状态 + 事件（无即时事件可省略）。 */
export const commandOk = <S>(state: S, events: readonly OutcomeEvent[] = []): WithCheck<S> => ({
  ok: true,
  state,
  events,
})

/** 自报告失败：带出 canX 的 check（含 reason）、state 不变、无事件。 */
export const commandFail = <S>(check: CommandCheck, state: S): WithCheck<S> => ({
  ...check,
  state,
  events: [],
})
