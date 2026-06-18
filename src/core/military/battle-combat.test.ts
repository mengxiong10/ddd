import { describe, it, expect } from 'vitest'
import {
  TROOP_ATTACK_PCT, TROOP_DEFENSE_PCT, COUNTER_PCT, ATTACK_MASK,
  baseAttack, baseDefense, terrainAttack, terrainDefense,
  attackDamage, experienceGain, applyLevelUp, dailyFoodCost,
} from './battle-combat'

describe('battle-combat 系数表', () => {
  it('攻/防系数：极兵攻130防120、玄兵攻40防60、骑兵攻100防70', () => {
    expect(TROOP_ATTACK_PCT.elite).toBe(130)
    expect(TROOP_DEFENSE_PCT.mystic).toBe(60)
    expect(TROOP_ATTACK_PCT.cavalry).toBe(100)
    expect(TROOP_DEFENSE_PCT.cavalry).toBe(70)
  })

  it('相克：极兵克玄兵150、玄兵恒60、水军恒100', () => {
    expect(COUNTER_PCT.elite.mystic).toBe(150)
    expect(COUNTER_PCT.mystic.cavalry).toBe(60)
    expect(COUNTER_PCT.navy.elite).toBe(100)
  })

  it('普攻掩码：十字=4、周身=8、散点=8，均不含中心', () => {
    expect(ATTACK_MASK.cavalry).toHaveLength(4)
    expect(ATTACK_MASK.infantry).toHaveLength(8)
    expect(ATTACK_MASK.archer).toHaveLength(8)
    for (const t of ['cavalry', 'infantry', 'archer'] as const) {
      expect(ATTACK_MASK[t].some((p) => p.x === 0 && p.y === 0)).toBe(false)
    }
  })
})

describe('battle-combat 派生攻防', () => {
  it('基础攻击 = floor(武力×(等级+10)×攻击系数)', () => {
    // 力50 级1 骑(100%)：50*11*1 = 550
    expect(baseAttack(50, 1, 'cavalry')).toBe(550)
    // 力50 级1 步(80%)：floor(50*11*0.8)=440
    expect(baseAttack(50, 1, 'infantry')).toBe(440)
  })

  it('基础防御 = floor(智力×(等级+10)×防御系数)', () => {
    // 智75 级1 步(120%)：floor(75*11*1.2)=990
    expect(baseDefense(75, 1, 'infantry')).toBe(990)
  })

  it('地形攻击折减 = floor(base / 2^档)', () => {
    expect(terrainAttack(550, 0)).toBe(550)
    expect(terrainAttack(550, 1)).toBe(275)
    expect(terrainAttack(551, 2)).toBe(137)
    expect(terrainAttack(550, 3)).toBe(68)
  })

  it('地形防御 = floor(floor(base/2^档) × 防御系数%)', () => {
    // base 990, 档0, 城池150%：floor(990*1.5)=1485
    expect(terrainDefense(990, 0, 150)).toBe(1485)
    // base 990, 档2(/4=247), 河流80%：floor(247*0.8)=197
    expect(terrainDefense(990, 2, 80)).toBe(197)
  })
})

describe('battle-combat 伤害', () => {
  it('基础伤害=floor(攻/防×floor(兵/8))，×相克+10，≤目标兵力', () => {
    // atk1000 def500 兵100 → floor(1000/500*floor(100/8))=floor(2*12)=24；×120%=28+10=38
    expect(attackDamage(1000, 500, 100, 120, 999)).toBe(38)
  })

  it('扣兵不超目标当前兵力', () => {
    expect(attackDamage(10000, 100, 800, 150, 5)).toBe(5)
  })

  it('防御力为 0 时按下限 1 处理，不除零', () => {
    expect(Number.isFinite(attackDamage(100, 0, 80, 100, 999))).toBe(true)
  })
})

describe('battle-combat 经验/升级/耗粮', () => {
  it('伤害经验 = floor(sqrt(兵力变化)/4)，平级 +2', () => {
    // delta=64 → floor(8/4)=2；平级 base=max(2-0,0)+2=4
    expect(experienceGain(64, 1, 1, false)).toBe(4)
  })

  it('攻击者等级更低：基础经验 = 伤害经验 − 等级差 + 2（等级差为负）', () => {
    // delta=64 dmgExp=2；攻3守5 diff=-2 → 2-(-2)+2=6
    expect(experienceGain(64, 3, 5, false)).toBe(6)
  })

  it('攻击者等级更高：max(伤害经验 − 等级差, 0) + 2', () => {
    // delta=64 dmgExp=2；攻9守2 diff=7 → max(2-7,0)+2=2
    expect(experienceGain(64, 9, 2, false)).toBe(2)
  })

  it('击溃额外经验：低24/平16/高8', () => {
    expect(experienceGain(64, 3, 5, true)).toBe(6 + 24)
    expect(experienceGain(64, 1, 1, true)).toBe(4 + 16)
    expect(experienceGain(64, 9, 2, true)).toBe(2 + 8)
  })

  it('升级：经验≥100 扣100升1级，一次只升一级', () => {
    expect(applyLevelUp(1, 100)).toEqual({ level: 2, experience: 0 })
    expect(applyLevelUp(3, 250)).toEqual({ level: 4, experience: 150 })
    expect(applyLevelUp(1, 99)).toEqual({ level: 1, experience: 99 })
  })

  it('每日耗粮 = floor(sqrt(总兵力)/3)', () => {
    expect(dailyFoodCost(900)).toBe(10) // sqrt900=30 /3=10
    expect(dailyFoodCost(100)).toBe(3) // 10/3=3
    expect(dailyFoodCost(0)).toBe(0)
  })
})
