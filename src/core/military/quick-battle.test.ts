import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { attackerWinPercent, quickResolveCampaign } from './quick-battle'

function withOfficer(
  s: GameState,
  id: number,
  patch: Partial<GameState['officers'][number]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

describe('attackerWinPercent 速算胜率表', () => {
  it('一方兵力为 0：A=0→0、D=0→100（D=0 优先级低于 A=0）', () => {
    expect(attackerWinPercent(0, 10, 999, 0)).toBe(0)
    expect(attackerWinPercent(10, 0, 0, 999)).toBe(100)
    expect(attackerWinPercent(0, 0, 0, 0)).toBe(0)
  })
  it('兵力 ≥ 对方 2 倍 → 70%（含恰好 2 倍）', () => {
    expect(attackerWinPercent(20, 10, 0, 999)).toBe(70)
    expect(attackerWinPercent(25, 10, 0, 0)).toBe(70)
  })
  it('兵力更多（不足 2 倍）：粮多 60% / 粮不占优 40%', () => {
    expect(attackerWinPercent(15, 10, 100, 50)).toBe(60)
    expect(attackerWinPercent(15, 10, 50, 50)).toBe(40)
  })
  it('兵力不到对方一半（2A<D）→ 2%', () => {
    expect(attackerWinPercent(4, 10, 999, 0)).toBe(2)
  })
  it('兵力较少/相等（2A≥D 且 A≤D）：粮多 30% / 否则 10%', () => {
    expect(attackerWinPercent(6, 10, 100, 50)).toBe(30)
    expect(attackerWinPercent(6, 10, 50, 50)).toBe(10)
    expect(attackerWinPercent(10, 10, 100, 0)).toBe(30) // 相等并入「较少」
    expect(attackerWinPercent(10, 10, 0, 100)).toBe(10)
    expect(attackerWinPercent(5, 10, 0, 0)).toBe(10) // 2A=D 恰好，不算「不到一半」
  })
})

describe('quickResolveCampaign', () => {
  it('无守军（defenderIds 空）→ 直接占城、不掷骰（rng 不变）', () => {
    const s = createInitialState(1)
    const out = quickResolveCampaign(s, [4], [], 3, 50).state
    expect(out.cities[3]!.lordId).toBe(1)
    expect(out.cities[3]!.food).toBe(50 + 500) // provisions + 目标城原粮
    expect(out.rng).toEqual(s.rng) // 直接占城不消耗 RNG
  })

  it('有守军 → 掷骰定胜负、消耗 RNG、复用战后处理；同 seed 可复现', () => {
    // 攻方碾压（兵力 ≥2 倍）：guanyu 5000 攻 邺城(司马懿/张辽 各100 + 后备0)。
    let s = withOfficer(createInitialState(3), 4, { troops: 5000 })
    s = {
      ...s,
      officers: { ...s.officers, 4: { ...s.officers[4]!, cityId: 2 } },
    }
    const a = quickResolveCampaign(s, [4], [9, 10], 4, 30).state
    const b = quickResolveCampaign(s, [4], [9, 10], 4, 30).state
    expect(a).toEqual(b) // 确定性
    expect(a.rng).not.toEqual(s.rng) // 消耗 RNG
  })
})
