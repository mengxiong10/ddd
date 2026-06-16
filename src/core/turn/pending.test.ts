import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import { plunder } from '../economy/plunder'
import { runPendingCommands } from './pending'

const cfg = DEFAULT_CONFIG

describe('runPendingCommands 月末待执行分派', () => {
  it('执行掠夺并清空队列', () => {
    const queued = plunder(createInitialState(1), 'zhugeliang', cfg)
    const next = runPendingCommands(queued, cfg)
    expect(next.cities.chengdu!.agriculture).toBe(150)
    expect(next.cities.chengdu!.food).toBe(400 + 750)
    expect(next.cities.chengdu!.gold).toBe(500 + 300)
    expect(next.pendingCommands).toEqual([])
  })

  it('空队列原样返回', () => {
    const s = createInitialState(1)
    expect(runPendingCommands(s, cfg)).toBe(s)
  })

  it('同城多条连续减半、收益累加', () => {
    // 诸葛亮 power=150、庞统 power=140（智90+武50）
    let s = plunder(createInitialState(1), 'zhugeliang', cfg)
    s = plunder(s, 'pangtong', cfg)
    const next = runPendingCommands(s, cfg)
    expect(next.cities.chengdu!.agriculture).toBe(75) // 300->150->75
    expect(next.cities.chengdu!.commerce).toBe(50) // 200->100->50
    expect(next.cities.chengdu!.loyalty).toBe(12) // 50->25->12
    expect(next.cities.chengdu!.food).toBe(400 + 750 + 700)
    expect(next.cities.chengdu!.gold).toBe(500 + 300 + 280)
  })

  it('结果与下令顺序无关', () => {
    const base = createInitialState(1)
    const ab = runPendingCommands(plunder(plunder(base, 'zhugeliang', cfg), 'pangtong', cfg), cfg)
    const ba = runPendingCommands(plunder(plunder(base, 'pangtong', cfg), 'zhugeliang', cfg), cfg)
    expect(ab.cities.chengdu).toEqual(ba.cities.chengdu)
  })
})
