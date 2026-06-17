import type { CityId, ItemId, OfficerId } from '../shared/ids'
import type { TroopTypeOverride } from './troop-type'

/**
 * 道具归属（判别式值对象）：属某城 或 某武将，二选一——单一真相源。
 * 二选一的形态天然保证「不会同时属城与将」，城/武将的道具列表全由此派生。
 * officer 分支带 equipSeq（装备先后序号）：求有效兵种时后装备（seq 大）覆盖先装备。
 */
export type ItemHolder =
  | { readonly kind: 'city'; readonly cityId: CityId }
  | { readonly kind: 'officer'; readonly officerId: OfficerId; readonly equipSeq: number }

/** 道具聚合：对武力/智力的加成为派生加成源，不写回 Officer 存储字段。 */
export interface Item {
  readonly id: ItemId
  readonly name: string
  /** 武力加成，≥0。 */
  readonly forceBonus: number
  /** 智力加成，≥0。 */
  readonly intelBonus: number
  /** 移动力加成（整数）：佩戴即计入有效移动力。 */
  readonly movementBonus: number
  /** 改兵种字段（0..3）：见 TroopTypeOverride。装备门槛在求有效兵种时判定。 */
  readonly troopTypeOverride: TroopTypeOverride
  readonly holder: ItemHolder
  /** 是否已被发现：fixture 既有道具恒 true；登场道具落城为 false，未发现则不可被赏赐。 */
  readonly discovered: boolean
  /** 伯乐：能发现该道具的特定武将 id；null = 无指定（任何执行人可发现）。 */
  readonly recruiterId: OfficerId | null
}

/** 每名武将最多持有道具数（量纲上限，规则身份，内联常量）。 */
export const MAX_ITEMS_PER_OFFICER = 2

/**
 * 归属改到某武将（纯函数）。equipSeq=装备先后序号（默认 0，仅测试便利）；
 * 唯一真实写入方 economy/reward 总传显式 nextEquipSeq。
 */
export function holdByOfficer(item: Item, officerId: OfficerId, equipSeq = 0): Item {
  return { ...item, holder: { kind: 'officer', officerId, equipSeq } }
}

/** 归属改到某城（纯函数）。 */
export function holdByCity(item: Item, cityId: CityId): Item {
  return { ...item, holder: { kind: 'city', cityId } }
}

/** 标记已发现（纯函数）：搜寻发现后置 true，方可被赏赐。 */
export function discover(item: Item): Item {
  return { ...item, discovered: true }
}
