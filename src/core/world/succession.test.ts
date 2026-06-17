import { describe, it, expect } from 'vitest'
import { createInitialState } from './fixture'
import type { GameState } from '../game-state'
import { resolveSuccession } from './succession'

/** 把某城归属改给另一君主（模拟占领），城内原武将就地成俘虏。 */
function conquer(s: GameState, cityId: string, lordId: string): GameState {
  return { ...s, cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId } } }
}

describe('resolveSuccession', () => {
  it('君主未被俘 -> 原样返回', () => {
    const s = createInitialState(1)
    expect(resolveSuccession(s, 'caocao')).toBe(s)
  })

  it('君主被俘且仍有城 -> 重选智力最高者，改归其余城与未被俘武将', () => {
    // 许昌(曹操所在)被刘备占 -> 曹操成俘虏；曹操尚有邺城(司马懿96、张辽70)
    const s = conquer(createInitialState(1), 'xuchang', 'liubei')
    const next = resolveSuccession(s, 'caocao')
    expect(next.cities.ye!.lordId).toBe('simayi') // 邺城改归新君主
    expect(next.officers.simayi!.lordId).toBe('simayi')
    expect(next.officers.zhangliao!.lordId).toBe('simayi')
    // 被俘曹操不改归属、仍在许昌
    expect(next.officers.caocao!.lordId).toBe('caocao')
    expect(next.officers.caocao!.cityId).toBe('xuchang')
  })

  it('君主被俘且已无城 -> 灭亡（无新君主，原样返回）', () => {
    let s = conquer(createInitialState(1), 'xuchang', 'liubei')
    s = conquer(s, 'ye', 'liubei')
    expect(resolveSuccession(s, 'caocao')).toBe(s)
  })

  it('重选君主按有效智力（道具加成可改写顺位）', () => {
    // 邺城候选：司马懿96 > 张辽70；给张辽 +30 智力道具 -> 有效100 > 96，改立张辽
    let s = conquer(createInitialState(1), 'xuchang', 'liubei')
    s = {
      ...s,
      items: {
        ...s.items,
        zhangliao_book: {
          id: 'zhangliao_book', name: '兵书', forceBonus: 0, intelBonus: 30,
          holder: { kind: 'officer', officerId: 'zhangliao' } as const,
          discovered: true, recruiterId: null,
        },
      },
    }
    const next = resolveSuccession(s, 'caocao')
    expect(next.cities.ye!.lordId).toBe('zhangliao')
    expect(next.officers.simayi!.lordId).toBe('zhangliao')
  })
})
