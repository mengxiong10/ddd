import type { CityId, OfficerId } from '../shared/ids'
import type { DevelopKind } from '../shared/config'

/** 民忠量纲上限（百分制，固定值；规则身份，不入 config）。 */
export const CITY_LOYALTY_MAX = 100

/** 防灾值量纲上限（百分制，固定值；规则身份，不入 config）。 */
export const DISASTER_PREVENTION_MAX = 100

/** 城市状态：正常 + 四种灾害。单值存储；异常 = 灾害四种之一。 */
export type CityStatus = 'normal' | 'famine' | 'drought' | 'flood' | 'riot'

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
  /** 城市状态，初始 'normal'（fixture 播种）；灾害生成/恢复/治理改写。 */
  readonly status: CityStatus
  /** 防灾值 [0, DISASTER_PREVENTION_MAX]；越高越不易发灾、越快从旱/水灾恢复。 */
  readonly disasterPrevention: number
  /** 战斗地图 id（指向 military/battle-map 的 BATTLE_MAPS 模板，fixture 播种）。用 string 避免 world→military 反向依赖。 */
  readonly battleMapId: string
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

/** 设城市状态（治理改 normal / 生成改灾种 / 恢复改 normal）。 */
export function setStatus(c: City, status: CityStatus): City {
  return { ...c, status }
}

/** 防灾值回升，钳制 [0, DISASTER_PREVENTION_MAX]（治理用）。 */
export function raisePrevention(c: City, delta: number): City {
  return { ...c, disasterPrevention: Math.max(0, Math.min(DISASTER_PREVENTION_MAX, c.disasterPrevention + delta)) }
}

/**
 * 灾害破坏表（规则身份，内联）：每状态各受影响字段的「剩余比例」乘子。
 * 损失按当前值百分比扣，新值 = floor(当前 × 剩余比例)；「减半」即剩余 0.5（floor(当前/2)）。
 * 未列字段保持不变。normal 无条目（不破坏）。
 */
type DamageFactors = Partial<Record<'food' | 'commerce' | 'gold' | 'loyalty' | 'reserveTroops' | 'population' | 'agriculture', number>>
const DISASTER_DAMAGE: Record<Exclude<CityStatus, 'normal'>, DamageFactors> = {
  // 饥荒：商业-5% 民忠-5% 后备兵减半 人口-25% 农业-5%
  famine: { commerce: 0.95, loyalty: 0.95, reserveTroops: 0.5, population: 0.75, agriculture: 0.95 },
  // 旱灾：粮-5% 后备兵-25% 人口-25% 农业-5%
  drought: { food: 0.95, reserveTroops: 0.75, population: 0.75, agriculture: 0.95 },
  // 水灾：粮-5% 商业-10% 金-10% 后备兵-25% 人口-25% 农业-5%
  flood: { food: 0.95, commerce: 0.9, gold: 0.9, reserveTroops: 0.75, population: 0.75, agriculture: 0.95 },
  // 暴动：粮-5% 商业-5% 金-5% 民忠-10% 后备兵减半 农业-5%
  riot: { food: 0.95, commerce: 0.95, gold: 0.95, loyalty: 0.9, reserveTroops: 0.5, agriculture: 0.95 },
}

/**
 * 按状态破坏：每受影响字段 new = floor(当前 × 剩余比例)。normal 原样返回（防御性）。
 * 纯函数、不耗 RNG；调用方（world/disaster）只对异常城调用。
 */
export function applyDisasterDamage(c: City, status: CityStatus): City {
  if (status === 'normal') return c
  const f = DISASTER_DAMAGE[status]
  const scale = (value: number, factor: number | undefined): number =>
    factor === undefined ? value : Math.floor(value * factor)
  return {
    ...c,
    food: scale(c.food, f.food),
    commerce: scale(c.commerce, f.commerce),
    gold: scale(c.gold, f.gold),
    loyalty: scale(c.loyalty, f.loyalty),
    reserveTroops: scale(c.reserveTroops, f.reserveTroops),
    population: scale(c.population, f.population),
    agriculture: scale(c.agriculture, f.agriculture),
  }
}
