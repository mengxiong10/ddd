import { describe, it, expect } from 'vitest'
import { BASE_MOVEMENT, resolveOverride } from './troop-type'

describe('troop-type 兵种规则', () => {
  it('六种兵种基础移动力 = 骑5 步4 弓4 水5 极6 玄3', () => {
    expect(BASE_MOVEMENT.cavalry).toBe(5)
    expect(BASE_MOVEMENT.infantry).toBe(4)
    expect(BASE_MOVEMENT.archer).toBe(4)
    expect(BASE_MOVEMENT.navy).toBe(5)
    expect(BASE_MOVEMENT.elite).toBe(6)
    expect(BASE_MOVEMENT.mystic).toBe(3)
  })

  it('resolveOverride(0) 不改兵种，返回 null', () => {
    expect(resolveOverride(0, 200, 200)).toBeNull()
  })

  it('resolveOverride(1) 恒改水军，无门槛', () => {
    expect(resolveOverride(1, 0, 0)).toBe('navy')
  })

  it('resolveOverride(2) 玄兵：有效智力 > 105 才生效，=105 不过（严格大于）', () => {
    expect(resolveOverride(2, 0, 106)).toBe('mystic')
    expect(resolveOverride(2, 0, 105)).toBeNull()
    expect(resolveOverride(2, 200, 100)).toBeNull()
  })

  it('resolveOverride(3) 极兵：有效武力 > 105 才生效，=105 不过（严格大于）', () => {
    expect(resolveOverride(3, 106, 0)).toBe('elite')
    expect(resolveOverride(3, 105, 0)).toBeNull()
    expect(resolveOverride(3, 100, 200)).toBeNull()
  })
})
