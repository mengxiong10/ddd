import { describe, it, expect } from 'vitest'
import { samePos, manhattan } from './position'

describe('position', () => {
  it('samePos 仅在 x、y 都相等时为真', () => {
    expect(samePos({ x: 2, y: 3 }, { x: 2, y: 3 })).toBe(true)
    expect(samePos({ x: 2, y: 3 }, { x: 2, y: 4 })).toBe(false)
    expect(samePos({ x: 2, y: 3 }, { x: 1, y: 3 })).toBe(false)
  })

  it('manhattan = |dx| + |dy|', () => {
    expect(manhattan({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7)
    expect(manhattan({ x: 5, y: 5 }, { x: 2, y: 9 })).toBe(7)
    expect(manhattan({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0)
  })
})
