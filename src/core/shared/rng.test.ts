import { describe, it, expect } from 'vitest'
import { createRng, randInt } from './rng'

describe('rng', () => {
  it('randInt 落在 [min, max] 闭区间', () => {
    let rng = createRng(1)
    for (let i = 0; i < 1000; i++) {
      const [v, next] = randInt(rng, 0, 30)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(30)
      rng = next
    }
  })

  it('min === max 时恒返回该值', () => {
    const [v] = randInt(createRng(123), 5, 5)
    expect(v).toBe(5)
  })

  it('相同 seed 产生相同结果（确定性）', () => {
    const a = randInt(createRng(42), 0, 100)
    const b = randInt(createRng(42), 0, 100)
    expect(a[0]).toBe(b[0])
    expect(a[1].seed).toBe(b[1].seed)
  })

  it('连续调用会推进序列', () => {
    const [, next] = randInt(createRng(7), 0, 1_000_000)
    expect(next.seed).not.toBe(7)
  })
})
