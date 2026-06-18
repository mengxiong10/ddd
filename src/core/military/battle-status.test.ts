import { describe, it, expect } from 'vitest'
import { createRng } from '../shared/rng'
import { canActWithStatus, canCastWithStatus, stoneDamage, dailyStatusCheck } from './battle-status'

describe('battle-status 谓词', () => {
  it('canAct：混乱/石阵/死亡不能行动', () => {
    expect(canActWithStatus('normal')).toBe(true)
    expect(canActWithStatus('sealed')).toBe(true)
    expect(canActWithStatus('rooted')).toBe(true)
    expect(canActWithStatus('qimen')).toBe(true)
    expect(canActWithStatus('confused')).toBe(false)
    expect(canActWithStatus('stone')).toBe(false)
    expect(canActWithStatus('dead')).toBe(false)
  })
  it('canCast：禁咒/死亡不能施法', () => {
    expect(canCastWithStatus('normal')).toBe(true)
    expect(canCastWithStatus('rooted')).toBe(true)
    expect(canCastWithStatus('sealed')).toBe(false)
    expect(canCastWithStatus('dead')).toBe(false)
  })
  it('stoneDamage = floor(troops/8)', () => {
    expect(stoneDamage(800)).toBe(100)
    expect(stoneDamage(7)).toBe(0)
  })
})

describe('battle-status 每日判定', () => {
  it('正常/死亡不变且不耗 rng', () => {
    const rng = createRng(1)
    expect(dailyStatusCheck('normal', 100, rng)).toEqual(['normal', rng])
    expect(dailyStatusCheck('dead', 100, rng)).toEqual(['dead', rng])
  })
  it('混乱：成功(智力高)→恢复正常', () => {
    // effIntel=120 → 阈值 60 > randInt(0,59) 恒成立 → 必恢复
    const [s] = dailyStatusCheck('confused', 120, createRng(5))
    expect(s).toBe('normal')
  })
  it('混乱：必失败(智力0)→保持', () => {
    const [s] = dailyStatusCheck('confused', 0, createRng(5))
    expect(s).toBe('confused')
  })
  it('奇门：失败(智力0)→恢复正常；成功(智力高)→保持', () => {
    expect(dailyStatusCheck('qimen', 0, createRng(5))[0]).toBe('normal')
    expect(dailyStatusCheck('qimen', 120, createRng(5))[0]).toBe('qimen')
  })
  it('耗 rng 的分支推进 seed', () => {
    const rng = createRng(9)
    const [, next] = dailyStatusCheck('rooted', 50, rng)
    expect(next.seed).not.toBe(rng.seed)
  })
})
