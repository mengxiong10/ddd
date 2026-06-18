import { describe, it, expect } from 'vitest'
import { createInitialState } from './fixture'
import type { GameState } from '../game-state'
import { LOYALTY_MAX } from './officer'
import { successionCandidates, pickSuccessor, promoteLord, canChooseSuccessor } from './succession'

/** 把某城归属改给另一君主（模拟占领），城内原武将就地成俘虏。 */
function conquer(s: GameState, cityId: string, lordId: string): GameState {
  return { ...s, cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId } } }
}
function withOfficer(
  s: GameState,
  id: string,
  patch: Partial<GameState['officers'][string]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

describe('successionCandidates / pickSuccessor', () => {
  it('排除俘虏与君主自身；取有效智力最高（平局 id 最小）', () => {
    // 许昌(曹操)被占 → 曹操成俘虏；曹操势力余邺城(司马懿96、张辽70)
    const s = conquer(createInitialState(1), 'xuchang', 'liubei')
    const cands = successionCandidates(s, 'caocao').map((o) => o.id)
    expect(cands).not.toContain('caocao') // 君主自身排除
    expect(cands).toContain('simayi')
    expect(cands).toContain('zhangliao')
    expect(pickSuccessor(s, 'caocao')).toBe('simayi') // 96 > 70
  })

  it('无候选 → null', () => {
    // 整势力被占 + 仅曹操（已俘）
    let s = conquer(createInitialState(1), 'xuchang', 'liubei')
    s = conquer(s, 'ye', 'liubei')
    // 把曹操势力其余武将都设为他人/在野，使无候选
    s = withOfficer(s, 'xunyu', { lordId: 'liubei' })
    s = withOfficer(s, 'guojia', { lordId: 'liubei' })
    s = withOfficer(s, 'simayi', { lordId: null })
    s = withOfficer(s, 'zhangliao', { lordId: null })
    expect(pickSuccessor(s, 'caocao')).toBeNull()
  })

  it('有效智力含道具加成可改写顺位', () => {
    let s = conquer(createInitialState(1), 'xuchang', 'liubei')
    s = {
      ...s,
      items: {
        ...s.items,
        zhangliao_book: {
          id: 'zhangliao_book',
          name: '兵书',
          forceBonus: 0,
          intelBonus: 30,
          movementBonus: 0,
          troopTypeOverride: 0,
          holder: { kind: 'officer', officerId: 'zhangliao', equipSeq: 0 } as const,
          discovered: true,
          recruiterId: null,
        },
      },
    }
    expect(pickSuccessor(s, 'caocao')).toBe('zhangliao') // 70+30=100 > 96
  })
})

describe('promoteLord', () => {
  it('势力城 + 非俘虏武将归属切新君、新君忠诚 100；被俘旧君主不改', () => {
    const s = conquer(createInitialState(1), 'xuchang', 'liubei') // 曹操成俘虏
    const next = promoteLord(s, 'caocao', 'simayi')
    expect(next.cities.ye!.lordId).toBe('simayi')
    expect(next.cities.xuchang!.lordId).toBe('liubei') // 已被占的不属曹操、不切
    expect(next.officers.simayi!.lordId).toBe('simayi')
    expect(next.officers.zhangliao!.lordId).toBe('simayi')
    expect(next.officers.simayi!.loyalty).toBe(LOYALTY_MAX)
    // 被俘曹操不改归属
    expect(next.officers.caocao!.lordId).toBe('caocao')
  })

  it('oldLord 是玩家君主 → playerLordId 一并迁移到新君', () => {
    const s = conquer(createInitialState(1), 'jiangling', 'caocao') // 江陵被占；刘备仍在成都
    // 刘备此时仍在成都(其势力)，未被俘——这里仅验证 playerLordId 迁移逻辑：直接 promote
    const next = promoteLord(s, 'liubei', 'zhugeliang')
    expect(next.playerLordId).toBe('zhugeliang')
    expect(next.cities.chengdu!.lordId).toBe('zhugeliang')
    expect(next.officers.zhugeliang!.lordId).toBe('zhugeliang')
  })
})

describe('canChooseSuccessor', () => {
  it('无 pendingSuccession → 拒绝', () => {
    expect(canChooseSuccessor(createInitialState(1), 'zhugeliang').ok).toBe(false)
  })
  it('officerId 须为 pending.lordId 的候选', () => {
    // 成都(刘备所在)被占 → 刘备及城内 zhugeliang/pangtong 成俘虏；候选来自江陵(关羽/张飞)
    const s = conquer(createInitialState(1), 'chengdu', 'caocao')
    const pending: GameState = { ...s, pendingSuccession: { lordId: 'liubei' } }
    expect(canChooseSuccessor(pending, 'guanyu').ok).toBe(true) // 江陵候选
    expect(canChooseSuccessor(pending, 'zhugeliang').ok).toBe(false) // 成都俘虏，非候选
    expect(canChooseSuccessor(pending, 'liubei').ok).toBe(false) // 君主自身排除
  })
})
