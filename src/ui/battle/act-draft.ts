import type { OfficerId, Position, SkillId, BattleAction } from '../../store/selectors'

/** 可派发的战斗 act（终结动作）。 */
type ActAction = Extract<BattleAction, { type: 'act' }>

/**
 * 战斗行动草稿（本地纯状态机，`21-main-flow-ui`）：选我方单位 → 选落点 → 浮动菜单选攻击/施法/休息。
 * 合法性走 canDispatch(canBattle)，本模块只负责形态收集。
 */
export type ActDraft =
  | { readonly kind: 'idle' }
  | { readonly kind: 'unit'; readonly officerId: OfficerId; readonly moveTo?: Position } // 已选单位、可改落点
  | { readonly kind: 'attack'; readonly officerId: OfficerId; readonly moveTo?: Position } // 待点敌格
  | {
      readonly kind: 'cast'
      readonly officerId: OfficerId
      readonly moveTo?: Position
      readonly skillId: SkillId
    } // 待点目标
  | { readonly kind: 'cast-pick-skill'; readonly officerId: OfficerId; readonly moveTo?: Position } // 待选技能

/** 顶栏〔选中〕点击弹详情的对象：选中单位 或 所点地形格。 */
export type BattleInspect =
  | { readonly kind: 'unit'; readonly officerId: OfficerId }
  | { readonly kind: 'tile'; readonly pos: Position }

export function selectUnit(officerId: OfficerId): ActDraft {
  return { kind: 'unit', officerId }
}

/** 改落点（回到 unit 态以重弹菜单）；undefined 表示原地不动。 */
export function setMove(draft: ActDraft, moveTo: Position | undefined): ActDraft {
  if (draft.kind === 'idle') return draft
  return moveTo === undefined
    ? { kind: 'unit', officerId: draft.officerId }
    : { kind: 'unit', officerId: draft.officerId, moveTo }
}

/** 进入攻击/选技能态（落点沿用）。 */
export function toAttack(draft: ActDraft): ActDraft {
  if (draft.kind === 'idle') return draft
  return draft.moveTo === undefined
    ? { kind: 'attack', officerId: draft.officerId }
    : { kind: 'attack', officerId: draft.officerId, moveTo: draft.moveTo }
}

export function toPickSkill(draft: ActDraft): ActDraft {
  if (draft.kind === 'idle') return draft
  return draft.moveTo === undefined
    ? { kind: 'cast-pick-skill', officerId: draft.officerId }
    : { kind: 'cast-pick-skill', officerId: draft.officerId, moveTo: draft.moveTo }
}

export function toCast(draft: ActDraft, skillId: SkillId): ActDraft {
  if (draft.kind === 'idle') return draft
  return draft.moveTo === undefined
    ? { kind: 'cast', officerId: draft.officerId, skillId }
    : { kind: 'cast', officerId: draft.officerId, moveTo: draft.moveTo, skillId }
}

/**
 * 组装可派发的战斗 act；未集齐返回 null。
 * - rest 不经此函数（菜单直接 onAct）。
 * - attack 需 target；cast 有 target（指向技能）则带、无（self 技能）则省。
 */
export function actToBattleAction(draft: ActDraft, target?: Position): ActAction | null {
  if (draft.kind === 'attack') {
    if (!target) return null
    const terminal = { kind: 'attack', target } as const
    return draft.moveTo === undefined
      ? { type: 'act', officerId: draft.officerId, terminal }
      : { type: 'act', officerId: draft.officerId, moveTo: draft.moveTo, terminal }
  }
  if (draft.kind === 'cast') {
    const terminal = target
      ? ({ kind: 'cast', skillId: draft.skillId, target } as const)
      : ({ kind: 'cast', skillId: draft.skillId } as const)
    return draft.moveTo === undefined
      ? { type: 'act', officerId: draft.officerId, terminal }
      : { type: 'act', officerId: draft.officerId, moveTo: draft.moveTo, terminal }
  }
  return null
}

/** 休息 act（菜单直接派发）。 */
export function restAction(draft: ActDraft): ActAction | null {
  if (draft.kind === 'idle') return null
  const terminal = { kind: 'rest' } as const
  return draft.moveTo === undefined
    ? { type: 'act', officerId: draft.officerId, terminal }
    : { type: 'act', officerId: draft.officerId, moveTo: draft.moveTo, terminal }
}
