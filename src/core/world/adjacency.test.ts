import { describe, it, expect } from 'vitest'
import { buildAdjacency, areAdjacent } from './adjacency'

describe('buildAdjacency / areAdjacent', () => {
  const adj = buildAdjacency([
    ['a', 'b'],
    ['b', 'c'],
  ])

  it('相邻对（无向，双向都成立）', () => {
    expect(areAdjacent(adj, 'a', 'b')).toBe(true)
    expect(areAdjacent(adj, 'b', 'a')).toBe(true)
    expect(areAdjacent(adj, 'b', 'c')).toBe(true)
    expect(areAdjacent(adj, 'c', 'b')).toBe(true)
  })

  it('非相邻对返回 false', () => {
    expect(areAdjacent(adj, 'a', 'c')).toBe(false)
    expect(areAdjacent(adj, 'a', 'a')).toBe(false)
  })

  it('未知城返回 false', () => {
    expect(areAdjacent(adj, 'a', 'z')).toBe(false)
    expect(areAdjacent(adj, 'z', 'a')).toBe(false)
  })
})
