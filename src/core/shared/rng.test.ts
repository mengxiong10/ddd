import { describe, it, expect } from 'vitest'
import { createRng, randInt, pickRandom } from './rng'

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

describe('pickRandom', () => {
  it('从数组中取出一个元素并推进 rng', () => {
    const items = ['a', 'b', 'c'] as const
    const [item, next] = pickRandom(createRng(42), items)
    expect(items).toContain(item)
    expect(next.seed).not.toBe(42)
  })

  it('单元素数组恒返回该元素', () => {
    const [item] = pickRandom(createRng(99), ['only'])
    expect(item).toBe('only')
  })

  it('相同 seed 选同一元素（确定性）', () => {
    const items = [10, 20, 30, 40]
    expect(pickRandom(createRng(7), items)[0]).toBe(pickRandom(createRng(7), items)[0])
  })
})
