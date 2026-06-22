import { describe, it, expect } from 'vitest'
import { createInitialState } from './fixture'
import { runDebuts } from './debut'
import { endMonth } from '../turn/end-month'
import { DEFAULT_CONFIG } from '../shared/config'

describe('runDebuts 登场', () => {
  it('未到登场年：位置不变、不消费 RNG', () => {
    const state = createInitialState(1)
    const result = runDebuts(state)
    expect(result).toBe(state)
    expect(result.officers[11]?.cityId).toBeNull()
    expect(result.items[3]?.holder).toBeNull()
  })

  it('到指定登场年：武将和独立道具落指定城', () => {
    const state = { ...createInitialState(1), year: 191 }
    const result = runDebuts(state)
    expect(result.officers[11]?.cityId).toBe(2)
    expect(result.items[3]?.holder).toEqual({ kind: 'city', cityId: 3 })
    expect(result.items[3]?.discovered).toBe(false)
    expect(result.officers[12]?.cityId).toBeNull()
    expect(result.rng.seed).toBe(state.rng.seed)
  })

  it('随机落城：按 id 处理并可复现', () => {
    const state = { ...createInitialState(1), year: 192 }
    const first = runDebuts(state)
    const second = runDebuts({ ...createInitialState(1), year: 192 })
    expect(first.officers[12]?.cityId).not.toBeNull()
    expect(first.officers[12]?.cityId).toBe(second.officers[12]?.cityId)
    expect(first.rng.seed).not.toBe(state.rng.seed)
  })

  it('未登场武将装备从开局起已持有，登场只改变武将位置', () => {
    const base = createInitialState(1)
    const initial = {
      ...base,
      items: {
        ...base.items,
        4: {
          id: 4,
          name: '未登场装备',
          forceBonus: 1,
          intelBonus: 0,
          movementBonus: 0,
          troopTypeOverride: 0 as const,
          holder: { kind: 'officer' as const, officerId: 11, equipSeq: 0 },
          discovered: true,
          appearanceConditions: { birth: 0, recruiterId: null, cityId: null },
        },
      },
    }
    const holderBefore = initial.items[4]?.holder
    expect(initial.officers[11]?.cityId).toBeNull()

    const result = runDebuts({ ...initial, year: 191 })
    expect(result.officers[11]?.cityId).toBe(2)
    expect(result.items[4]?.holder).toEqual(holderBefore)
  })
})

describe('登场时机（endMonth：月份+1 之后）', () => {
  it('跨入登场年后该实体出现', () => {
    const before = { ...createInitialState(1), year: 190, month: 11 }
    const december = endMonth(before, DEFAULT_CONFIG)
    expect(december.officers[11]?.cityId).toBeNull()
    const january = endMonth(december, DEFAULT_CONFIG)
    expect(january.year).toBe(191)
    expect(january.officers[11]?.cityId).toBe(2)
  })
})
