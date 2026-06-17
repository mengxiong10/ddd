import type { CityId, OfficerId } from '../shared/ids'
import type { DevelopKind } from '../shared/config'

/** 民忠量纲上限（百分制，固定值；规则身份，不入 config）。 */
export const CITY_LOYALTY_MAX = 100

/** 城池聚合。资源（金/粮）按城存放；农业/商业上限为城级字段，各城可不同。 */
export interface City {
  readonly id: CityId
  readonly name: string
  /** 归属君主。 */
  readonly lordId: OfficerId
  /** 农业，取值 [0, agricultureCap]；决定收粮量。 */
  readonly agriculture: number
  /** 商业，取值 [0, commerceCap]；决定收税量。 */
  readonly commerce: number
  /** 城级农业上限。 */
  readonly agricultureCap: number
  /** 城级商业上限。 */
  readonly commerceCap: number
  /** 城金：来自收税，并支付开垦/招商开销。 */
  readonly gold: number
  /** 城粮：来自收粮。 */
  readonly food: number
  /** 民忠，取值 [0, CITY_LOYALTY_MAX]；决定征兵上限（民忠×20）。可被掠夺减半、出巡回升。 */
  readonly loyalty: number
  /** 后备兵：城级未编队兵力，>= 0。征兵注入到此。 */
  readonly reserveTroops: number
  /** 人口；出巡 +100。本切片为展示状态，无下游规则。 */
  readonly population: number
}

/** 按开发种类取对应的城级上限。 */
export function attributeCap(c: City, kind: DevelopKind): number {
  return kind === 'agriculture' ? c.agricultureCap : c.commerceCap
}

/** 提升农业或商业，按城级上限截断（不变量：不超上限）。 */
export function raiseAttribute(c: City, kind: DevelopKind, delta: number): City {
  const next = Math.min(attributeCap(c, kind), (kind === 'agriculture' ? c.agriculture : c.commerce) + delta)
  return kind === 'agriculture' ? { ...c, agriculture: next } : { ...c, commerce: next }
}

/** 扣城金，不低于 0（不变量）。调用方应已校验余额充足。 */
export function spendGold(c: City, amount: number): City {
  return { ...c, gold: Math.max(0, c.gold - amount) }
}

/** 扣城粮，不低于 0（不变量）。调用方应已校验余额充足。 */
export function spendFood(c: City, amount: number): City {
  return { ...c, food: Math.max(0, c.food - amount) }
}

/** 增加城粮（收粮）。 */
export function addFood(c: City, amount: number): City {
  return { ...c, food: c.food + amount }
}

/** 增加城金（收税）。 */
export function addGold(c: City, amount: number): City {
  return { ...c, gold: c.gold + amount }
}

/** 增减后备兵（delta 可负），结果不低于 0（不变量）。 */
export function addReserveTroops(c: City, delta: number): City {
  return { ...c, reserveTroops: Math.max(0, c.reserveTroops + delta) }
}

/** 民忠回升（出巡），钳制 [0, CITY_LOYALTY_MAX]（不变量）。 */
export function gainLoyalty(c: City, delta: number): City {
  return { ...c, loyalty: Math.max(0, Math.min(CITY_LOYALTY_MAX, c.loyalty + delta)) }
}

/** 增加人口（delta ≥ 0；出巡）。 */
export function addPopulation(c: City, delta: number): City {
  return { ...c, population: c.population + delta }
}

/**
 * 掠夺破坏：城被掠夺后的降级转移——农业/商业/民忠各 floor(÷2)。
 * RAVAGE_DIVISOR 为内联规则身份；floor 于非负值即保证 ≥0，且不超原上限，不碰粮/金。
 */
const RAVAGE_DIVISOR = 2
export function ravage(c: City): City {
  return {
    ...c,
    agriculture: Math.floor(c.agriculture / RAVAGE_DIVISOR),
    commerce: Math.floor(c.commerce / RAVAGE_DIVISOR),
    loyalty: Math.floor(c.loyalty / RAVAGE_DIVISOR),
  }
}
