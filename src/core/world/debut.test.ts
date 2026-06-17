import { describe, it, expect } from 'vitest'
import { createInitialState } from './fixture'
import { runDebuts } from './debut'
import { endMonth } from '../turn/end-month'
import { DEFAULT_CONFIG } from '../shared/config'

// fixture 待登场：赵云(191,江陵) / 姜维(192,随机,伯乐诸葛亮) / 青釭剑(191,许昌)。START_YEAR=189。

describe('runDebuts 登场', () => {
  it('未到登场年：全部留池、不消费 RNG', () => {
    const s = createInitialState(1)
    const r = runDebuts(s)
    expect(r.pendingDebuts).toHaveLength(3)
    expect(Object.keys(r.officers)).toHaveLength(10)
    expect(r.rng.seed).toBe(s.rng.seed)
  })

  it('到指定登场年：落指定城、出池；武将 lordId=null/troops=0，道具未发现', () => {
    const s = { ...createInitialState(1), year: 191 }
    const r = runDebuts(s)
    // 赵云登场江陵
    expect(r.officers.zhaoyun!.lordId).toBeNull()
    expect(r.officers.zhaoyun!.cityId).toBe('jiangling')
    expect(r.officers.zhaoyun!.troops).toBe(0)
    // 青釭剑登场许昌、未发现
    expect(r.items.qinggangjian!.holder).toEqual({ kind: 'city', cityId: 'xuchang' })
    expect(r.items.qinggangjian!.discovered).toBe(false)
    // 姜维(192)未到 -> 留池；二者均为指定城 -> 不消费 RNG
    expect(r.pendingDebuts).toHaveLength(1)
    expect(r.rng.seed).toBe(s.rng.seed)
  })

  it('随机落城：到年后全部出池、消费 RNG、落城确定可复现', () => {
    const s = { ...createInitialState(1), year: 192 }
    const r = runDebuts(s)
    expect(r.pendingDebuts).toHaveLength(0)
    expect(r.officers.jiangwei!.lordId).toBeNull()
    expect(Object.keys(s.cities)).toContain(r.officers.jiangwei!.cityId)
    expect(r.rng.seed).not.toBe(s.rng.seed)
    // 相同 seed 复现到同一落城
    const r2 = runDebuts({ ...createInitialState(1), year: 192 })
    expect(r2.officers.jiangwei!.cityId).toBe(r.officers.jiangwei!.cityId)
  })
})

describe('登场时机（endMonth：月份+1 之后）', () => {
  it('跨入登场年后该实体出现', () => {
    const before = { ...createInitialState(1), year: 190, month: 11 }
    const r1 = endMonth(before, DEFAULT_CONFIG) // -> 190/12，赵云(191)尚未登场
    expect(r1.year).toBe(190)
    expect(r1.officers.zhaoyun).toBeUndefined()
    const r2 = endMonth(r1, DEFAULT_CONFIG) // -> 191/1，赵云登场
    expect(r2.year).toBe(191)
    expect(r2.officers.zhaoyun!.cityId).toBe('jiangling')
  })
})
