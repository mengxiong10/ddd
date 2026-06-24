import type { Action, OfficerId, CityId, ItemId, TradeMode } from '../../store/selectors'

/**
 * 命令优先草稿（本地纯状态机，零规则，`21-main-flow-ui`）：选中我方城 → 点一条命令 →
 * 按命令缺什么补什么逐步收集入参。合法性一律走 canDispatch，本模块只负责「形态收集」。
 */

/** UI 经营命令种类（= 我方城面板指令；与 EconomyAction['type'] 对应子集）。 */
export type CommandKind =
  | 'reclaim'
  | 'commerce'
  | 'patrol'
  | 'govern'
  | 'banquet'
  | 'search'
  | 'plunder' // 执行人-only
  | 'recruit'
  | 'allocate' // 执行人 + 数量
  | 'trade' // 执行人 + 买卖 + 数量
  | 'reward'
  | 'confiscate' // 执行人 + 道具
  | 'suborn'
  | 'behead'
  | 'banish' // 俘虏 / 在城处置
  | 'entice'
  | 'alienate'
  | 'instigate'
  | 'induce' // 执行人 + 敌方目标将
  | 'scout'
  | 'move'
  | 'transport' // 执行人 + 目标城
  | 'campaign' // 名单 + 目标城 + 粮草

/** 命令分组（仅 UI 面板归类展示）：内政 / 外交 / 军备 三类。 */
export type CommandGroup = 'develop' | 'diplomacy' | 'military'

export const COMMAND_GROUPS: Record<CommandGroup, readonly CommandKind[]> = {
  develop: [
    'reclaim',
    'commerce',
    'patrol',
    'govern',
    'trade',
    'search',
    'banquet',
    'reward',
    'confiscate',
    'suborn',
    'behead',
    'banish',
    'move',
    'transport',
  ],
  diplomacy: ['alienate', 'entice', 'instigate', 'induce'],
  military: ['scout', 'recruit', 'allocate', 'plunder', 'campaign'],
}

/** 待收集的下一个参数槽。 */
export type DraftSlot =
  | 'executor'
  | 'amount'
  | 'trade-args'
  | 'item'
  | 'captive'
  | 'target-officer'
  | 'target-city'
  | 'campaign-members'
  | 'provisions'

/** 每命令的收集序列（最后一个槽为终结槽）。 */
const SLOTS: Record<CommandKind, readonly DraftSlot[]> = {
  reclaim: ['executor'],
  commerce: ['executor'],
  patrol: ['executor'],
  govern: ['executor'],
  banquet: ['executor'],
  search: ['executor'],
  plunder: ['executor'],
  banish: ['executor'],
  recruit: ['executor', 'amount'],
  allocate: ['executor', 'amount'],
  trade: ['executor', 'trade-args'],
  reward: ['executor', 'item'],
  confiscate: ['executor', 'item'],
  suborn: ['executor', 'captive'],
  behead: ['captive'],
  entice: ['executor', 'target-officer'],
  alienate: ['executor', 'target-officer'],
  instigate: ['executor', 'target-officer'],
  induce: ['executor', 'target-officer'],
  scout: ['executor', 'target-city'],
  move: ['executor', 'target-city'],
  transport: ['executor', 'target-city', 'amount'],
  campaign: ['campaign-members', 'target-city', 'provisions'],
}

/**
 * 草稿态：选中城后逐步收集某命令入参。判别式联合显式列举「正在收集什么」，不做通用 slot 引擎。
 * 已收集的参数随收集累积在同一对象上；地图点城在 awaiting==='target-city' 时回填 targetCityId。
 */
export type CommandDraft =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pick-command' }
  | {
      readonly kind: 'collect'
      readonly command: CommandKind
      readonly awaiting: DraftSlot
      readonly officerId?: OfficerId
      readonly targetCityId?: CityId
      readonly officerIds?: readonly OfficerId[]
      readonly itemId?: ItemId
      readonly captiveId?: OfficerId
      readonly targetOfficerId?: OfficerId
      readonly amount?: number
      readonly tradeMode?: TradeMode
      readonly provisions?: number
    }

export type DraftInput =
  | { readonly slot: 'executor'; readonly officerId: OfficerId }
  | { readonly slot: 'amount'; readonly amount: number }
  | { readonly slot: 'trade-args'; readonly mode: TradeMode; readonly amount: number }
  | { readonly slot: 'item'; readonly itemId: ItemId }
  | { readonly slot: 'captive'; readonly captiveId: OfficerId }
  | { readonly slot: 'target-officer'; readonly targetOfficerId: OfficerId }
  | { readonly slot: 'target-city'; readonly targetCityId: CityId }
  | { readonly slot: 'campaign-members'; readonly officerIds: readonly OfficerId[] }
  | { readonly slot: 'provisions'; readonly provisions: number }

/** 起手：某命令进入收集态（awaiting = 其第一个槽）。 */
export function startCommand(command: CommandKind): CommandDraft {
  return { kind: 'collect', command, awaiting: SLOTS[command][0]! }
}

/** 推进：把一次输入并入草稿，awaiting 前移到下一槽（已是末槽则保持，靠 draftToAction 判集齐）。 */
export function advanceDraft(draft: CommandDraft, input: DraftInput): CommandDraft {
  if (draft.kind !== 'collect') return draft
  const seq = SLOTS[draft.command]
  if (input.slot !== draft.awaiting) return draft
  const idx = seq.indexOf(input.slot)
  const nextSlot = seq[idx + 1] ?? input.slot
  const base = { ...draft, awaiting: nextSlot }
  switch (input.slot) {
    case 'executor':
      return { ...base, officerId: input.officerId }
    case 'target-city':
      return { ...base, targetCityId: input.targetCityId }
    case 'campaign-members':
      return { ...base, officerIds: input.officerIds }
    case 'item':
      return { ...base, itemId: input.itemId }
    case 'captive':
      return { ...base, captiveId: input.captiveId }
    case 'target-officer':
      return { ...base, targetOfficerId: input.targetOfficerId }
    case 'amount':
      return { ...base, amount: input.amount }
    case 'trade-args':
      return { ...base, tradeMode: input.mode, amount: input.amount }
    case 'provisions':
      return { ...base, provisions: input.provisions }
  }
}

/** 草稿是否集齐、可转 Action（缺参返回 null；transport 由面板直接组装，恒返回 null）。 */
export function draftToAction(draft: CommandDraft): Action | null {
  if (draft.kind !== 'collect') return null
  const { command, officerId, targetCityId, officerIds, itemId, captiveId, targetOfficerId } = draft
  switch (command) {
    case 'reclaim':
    case 'commerce':
    case 'patrol':
    case 'govern':
    case 'banquet':
    case 'search':
    case 'plunder':
    case 'banish':
      return officerId === undefined ? null : { type: command, officerId }
    case 'recruit':
    case 'allocate':
      return officerId === undefined || draft.amount === undefined
        ? null
        : { type: command, officerId, amount: draft.amount }
    case 'trade':
      return officerId === undefined || draft.tradeMode === undefined || draft.amount === undefined
        ? null
        : { type: 'trade', officerId, mode: draft.tradeMode, amount: draft.amount }
    case 'reward':
    case 'confiscate':
      return officerId === undefined || itemId === undefined
        ? null
        : { type: command, officerId, itemId }
    case 'suborn':
      return officerId === undefined || captiveId === undefined
        ? null
        : { type: 'suborn', officerId, captiveId }
    case 'behead':
      return captiveId === undefined ? null : { type: 'behead', captiveId }
    case 'entice':
    case 'alienate':
    case 'instigate':
    case 'induce':
      return officerId === undefined || targetOfficerId === undefined
        ? null
        : { type: command, officerId, targetOfficerId }
    case 'scout':
    case 'move':
      return officerId === undefined || targetCityId === undefined
        ? null
        : { type: command, officerId, targetCityId }
    case 'campaign':
      return officerIds === undefined ||
        officerIds.length === 0 ||
        targetCityId === undefined ||
        draft.provisions === undefined
        ? null
        : { type: 'campaign', officerIds, targetCityId, provisions: draft.provisions }
    case 'transport':
      return null // 三数（粮/金/兵）由面板直接组装派发。
  }
}

/** 可被「上一步」清空的草稿数据字段（不含 kind/command/awaiting）。 */
type ClearKey =
  | 'officerId'
  | 'targetCityId'
  | 'officerIds'
  | 'itemId'
  | 'captiveId'
  | 'targetOfficerId'
  | 'amount'
  | 'tradeMode'
  | 'provisions'

/** 每个收集槽回退时应清空的字段。 */
const SLOT_CLEARS: Record<DraftSlot, readonly ClearKey[]> = {
  executor: ['officerId'],
  'target-city': ['targetCityId'],
  'campaign-members': ['officerIds'],
  item: ['itemId'],
  captive: ['captiveId'],
  'target-officer': ['targetOfficerId'],
  amount: ['amount'],
  'trade-args': ['tradeMode', 'amount'],
  provisions: ['provisions'],
}

/** 上一步：退回上一收集槽并清空该槽已填值；已在首槽则回命令面板。 */
export function stepBack(draft: CommandDraft): CommandDraft {
  if (draft.kind !== 'collect') return draft
  const seq = SLOTS[draft.command]
  const idx = seq.indexOf(draft.awaiting)
  if (idx <= 0) return { kind: 'pick-command' }
  const prev = seq[idx - 1]!
  const next = { ...draft, awaiting: prev }
  for (const k of SLOT_CLEARS[prev]) delete next[k]
  return next
}

/** 当前草稿是否处于「等地图点目标城」态（驱动地图高亮可选城）。 */
export function isAwaitingTargetCity(draft: CommandDraft): boolean {
  return draft.kind === 'collect' && draft.awaiting === 'target-city'
}
