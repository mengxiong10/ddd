import type { Position } from '../shared/position'
import type { TroopType } from '../world/troop-type'

/**
 * 纯战斗数学：兵种系数 / 相克 / 普攻范围掩码 + 攻防、伤害、经验、升级、耗粮公式。
 * 全部不读 state、入参传值；系数用整数百分比避免浮点累积误差，公式按 §6.3/§6.5/§6.7。
 */

/** 兵种攻击系数（百分比；§6.3.2）。骑100 步80 弓90 水80 极130 玄40。 */
export const TROOP_ATTACK_PCT: Record<TroopType, number> = {
  cavalry: 100, infantry: 80, archer: 90, navy: 80, elite: 130, mystic: 40,
}

/** 兵种防御系数（百分比；§6.3.2）。骑70 步120 弓100 水110 极120 玄60。 */
export const TROOP_DEFENSE_PCT: Record<TroopType, number> = {
  cavalry: 70, infantry: 120, archer: 100, navy: 110, elite: 120, mystic: 60,
}

/** 兵种相克倍率 [攻][防]（百分比；§6.3.3）。 */
export const COUNTER_PCT: Record<TroopType, Record<TroopType, number>> = {
  cavalry: { cavalry: 100, infantry: 120, archer: 80, navy: 100, elite: 70, mystic: 130 },
  infantry: { cavalry: 80, infantry: 100, archer: 120, navy: 100, elite: 60, mystic: 120 },
  archer: { cavalry: 120, infantry: 80, archer: 100, navy: 100, elite: 110, mystic: 120 },
  navy: { cavalry: 100, infantry: 100, archer: 100, navy: 100, elite: 100, mystic: 100 },
  elite: { cavalry: 110, infantry: 130, archer: 90, navy: 100, elite: 100, mystic: 150 },
  mystic: { cavalry: 60, infantry: 60, archer: 60, navy: 60, elite: 60, mystic: 60 },
}

/** 默认普攻范围掩码（相对中心偏移，不含中心；§6.3.4）。 */
const CROSS: readonly Position[] = [{ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
const SURROUND: readonly Position[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
]
const SCATTER: readonly Position[] = [
  { x: 0, y: -2 }, { x: -1, y: -1 }, { x: 1, y: -1 },
  { x: -2, y: 0 }, { x: 2, y: 0 },
  { x: -1, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 },
]
/** 骑/水/玄=十字1格；步/极=周身8；弓=散点2格。 */
export const ATTACK_MASK: Record<TroopType, readonly Position[]> = {
  cavalry: CROSS, navy: CROSS, mystic: CROSS,
  infantry: SURROUND, elite: SURROUND,
  archer: SCATTER,
}

/** 基础攻击（地形折减前；§6.3.1）= floor(武力 × (等级+10) × 攻击系数)。 */
export function baseAttack(force: number, level: number, troopType: TroopType): number {
  return Math.floor((force * (level + 10) * TROOP_ATTACK_PCT[troopType]) / 100)
}

/** 基础防御（地形折减前；§6.3.1）= floor(智力 × (等级+10) × 防御系数)。 */
export function baseDefense(intel: number, level: number, troopType: TroopType): number {
  return Math.floor((intel * (level + 10) * TROOP_DEFENSE_PCT[troopType]) / 100)
}

/** 地形折减后攻击力（§6.5.3）= floor(基础攻击 / 2^折减档)。 */
export function terrainAttack(base: number, tier: number): number {
  return Math.floor(base / 2 ** tier)
}

/** 地形修正后防御力（§6.5.3~§6.5.4）= floor(floor(基础防御 / 2^折减档) × 防御系数%)。 */
export function terrainDefense(base: number, tier: number, defCoefPct: number): number {
  const mid = Math.floor(base / 2 ** tier)
  return Math.floor((mid * defCoefPct) / 100)
}

/**
 * 单次普攻实际扣兵（§6.7.1）：
 * 基础伤害 = floor(攻击力 / 防御力 × floor(攻击者当前兵力 / 8))
 * 最终伤害 = floor(基础伤害 × 相克倍率) + 10
 * 实际扣兵 = min(最终伤害, 目标当前兵力)
 * 防御力下限钳 1 以防除零（弱兵在河流可被折减到 0）。
 */
export function attackDamage(
  atkPower: number, defPower: number, attackerTroops: number, counterPct: number, targetTroops: number,
): number {
  const def = Math.max(1, defPower)
  const base = Math.floor((atkPower / def) * Math.floor(attackerTroops / 8))
  const final = Math.floor((base * counterPct) / 100) + 10
  return Math.min(final, targetTroops)
}

/**
 * 行动者经验（§6.7.4）。troopDelta=实际兵力变化（扣兵/治疗量），routed=本次是否击溃目标。
 * 伤害经验 = floor(sqrt(troopDelta)/4)；按等级差给基础经验；击溃额外（低24/平16/高8）。
 */
export function experienceGain(
  troopDelta: number, attackerLevel: number, targetLevel: number, routed: boolean,
): number {
  const levelDiff = attackerLevel - targetLevel
  const dmgExp = Math.floor(Math.sqrt(troopDelta) / 4)
  const base = levelDiff < 0 ? dmgExp - levelDiff + 2 : Math.max(dmgExp - levelDiff, 0) + 2
  if (!routed) return base
  const extra = levelDiff < 0 ? 24 : levelDiff === 0 ? 16 : 8
  return base + extra
}

/** 升级（§6.7.4）：经验 ≥100 则扣 100、等级 +1，一次只升一级。 */
export function applyLevelUp(level: number, experience: number): { level: number; experience: number } {
  return experience >= 100 ? { level: level + 1, experience: experience - 100 } : { level, experience }
}

/** 每日耗粮（§6.7.2）= floor(sqrt(本方未击溃单位兵力和) / 3)。 */
export function dailyFoodCost(sideTroops: number): number {
  return Math.floor(Math.sqrt(sideTroops) / 3)
}
