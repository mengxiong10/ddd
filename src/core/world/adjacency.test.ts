import { describe, it, expect } from 'vitest'
import { buildAdjacency, areAdjacent } from './adjacency'

describe('buildAdjacency / areAdjacent', () => {
  const adj = buildAdjacency([
    [1, 2],
    [2, 3],
  ])

  it('相邻对（无向，双向都成立）', () => {
    expect(areAdjacent(adj, 1, 2)).toBe(true)
    expect(areAdjacent(adj, 2, 1)).toBe(true)
    expect(areAdjacent(adj, 2, 3)).toBe(true)
    expect(areAdjacent(adj, 3, 2)).toBe(true)
  })

  it('非相邻对返回 false', () => {
    expect(areAdjacent(adj, 1, 3)).toBe(false)
    expect(areAdjacent(adj, 1, 1)).toBe(false)
  })

  it('未知城返回 false', () => {
    expect(areAdjacent(adj, 1, 99)).toBe(false)
    expect(areAdjacent(adj, 99, 1)).toBe(false)
  })
})
