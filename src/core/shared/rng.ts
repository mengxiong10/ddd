/**
 * 确定性随机源。仅持有 seed，便于放进 GameState 随状态推进，
 * 从而让 apply 保持纯函数且整段对局可复现。
 */
export interface Rng {
  readonly seed: number
}

/** 由整数种子创建 Rng（归一化为无符号 32 位）。 */
export function createRng(seed: number): Rng {
  return { seed: seed >>> 0 }
}

// mulberry32：纯函数推进，给定 seed 必得相同输出
function nextUint32(seed: number): number {
  const a = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return (t ^ (t >>> 14)) >>> 0
}

// 含两端的整数；返回 [值, 推进后的 rng]
export function randInt(rng: Rng, min: number, max: number): readonly [value: number, next: Rng] {
  const u = nextUint32(rng.seed)
  const span = max - min + 1
  const value = min + (u % span)
  return [value, { seed: u }]
}
