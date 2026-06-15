import { describe, it, expect } from 'vitest'
import { createInitialState } from './world/fixture'
import { apply, canApply, type Action } from './game'

function run(seed: number, actions: Action[]) {
  return actions.reduce((s, a) => apply(s, a), createInitialState(seed))
}

describe('game apply 分派', () => {
  it('reclaim 增长农业并占用武将', () => {
    const next = apply(createInitialState(1), { type: 'reclaim', cityId: 'chengdu', officerId: 'zhugeliang' })
    expect(next.cities.chengdu!.agriculture).toBeGreaterThan(300)
    expect(next.officers.zhugeliang!.busy).toBe(true)
  })

  it('commerce 增长商业', () => {
    const next = apply(createInitialState(1), { type: 'commerce', cityId: 'chengdu', officerId: 'zhugeliang' })
    expect(next.cities.chengdu!.commerce).toBeGreaterThan(200)
  })

  it('endMonth 推进月份', () => {
    const next = apply(createInitialState(1), { type: 'endMonth' })
    expect(next.month).toBe(2)
  })
})

describe('canApply', () => {
  it('指令反映 canDevelop 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'reclaim', cityId: 'chengdu', officerId: 'guanyu' }).ok).toBe(false)
    expect(canApply(s, { type: 'reclaim', cityId: 'chengdu', officerId: 'zhugeliang' }).ok).toBe(true)
  })

  it('endMonth 恒可执行', () => {
    expect(canApply(createInitialState(1), { type: 'endMonth' }).ok).toBe(true)
  })
})

describe('端到端确定性', () => {
  it('相同 seed + 相同动作序列 -> 完全一致', () => {
    const actions: Action[] = [
      { type: 'reclaim', cityId: 'chengdu', officerId: 'zhugeliang' },
      { type: 'commerce', cityId: 'chengdu', officerId: 'pangtong' },
      { type: 'reclaim', cityId: 'jiangling', officerId: 'guanyu' },
      { type: 'endMonth' },
      { type: 'reclaim', cityId: 'chengdu', officerId: 'zhugeliang' },
      { type: 'endMonth' },
    ]
    expect(run(99, actions)).toEqual(run(99, actions))
  })

  it('推进半年后在 6 月完成首次收粮+收税', () => {
    // 起始 1 月，连续 5 次 endMonth 到 6 月，再 endMonth 触发 6 月结算
    let s = createInitialState(1)
    for (let i = 0; i < 5; i++) s = apply(s, { type: 'endMonth' })
    expect(s.month).toBe(6)
    const before = s.cities.chengdu!
    s = apply(s, { type: 'endMonth' })
    expect(s.cities.chengdu!.food).toBe(before.food + Math.floor(before.agriculture / 4))
    expect(s.cities.chengdu!.gold).toBe(before.gold + Math.floor(before.commerce / 2))
    expect(s.month).toBe(7)
  })
})
