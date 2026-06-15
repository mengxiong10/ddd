import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import { harvestAmount, taxAmount, settle } from './settle'

const cfg = DEFAULT_CONFIG

describe('结算公式', () => {
  it('收粮 = floor(农业 / 4)', () => {
    expect(harvestAmount(300, cfg)).toBe(75)
    expect(harvestAmount(250, cfg)).toBe(62)
  })
  it('收税 = floor(商业 / 2)', () => {
    expect(taxAmount(200, cfg)).toBe(100)
    expect(taxAmount(281, cfg)).toBe(140)
  })
})

describe('settle 按月份结算', () => {
  it('6 月：收粮 + 收税', () => {
    const s = { ...createInitialState(1), month: 6 }
    const next = settle(s, cfg)
    expect(next.cities.chengdu!.food).toBe(400 + 75)
    expect(next.cities.chengdu!.gold).toBe(500 + 100)
  })

  it('10 月：仅收粮', () => {
    const s = { ...createInitialState(1), month: 10 }
    const next = settle(s, cfg)
    expect(next.cities.chengdu!.food).toBe(400 + 75)
    expect(next.cities.chengdu!.gold).toBe(500)
  })

  it('3 月：仅收税', () => {
    const s = { ...createInitialState(1), month: 3 }
    const next = settle(s, cfg)
    expect(next.cities.chengdu!.gold).toBe(500 + 100)
    expect(next.cities.chengdu!.food).toBe(400)
  })

  it('非结算月（1 月）：无变化', () => {
    const s = { ...createInitialState(1), month: 1 }
    expect(settle(s, cfg)).toBe(s)
  })

  it('AI 城同样参与结算', () => {
    const s = { ...createInitialState(1), month: 6 }
    const next = settle(s, cfg)
    expect(next.cities.xuchang!.food).toBe(500 + Math.floor(350 / 4))
    expect(next.cities.xuchang!.gold).toBe(600 + Math.floor(320 / 2))
  })
})

describe('配置注入可改变行为', () => {
  it('自定义 harvestDivisor / 月份表生效', () => {
    const custom = { ...cfg, harvestDivisor: 10, harvestMonths: [1] as const, taxMonths: [] as const }
    expect(harvestAmount(300, custom)).toBe(30)
    const next = settle({ ...createInitialState(1), month: 1 }, custom)
    expect(next.cities.chengdu!.food).toBe(400 + 30)
    expect(next.cities.chengdu!.gold).toBe(500)
  })
})
