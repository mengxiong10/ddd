import { describe, it, expect } from 'vitest'
import { createRng } from '../shared/rng'
import {
  SKILL_DEFS,
  RANGE_MASK,
  DEFAULT_SKILLS,
  LORD_SKILLS,
  initialMp,
  unlockedCount,
  availableSkills,
  effectValue,
  skillGatesPass,
  rollSkillSuccess,
} from './battle-skill'

describe('battle-skill 数据完整性', () => {
  it('纳入 27 技、不含 21/26/28', () => {
    const ids = Object.keys(SKILL_DEFS)
      .map(Number)
      .sort((a, b) => a - b)
    expect(ids).toHaveLength(27)
    expect(ids).not.toContain(21)
    expect(ids).not.toContain(26)
    expect(ids).not.toContain(28)
  })
  it('每条倍率数组维度正确', () => {
    for (const def of Object.values(SKILL_DEFS)) {
      expect(def.weatherMul).toHaveLength(5)
      expect(def.targetTerrainMul).toHaveLength(8)
      expect(def.casterTerrainMul).toHaveLength(8)
      expect(def.targetTroopMul).toHaveLength(6)
    }
  })
  it('掩码形状：践踏周身8、撞击十字4、援军菱形r4=40、天变/谍报无目标', () => {
    expect(RANGE_MASK[1]).toHaveLength(8)
    expect(RANGE_MASK[13]).toHaveLength(4)
    expect(RANGE_MASK[29]).toHaveLength(40)
    expect(RANGE_MASK[22]).toHaveLength(0)
    expect(RANGE_MASK[30]).toHaveLength(0)
  })
})

describe('battle-skill 公式', () => {
  it('initialMp 公式', () => {
    // 智100/武50/等1/体100：floor(80)+floor(sqrt(50)/2=3.53→3)+1=84
    expect(initialMp(100, 50, 1, 100)).toBe(84)
    // 体力减半 → floor(84*50/100)=42
    expect(initialMp(100, 50, 1, 50)).toBe(42)
  })
  it('unlockedCount 封顶默认数', () => {
    expect(unlockedCount(9, 1)).toBe(1)
    expect(unlockedCount(9, 21)).toBe(9)
    expect(unlockedCount(4, 21)).toBe(4)
    expect(unlockedCount(3, 7)).toBe(2)
  })
  it('availableSkills 默认∪个人∪君主', () => {
    expect([...availableSkills('cavalry', 1, [], false)]).toEqual([1])
    const withPersonal = availableSkills('cavalry', 1, [22], false)
    expect(withPersonal.has(22)).toBe(true)
    const lord = availableSkills('cavalry', 1, [], true)
    expect(lord.has(LORD_SKILLS[0]!)).toBe(true)
    expect(DEFAULT_SKILLS.mystic).toHaveLength(9)
  })
  it('effectValue 五步逐 floor', () => {
    expect(effectValue(400, 100, 100, 100, 100)).toBe(400)
    expect(effectValue(800, 80, 100, 50, 100)).toBe(320)
    expect(effectValue(0, 100, 100, 100, 100)).toBe(0)
  })
})

describe('battle-skill 四关与成功率', () => {
  it('冰雹下火箭不可用、目标山地践踏不可用', () => {
    expect(
      skillGatesPass(SKILL_DEFS[11]!, 'hail', 'plain', { terrain: 'village', troop: 'infantry' })
    ).toBe(false)
    expect(
      skillGatesPass(SKILL_DEFS[1]!, 'clear', 'plain', { terrain: 'mountain', troop: 'infantry' })
    ).toBe(false)
  })
  it('滚木须施法者在山地/城池', () => {
    expect(
      skillGatesPass(SKILL_DEFS[6]!, 'clear', 'plain', { terrain: 'plain', troop: 'infantry' })
    ).toBe(false)
    expect(
      skillGatesPass(SKILL_DEFS[6]!, 'clear', 'mountain', { terrain: 'plain', troop: 'infantry' })
    ).toBe(true)
  })
  it('self 技能（谍报）忽略目标维度、所有天气可用', () => {
    expect(skillGatesPass(SKILL_DEFS[30]!, 'hail', 'river')).toBe(true)
    expect(skillGatesPass(SKILL_DEFS[22]!, 'rain', 'mountain')).toBe(true)
  })
  it('rollSkillSuccess：抗性0时几乎必成、失败也推进 rng', () => {
    const [ok] = rollSkillSuccess(200, 0, createRng(1))
    expect(ok).toBe(true)
    const rng = createRng(3)
    const [, next] = rollSkillSuccess(10, 100, rng)
    expect(next.seed).not.toBe(rng.seed)
  })
})
