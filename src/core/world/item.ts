import type { CityId, ItemId, OfficerId } from '../shared/ids'

/**
 * 道具归属（判别式值对象）：属某城 或 某武将，二选一——单一真相源。
 * 二选一的形态天然保证「不会同时属城与将」，城/武将的道具列表全由此派生。
 */
export type ItemHolder =
  | { readonly kind: 'city'; readonly cityId: CityId }
  | { readonly kind: 'officer'; readonly officerId: OfficerId }

/** 道具聚合：对武力/智力的加成为派生加成源，不写回 Officer 存储字段。 */
export interface Item {
  readonly id: ItemId
  readonly name: string
  /** 武力加成，≥0。 */
  readonly forceBonus: number
  /** 智力加成，≥0。 */
  readonly intelBonus: number
  readonly holder: ItemHolder
}

/** 每名武将最多持有道具数（量纲上限，规则身份，内联常量）。 */
export const MAX_ITEMS_PER_OFFICER = 2

/** 归属改到某武将（纯函数）。 */
export function holdByOfficer(item: Item, officerId: OfficerId): Item {
  return { ...item, holder: { kind: 'officer', officerId } }
}

/** 归属改到某城（纯函数）。 */
export function holdByCity(item: Item, cityId: CityId): Item {
  return { ...item, holder: { kind: 'city', cityId } }
}
