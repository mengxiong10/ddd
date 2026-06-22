import { describe, it, expect } from 'vitest'
import { createInitialState } from './fixture'
import type { GameState } from '../game-state'
import { LOYALTY_MAX } from './officer'
import { successionCandidates, pickSuccessor, promoteLord, canChooseSuccessor } from './succession'

/** 把某城归属改给另一君主（模拟占领），城内原武将就地成俘虏。 */
function conquer(s: GameState, cityId: number, lordId: number): GameState {
  return { ...s, cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId } } }
}
function withOfficer(
  s: GameState,
  id: number,
  patch: Partial<GameState['officers'][number]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

describe('successionCandidates / pickSuccessor', () => {
  it('排除俘虏与君主自身；取有效智力最高（平局 id 最小）', () => {
    // 许昌(曹操)被占 → 曹操成俘虏；曹操势力余邺城(司马懿96、张辽70)
    const s = conquer(createInitialState(1), 3, 1)
    const cands = successionCandidates(s, 6).map((o) => o.id)
    expect(cands).not.toContain(6) // 君主自身排除
    expect(cands).toContain(9)
    expect(cands).toContain(10)
    expect(pickSuccessor(s, 6)).toBe(9) // 96 > 70
  })

  it('无候选 → null', () => {
    // 整势力被占 + 仅曹操（已俘）
    let s = conquer(createInitialState(1), 3, 1)
    s = conquer(s, 4, 1)
    // 把曹操势力其余武将都设为他人/在野，使无候选
    s = withOfficer(s, 7, { lordId: 1 })
    s = withOfficer(s, 8, { lordId: 1 })
    s = withOfficer(s, 9, { lordId: null })
    s = withOfficer(s, 10, { lordId: null })
    expect(pickSuccessor(s, 6)).toBeNull()
  })

  it('有效智力含道具加成可改写顺位', () => {
    let s = conquer(createInitialState(1), 3, 1)
    s = {
      ...s,
      items: {
        ...s.items,
        100: {
          id: 100,
          name: '兵书',
          forceBonus: 0,
          intelBonus: 30,
          movementBonus: 0,
          troopTypeOverride: 0,
          holder: { kind: 'officer', officerId: 10, equipSeq: 0 } as const,
          discovered: true,
          appearanceConditions: { birth: 0, recruiterId: null, cityId: null },
        },
      },
    }
    expect(pickSuccessor(s, 6)).toBe(10) // 70+30=100 > 96
  })
})

describe('promoteLord', () => {
  it('势力城 + 非俘虏武将归属切新君、新君忠诚 100；被俘旧君主不改', () => {
    const s = conquer(createInitialState(1), 3, 1) // 曹操成俘虏
    const next = promoteLord(s, 6, 9)
    expect(next.cities[4]!.lordId).toBe(9)
    expect(next.cities[3]!.lordId).toBe(1) // 已被占的不属曹操、不切
    expect(next.officers[9]!.lordId).toBe(9)
    expect(next.officers[10]!.lordId).toBe(9)
    expect(next.officers[9]!.loyalty).toBe(LOYALTY_MAX)
    // 被俘曹操不改归属
    expect(next.officers[6]!.lordId).toBe(6)
  })

  it('oldLord 是玩家君主 → playerLordId 一并迁移到新君', () => {
    const s = conquer(createInitialState(1), 2, 6) // 江陵被占；刘备仍在成都
    // 刘备此时仍在成都(其势力)，未被俘——这里仅验证 playerLordId 迁移逻辑：直接 promote
    const next = promoteLord(s, 1, 2)
    expect(next.playerLordId).toBe(2)
    expect(next.cities[1]!.lordId).toBe(2)
    expect(next.officers[2]!.lordId).toBe(2)
  })
})

describe('canChooseSuccessor', () => {
  it('无 pendingSuccession → 拒绝', () => {
    expect(canChooseSuccessor(createInitialState(1), 2).ok).toBe(false)
  })
  it('officerId 须为 pending.lordId 的候选', () => {
    // 成都(刘备所在)被占 → 刘备及城内 zhugeliang/pangtong 成俘虏；候选来自江陵(关羽/张飞)
    const s = conquer(createInitialState(1), 1, 6)
    const pending: GameState = { ...s, pendingSuccession: { lordId: 1 } }
    expect(canChooseSuccessor(pending, 4).ok).toBe(true) // 江陵候选
    expect(canChooseSuccessor(pending, 2).ok).toBe(false) // 成都俘虏，非候选
    expect(canChooseSuccessor(pending, 1).ok).toBe(false) // 君主自身排除
  })
})
