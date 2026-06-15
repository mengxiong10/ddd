import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import { develop } from '../economy/develop'
import { endMonth } from './end-month'

const cfg = DEFAULT_CONFIG

describe('endMonth 月末编排', () => {
  it('月份 +1', () => {
    const next = endMonth(createInitialState(1), cfg)
    expect(next.month).toBe(2)
    expect(next.year).toBe(189)
  })

  it('12 月跨年到次年 1 月', () => {
    const next = endMonth({ ...createInitialState(1), month: 12 }, cfg)
    expect(next.month).toBe(1)
    expect(next.year).toBe(190)
  })

  it('占用武将回城、体力 +4 封顶', () => {
    const afterCmd = develop(createInitialState(1), 'chengdu', 'zhugeliang', 'agriculture', cfg)
    expect(afterCmd.officers.zhugeliang!.busy).toBe(true)
    expect(afterCmd.officers.zhugeliang!.stamina).toBe(92)

    const next = endMonth(afterCmd, cfg)
    expect(next.officers.zhugeliang!.busy).toBe(false)
    expect(next.officers.zhugeliang!.stamina).toBe(96)
  })

  it('满体力武将恢复后仍封顶 100', () => {
    const next = endMonth(createInitialState(1), cfg)
    expect(next.officers.guanyu!.stamina).toBe(100)
  })

  it('结算月触发收粮/收税', () => {
    const next = endMonth({ ...createInitialState(1), month: 6 }, cfg)
    expect(next.cities.chengdu!.food).toBe(400 + 75)
    expect(next.cities.chengdu!.gold).toBe(500 + 100)
    expect(next.month).toBe(7)
  })
})
