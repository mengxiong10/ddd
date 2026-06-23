import type { GameState, PendingCommand } from '../game-state'
import type { CityId, ItemId, OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import { withEvents, type WithEvents, type WithCheck } from '../shared/outcome'
import { canDevelop, develop } from './develop'
import { canRecruit, recruit } from './recruit'
import { canAllocate, allocate } from './allocate'
import { canPlunder, plunder, executePlunder } from './plunder'
import { canScout, scout } from './scout'
import { canCampaign, campaign } from './campaign'
import { canReward, reward, canConfiscate, confiscate } from './reward'
import { canPatrol, patrol } from './patrol'
import { canBanquet, banquet } from './banquet'
import { canTrade, trade, type TradeMode } from './trade'
import { canMove, move, executeMove } from './move'
import { canTransport, transport, executeTransport } from './transport'
import { canSearch, search, executeSearch } from './search'
import { canSuborn, suborn, executeSuborn } from './suborn'
import {
  canEntice,
  entice,
  executeEntice,
  canAlienate,
  alienate,
  executeAlienate,
  canInstigate,
  instigate,
  executeInstigate,
  canInduce,
  induce,
  executeInduce,
} from './diplomacy'
import { canBehead, behead, canBanish, banish } from './captive'
import { canGovern, govern } from './govern'

/**
 * 经营动作（economy 子联合，type 单一来源；game.ts 的 Action 由此 + 阶段动作组合）。
 * 拆 develop 为 reclaim/commerce 后，所有入队命令的 action type 与 PendingCommand type 一一对应
 * （即 SPECS 的 key），故无需再单存 commandType——月末分派直接按 key。
 */
export type EconomyAction =
  | { type: 'reclaim'; officerId: OfficerId } // 开垦 -> agriculture
  | { type: 'commerce'; officerId: OfficerId } // 招商 -> commerce
  | { type: 'recruit'; officerId: OfficerId; amount: number } // 征兵（占人）
  | { type: 'allocate'; officerId: OfficerId; amount: number } // 分配（不占人）
  | { type: 'plunder'; officerId: OfficerId } // 掠夺（占人，效果延到月末）
  | { type: 'scout'; officerId: OfficerId; targetCityId: CityId } // 侦察（占人，即时）
  | { type: 'campaign'; officerIds: readonly OfficerId[]; targetCityId: CityId; provisions: number } // 出征（占人，月末交互式）
  | { type: 'reward'; officerId: OfficerId; itemId: ItemId } // 赏赐（不占人，即时）
  | { type: 'confiscate'; officerId: OfficerId; itemId: ItemId } // 没收（不占人，即时）
  | { type: 'patrol'; officerId: OfficerId } // 出巡（占人，即时）
  | { type: 'banquet'; officerId: OfficerId } // 宴请（不占人，即时）
  | { type: 'trade'; officerId: OfficerId; mode: TradeMode; amount: number } // 交易（占人，即时）
  | { type: 'move'; officerId: OfficerId; targetCityId: CityId } // 移动（占人，效果延到月末）
  | {
      type: 'transport'
      officerId: OfficerId
      targetCityId: CityId
      food: number
      gold: number
      troops: number
    } // 输送（占人，效果延到月末）
  | { type: 'search'; officerId: OfficerId } // 搜寻（占人，效果延到月末）
  | { type: 'suborn'; officerId: OfficerId; captiveId: OfficerId } // 招降（占人，效果延到月末）
  | { type: 'entice'; officerId: OfficerId; targetOfficerId: OfficerId } // 招揽（占人，月末）
  | { type: 'alienate'; officerId: OfficerId; targetOfficerId: OfficerId } // 离间（占人，月末）
  | { type: 'instigate'; officerId: OfficerId; targetOfficerId: OfficerId } // 策反（占人，月末）
  | { type: 'induce'; officerId: OfficerId; targetOfficerId: OfficerId } // 劝降（占人，月末）
  | { type: 'behead'; captiveId: OfficerId } // 处斩（不占人，即时）
  | { type: 'banish'; officerId: OfficerId } // 流放（不占人，即时）
  | { type: 'govern'; officerId: OfficerId } // 治理（占人，即时）

type EconomyType = EconomyAction['type']
type ActionOf<T extends EconomyType> = Extract<EconomyAction, { type: T }>
type CommandOf<T extends EconomyType> = Extract<PendingCommand, { type: T }>

/**
 * 单条经营命令的三阶段（同处注册，避免 game.ts / turn 三处手写 switch）：
 * - `can`：下令校验（薄适配 canX），供 canApply 与 call 内部守卫。
 * - `call`：下令执行（薄适配 X，自报告 WithCheck），供 applyWithEvents。
 * - `run`：月末执行（薄适配 executeX），供 runNonCampaignPending；仅延后效果命令有。
 * 入队的 PendingCommand type 即该命令在 SPECS 的 key（拆 develop 后一一对应），故不另存 commandType。
 */
interface EconomyCommand<T extends EconomyType> {
  can(state: GameState, action: ActionOf<T>, config: GameConfig): CommandCheck
  call(state: GameState, action: ActionOf<T>, config: GameConfig): WithCheck<GameState>
  run?(state: GameState, command: CommandOf<T>, config: GameConfig): WithEvents<GameState>
}

type EconomyRegistry = { [T in EconomyType]: EconomyCommand<T> }

/** 经营命令注册表：每条命令 can/call/run 三阶段就近放在一起（薄适配现有具名函数）。 */
const SPECS: EconomyRegistry = {
  reclaim: {
    can: (s, a, c) => canDevelop(s, a.officerId, 'agriculture', c),
    call: (s, a, c) => develop(s, a.officerId, 'agriculture', c),
  },
  commerce: {
    can: (s, a, c) => canDevelop(s, a.officerId, 'commerce', c),
    call: (s, a, c) => develop(s, a.officerId, 'commerce', c),
  },
  recruit: {
    can: (s, a, c) => canRecruit(s, a.officerId, a.amount, c),
    call: (s, a, c) => recruit(s, a.officerId, a.amount, c),
  },
  allocate: {
    can: (s, a) => canAllocate(s, a.officerId, a.amount),
    call: (s, a) => allocate(s, a.officerId, a.amount),
  },
  plunder: {
    can: (s, a, c) => canPlunder(s, a.officerId, c),
    call: (s, a, c) => plunder(s, a.officerId, c),
    run: (s, cmd) => executePlunder(s, cmd.officerId),
  },
  scout: {
    can: (s, a, c) => canScout(s, a.officerId, a.targetCityId, c),
    call: (s, a, c) => scout(s, a.officerId, a.targetCityId, c),
  },
  campaign: {
    // 月末走 end-month.advanceCampaigns 交互式处理，故不注册 run。
    can: (s, a) => canCampaign(s, a.officerIds, a.targetCityId, a.provisions),
    call: (s, a) => campaign(s, a.officerIds, a.targetCityId, a.provisions),
  },
  reward: {
    can: (s, a) => canReward(s, a.officerId, a.itemId),
    call: (s, a) => reward(s, a.officerId, a.itemId),
  },
  confiscate: {
    can: (s, a) => canConfiscate(s, a.officerId, a.itemId),
    call: (s, a) => confiscate(s, a.officerId, a.itemId),
  },
  patrol: {
    can: (s, a, c) => canPatrol(s, a.officerId, c),
    call: (s, a, c) => patrol(s, a.officerId, c),
  },
  banquet: {
    can: (s, a, c) => canBanquet(s, a.officerId, c),
    call: (s, a, c) => banquet(s, a.officerId, c),
  },
  trade: {
    can: (s, a, c) => canTrade(s, a.officerId, a.mode, a.amount, c),
    call: (s, a, c) => trade(s, a.officerId, a.mode, a.amount, c),
  },
  move: {
    can: (s, a) => canMove(s, a.officerId, a.targetCityId),
    call: (s, a) => move(s, a.officerId, a.targetCityId),
    run: (s, cmd) => withEvents(executeMove(s, cmd.officerId, cmd.targetCityId)),
  },
  transport: {
    can: (s, a, c) => canTransport(s, a.officerId, a.targetCityId, a.food, a.gold, a.troops, c),
    call: (s, a, c) => transport(s, a.officerId, a.targetCityId, a.food, a.gold, a.troops, c),
    run: (s, cmd) =>
      executeTransport(s, cmd.officerId, cmd.targetCityId, cmd.food, cmd.gold, cmd.troops),
  },
  search: {
    can: (s, a, c) => canSearch(s, a.officerId, c),
    call: (s, a, c) => search(s, a.officerId, c),
    run: (s, cmd) => executeSearch(s, cmd.officerId),
  },
  suborn: {
    can: (s, a, c) => canSuborn(s, a.officerId, a.captiveId, c),
    call: (s, a, c) => suborn(s, a.officerId, a.captiveId, c),
    run: (s, cmd) => executeSuborn(s, cmd.officerId, cmd.captiveId),
  },
  entice: {
    can: (s, a, c) => canEntice(s, a.officerId, a.targetOfficerId, c),
    call: (s, a, c) => entice(s, a.officerId, a.targetOfficerId, c),
    run: (s, cmd) => executeEntice(s, cmd.officerId, cmd.targetOfficerId),
  },
  alienate: {
    can: (s, a, c) => canAlienate(s, a.officerId, a.targetOfficerId, c),
    call: (s, a, c) => alienate(s, a.officerId, a.targetOfficerId, c),
    run: (s, cmd) => executeAlienate(s, cmd.officerId, cmd.targetOfficerId),
  },
  instigate: {
    can: (s, a, c) => canInstigate(s, a.officerId, a.targetOfficerId, c),
    call: (s, a, c) => instigate(s, a.officerId, a.targetOfficerId, c),
    run: (s, cmd) => executeInstigate(s, cmd.officerId, cmd.targetOfficerId),
  },
  induce: {
    can: (s, a, c) => canInduce(s, a.officerId, a.targetOfficerId, c),
    call: (s, a, c) => induce(s, a.officerId, a.targetOfficerId, c),
    run: (s, cmd) => executeInduce(s, cmd.officerId, cmd.targetOfficerId),
  },
  behead: {
    can: (s, a) => canBehead(s, a.captiveId),
    call: (s, a) => behead(s, a.captiveId),
  },
  banish: {
    can: (s, a) => canBanish(s, a.officerId),
    call: (s, a) => banish(s, a.officerId),
  },
  govern: {
    can: (s, a, c) => canGovern(s, a.officerId, c),
    call: (s, a, c) => govern(s, a.officerId, c),
  },
}

/** action.type 是否为经营命令（narrow 到 EconomyAction；否则为阶段动作，由 game.ts 处理）。 */
export function isEconomyAction<A extends { type: string }>(
  action: A
): action is Extract<A, { type: EconomyType }> {
  return action.type in SPECS
}

/** 经营命令下令校验（薄分派；调用方先经 isEconomyAction 收窄）。 */
export function economyCan(
  state: GameState,
  action: EconomyAction,
  config: GameConfig
): CommandCheck {
  const spec = SPECS[action.type] as EconomyCommand<EconomyType>
  return spec.can(state, action, config)
}

/** 经营命令下令执行（薄分派；返回自报告 WithCheck）。 */
export function economyCall(
  state: GameState,
  action: EconomyAction,
  config: GameConfig
): WithCheck<GameState> {
  const spec = SPECS[action.type] as EconomyCommand<EconomyType>
  return spec.call(state, action, config)
}

/**
 * 月末执行分派表（按 PendingCommand type）：仅声明了 run 的延后效果命令注册，缺省=月末空操作。
 * key 直接取 SPECS 的 key（= 入队的 PendingCommand type，拆 develop 后一一对应）。
 */
type MonthRun = (
  state: GameState,
  command: PendingCommand,
  config: GameConfig
) => WithEvents<GameState>

export const economyMonthRun: Partial<Record<PendingCommand['type'], MonthRun>> = (() => {
  const table: Partial<Record<PendingCommand['type'], MonthRun>> = {}
  for (const key of Object.keys(SPECS) as EconomyType[]) {
    const spec = SPECS[key] as EconomyCommand<EconomyType>
    if (spec.run) table[key as PendingCommand['type']] = spec.run as MonthRun
  }
  return table
})()
