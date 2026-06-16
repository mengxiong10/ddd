import type { CityId } from '../shared/ids'

/**
 * 城邻接拓扑（值对象）：每座城 -> 其相邻城列表。无向图，buildAdjacency 保证对称。
 * 放进 GameState（fixture 播种），不做全局常量——使 apply/canApply 签名不变、可注入测试、随存档序列化。
 */
export type Adjacency = Readonly<Record<CityId, readonly CityId[]>>

/** 由无向边对构造对称邻接表（自动补反向边、去重）。 */
export function buildAdjacency(edges: readonly (readonly [CityId, CityId])[]): Adjacency {
  const map: Record<CityId, CityId[]> = {}
  const link = (a: CityId, b: CityId) => {
    const list = (map[a] ??= [])
    if (!list.includes(b)) list.push(b)
  }
  for (const [a, b] of edges) {
    link(a, b)
    link(b, a)
  }
  return map
}

/** a、b 是否相邻（对称查询；未知城或自反皆为 false）。 */
export function areAdjacent(adj: Adjacency, a: CityId, b: CityId): boolean {
  return adj[a]?.includes(b) ?? false
}
