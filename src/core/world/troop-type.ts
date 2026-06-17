/**
 * 兵种值对象与纯规则。零依赖（不读 state），兵种规则的唯一收敛处。
 * 兵种为「基础存储 + 有效派生」：Officer 存基础兵种，有效兵种由 queries 派生（吃本模块规则）。
 */

/** 六种兵种。骑兵/步兵/弓兵/水军/极兵/玄兵。 */
export type TroopType = 'cavalry' | 'infantry' | 'archer' | 'navy' | 'elite' | 'mystic'

/**
 * 道具「改兵种」字段：0 不改 / 1 水军 / 2 玄兵（智力>105）/ 3 极兵（武力>105）。
 * 只能改成水军/玄兵/极兵；骑兵/步兵/弓兵只来自基础兵种。
 */
export type TroopTypeOverride = 0 | 1 | 2 | 3

/** 各兵种基础移动力（规则身份，内联常量）。 */
export const BASE_MOVEMENT: Record<TroopType, number> = {
  cavalry: 5,
  infantry: 4,
  archer: 4,
  navy: 5,
  elite: 6,
  mystic: 3,
}

/** 极兵装备门槛：有效武力严格 > 105（规则身份，内联常量）。 */
export const ELITE_FORCE_REQUIREMENT = 105
/** 玄兵装备门槛：有效智力严格 > 105（规则身份，内联常量）。 */
export const MYSTIC_INTEL_REQUIREMENT = 105

/**
 * 解析一件道具的改兵种结果（纯函数）：返回新兵种，或 null（不改）。
 * - 0：不改，返回 null。
 * - 1：水军，无门槛。
 * - 2：玄兵，仅当有效智力 > 105，否则 null。
 * - 3：极兵，仅当有效武力 > 105，否则 null。
 * effForce/effIntel 取有效武力/智力（含该武将所持全部道具加成）。
 */
export function resolveOverride(
  override: TroopTypeOverride,
  effForce: number,
  effIntel: number,
): TroopType | null {
  switch (override) {
    case 1:
      return 'navy'
    case 2:
      return effIntel > MYSTIC_INTEL_REQUIREMENT ? 'mystic' : null
    case 3:
      return effForce > ELITE_FORCE_REQUIREMENT ? 'elite' : null
    default:
      return null
  }
}
