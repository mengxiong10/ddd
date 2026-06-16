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

  it('指令反映 canRecruit / canAllocate 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'recruit', cityId: 'chengdu', officerId: 'zhugeliang', amount: 100 }).ok).toBe(true)
    expect(canApply(s, { type: 'recruit', cityId: 'chengdu', officerId: 'zhugeliang', amount: 99999 }).ok).toBe(false)
    expect(canApply(s, { type: 'allocate', cityId: 'chengdu', officerId: 'zhugeliang', amount: 0 }).ok).toBe(true)
  })

  it('endMonth 恒可执行', () => {
    expect(canApply(createInitialState(1), { type: 'endMonth' }).ok).toBe(true)
  })
})

describe('征兵 / 分配 端到端', () => {
  it('征兵占人后经 endMonth 月末回城', () => {
    let s = apply(createInitialState(1), { type: 'recruit', cityId: 'chengdu', officerId: 'zhugeliang', amount: 100 })
    expect(s.officers.zhugeliang!.busy).toBe(true)
    expect(s.cities.chengdu!.reserveTroops).toBe(100)
    s = apply(s, { type: 'endMonth' })
    expect(s.officers.zhugeliang!.busy).toBe(false)
  })

  it('分配不占人，同月该武将可再被下令（随后征兵）', () => {
    let s = apply(createInitialState(1), { type: 'allocate', cityId: 'chengdu', officerId: 'zhugeliang', amount: 0 })
    expect(s.officers.zhugeliang!.busy).toBe(false)
    expect(s.officers.zhugeliang!.troops).toBe(0)
    expect(s.cities.chengdu!.reserveTroops).toBe(100)
    s = apply(s, { type: 'recruit', cityId: 'chengdu', officerId: 'zhugeliang', amount: 50 })
    expect(s.officers.zhugeliang!.busy).toBe(true)
    expect(s.cities.chengdu!.reserveTroops).toBe(150)
  })
})

describe('掠夺 / 侦察 端到端', () => {
  it('掠夺占人、效果延到月末（破坏+收益）后回城、队列清空', () => {
    let s = apply(createInitialState(1), { type: 'plunder', cityId: 'chengdu', officerId: 'zhugeliang' })
    expect(s.officers.zhugeliang!.busy).toBe(true)
    expect(s.cities.chengdu!.agriculture).toBe(300) // 下令当下不破坏
    expect(s.pendingCommands).toHaveLength(1)
    s = apply(s, { type: 'endMonth' })
    expect(s.cities.chengdu!.agriculture).toBe(150) // 月末破坏
    expect(s.cities.chengdu!.food).toBe(400 + 750)
    expect(s.cities.chengdu!.gold).toBe(500 + 300)
    expect(s.officers.zhugeliang!.busy).toBe(false)
    expect(s.pendingCommands).toEqual([])
  })

  it('侦察占人、即时扣金扣体力，月末回城', () => {
    let s = apply(createInitialState(1), { type: 'scout', cityId: 'chengdu', officerId: 'zhugeliang', targetCityId: 'xuchang' })
    expect(s.officers.zhugeliang!.busy).toBe(true)
    expect(s.cities.chengdu!.gold).toBe(500 - 20)
    s = apply(s, { type: 'endMonth' })
    expect(s.officers.zhugeliang!.busy).toBe(false)
  })

  it('canApply 反映 canPlunder / canScout 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'plunder', cityId: 'chengdu', officerId: 'zhugeliang' }).ok).toBe(true)
    expect(canApply(s, { type: 'scout', cityId: 'chengdu', officerId: 'zhugeliang', targetCityId: 'jiangling' }).ok).toBe(false)
    expect(canApply(s, { type: 'scout', cityId: 'chengdu', officerId: 'zhugeliang', targetCityId: 'xuchang' }).ok).toBe(true)
  })
})

describe('端到端确定性', () => {
  it('相同 seed + 相同动作序列 -> 完全一致', () => {
    const actions: Action[] = [
      { type: 'reclaim', cityId: 'chengdu', officerId: 'zhugeliang' },
      { type: 'allocate', cityId: 'chengdu', officerId: 'pangtong', amount: 0 },
      { type: 'recruit', cityId: 'chengdu', officerId: 'pangtong', amount: 80 },
      { type: 'reclaim', cityId: 'jiangling', officerId: 'guanyu' },
      { type: 'endMonth' },
      { type: 'recruit', cityId: 'chengdu', officerId: 'zhugeliang', amount: 50 },
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
