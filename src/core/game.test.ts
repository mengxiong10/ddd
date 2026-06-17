import { describe, it, expect } from 'vitest'
import { createInitialState } from './world/fixture'
import { apply, canApply, type Action } from './game'

function run(seed: number, actions: Action[]) {
  return actions.reduce((s, a) => apply(s, a), createInitialState(seed))
}

describe('game apply 分派', () => {
  it('reclaim 增长农业并占用武将', () => {
    const next = apply(createInitialState(1), { type: 'reclaim', officerId: 'zhugeliang' })
    expect(next.cities.chengdu!.agriculture).toBeGreaterThan(300)
    expect(next.officers.zhugeliang!.busy).toBe(true)
  })

  it('commerce 增长商业', () => {
    const next = apply(createInitialState(1), { type: 'commerce', officerId: 'zhugeliang' })
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
    expect(canApply(s, { type: 'reclaim', officerId: 'nobody' }).ok).toBe(false)
    expect(canApply(s, { type: 'reclaim', officerId: 'zhugeliang' }).ok).toBe(true)
  })

  it('指令反映 canRecruit / canAllocate 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'recruit', officerId: 'zhugeliang', amount: 100 }).ok).toBe(true)
    expect(canApply(s, { type: 'recruit', officerId: 'zhugeliang', amount: 99999 }).ok).toBe(false)
    expect(canApply(s, { type: 'allocate', officerId: 'zhugeliang', amount: 0 }).ok).toBe(true)
  })

  it('endMonth 恒可执行', () => {
    expect(canApply(createInitialState(1), { type: 'endMonth' }).ok).toBe(true)
  })
})

describe('征兵 / 分配 端到端', () => {
  it('征兵占人后经 endMonth 月末回城', () => {
    let s = apply(createInitialState(1), { type: 'recruit', officerId: 'zhugeliang', amount: 100 })
    expect(s.officers.zhugeliang!.busy).toBe(true)
    expect(s.cities.chengdu!.reserveTroops).toBe(100)
    s = apply(s, { type: 'endMonth' })
    expect(s.officers.zhugeliang!.busy).toBe(false)
  })

  it('分配不占人，同月该武将可再被下令（随后征兵）', () => {
    let s = apply(createInitialState(1), { type: 'allocate', officerId: 'zhugeliang', amount: 0 })
    expect(s.officers.zhugeliang!.busy).toBe(false)
    expect(s.officers.zhugeliang!.troops).toBe(0)
    expect(s.cities.chengdu!.reserveTroops).toBe(100)
    s = apply(s, { type: 'recruit', officerId: 'zhugeliang', amount: 50 })
    expect(s.officers.zhugeliang!.busy).toBe(true)
    expect(s.cities.chengdu!.reserveTroops).toBe(150)
  })
})

describe('掠夺 / 侦察 端到端', () => {
  it('掠夺占人、效果延到月末（破坏+收益）后回城、队列清空', () => {
    let s = apply(createInitialState(1), { type: 'plunder', officerId: 'zhugeliang' })
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
    let s = apply(createInitialState(1), { type: 'scout', officerId: 'zhugeliang', targetCityId: 'xuchang' })
    expect(s.officers.zhugeliang!.busy).toBe(true)
    expect(s.cities.chengdu!.gold).toBe(500 - 20)
    s = apply(s, { type: 'endMonth' })
    expect(s.officers.zhugeliang!.busy).toBe(false)
  })

  it('canApply 反映 canPlunder / canScout 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'plunder', officerId: 'zhugeliang' }).ok).toBe(true)
    expect(canApply(s, { type: 'scout', officerId: 'zhugeliang', targetCityId: 'jiangling' }).ok).toBe(false)
    expect(canApply(s, { type: 'scout', officerId: 'zhugeliang', targetCityId: 'xuchang' }).ok).toBe(true)
  })
})

describe('赏赐 / 没收 端到端', () => {
  it('赏赐：道具转给武将、忠诚+8、不占人（同月可再下令）', () => {
    let s = apply(createInitialState(1), { type: 'reward', officerId: 'zhugeliang', itemId: 'cixiongshuanggujian' })
    expect(s.items.cixiongshuanggujian!.holder).toEqual({ kind: 'officer', officerId: 'zhugeliang' })
    expect(s.officers.zhugeliang!.loyalty).toBe(58)
    expect(s.officers.zhugeliang!.busy).toBe(false)
    s = apply(s, { type: 'reclaim', officerId: 'zhugeliang' }) // 不占人 -> 仍可下令
    expect(s.officers.zhugeliang!.busy).toBe(true)
  })

  it('没收：道具收回城、忠诚−20', () => {
    let s = apply(createInitialState(1), { type: 'reward', officerId: 'zhugeliang', itemId: 'cixiongshuanggujian' })
    s = apply(s, { type: 'confiscate', officerId: 'zhugeliang', itemId: 'cixiongshuanggujian' })
    expect(s.items.cixiongshuanggujian!.holder).toEqual({ kind: 'city', cityId: 'chengdu' })
    expect(s.officers.zhugeliang!.loyalty).toBe(38) // 50 +8(赏) −20(没) = 38
  })

  it('canApply 反映 canReward / canConfiscate 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'reward', officerId: 'zhugeliang', itemId: 'cixiongshuanggujian' }).ok).toBe(true)
    expect(canApply(s, { type: 'reward', officerId: 'zhugeliang', itemId: 'mengde-xinshu' }).ok).toBe(false)
    expect(canApply(s, { type: 'confiscate', officerId: 'zhugeliang', itemId: 'cixiongshuanggujian' }).ok).toBe(false)
  })
})

describe('出巡 / 宴请 / 交易 端到端', () => {
  it('出巡占人、即时提升民忠+人口，月末回城', () => {
    let s = apply(createInitialState(1), { type: 'patrol', officerId: 'zhugeliang' })
    expect(s.officers.zhugeliang!.busy).toBe(true)
    expect(s.cities.chengdu!.population).toBe(30000 + 100)
    expect(s.cities.chengdu!.loyalty).toBeGreaterThan(50)
    expect(s.cities.chengdu!.gold).toBe(500 - 50)
    expect(s.pendingCommands).toEqual([])
    s = apply(s, { type: 'endMonth' })
    expect(s.officers.zhugeliang!.busy).toBe(false)
  })

  it('宴请不占人：被宴请者同月仍可被派去开垦', () => {
    let s = apply(createInitialState(1), { type: 'banquet', officerId: 'zhugeliang' })
    expect(s.officers.zhugeliang!.busy).toBe(false)
    expect(s.cities.chengdu!.gold).toBe(500 - 100)
    s = apply(s, { type: 'reclaim', officerId: 'zhugeliang' })
    expect(s.officers.zhugeliang!.busy).toBe(true)
  })

  it('交易买入即时结算并占人', () => {
    const s = apply(createInitialState(1), { type: 'trade', officerId: 'zhugeliang', mode: 'buy', amount: 50 })
    expect(s.cities.chengdu!.food).toBe(450)
    expect(s.cities.chengdu!.gold).toBe(250)
    expect(s.officers.zhugeliang!.busy).toBe(true)
  })

  it('canApply 反映 canPatrol / canBanquet / canTrade 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'patrol', officerId: 'zhugeliang' }).ok).toBe(true)
    expect(canApply(s, { type: 'banquet', officerId: 'nobody' }).ok).toBe(false)
    expect(canApply(s, { type: 'trade', officerId: 'zhugeliang', mode: 'buy', amount: 99999 }).ok).toBe(false)
  })
})

describe('移动 / 输送 端到端', () => {
  it('移动占人、月末落到目标己方城（不回出发城）、队列清空', () => {
    let s = apply(createInitialState(1), { type: 'move', officerId: 'zhugeliang', targetCityId: 'jiangling' })
    expect(s.officers.zhugeliang!.busy).toBe(true)
    expect(s.officers.zhugeliang!.cityId).toBe('chengdu') // 下令当下未移动
    expect(s.pendingCommands).toHaveLength(1)
    s = apply(s, { type: 'endMonth' })
    expect(s.officers.zhugeliang!.cityId).toBe('jiangling')
    expect(s.officers.zhugeliang!.busy).toBe(false)
    expect(s.pendingCommands).toEqual([])
  })

  it('输送：下令即扣出发城资源，月末送达/永损后执行人回原城', () => {
    let s0 = createInitialState(1)
    s0 = { ...s0, cities: { ...s0.cities, chengdu: { ...s0.cities.chengdu!, reserveTroops: 100 } } }
    const beforeJL = s0.cities.jiangling!
    let s = apply(s0, { type: 'transport', officerId: 'zhugeliang', targetCityId: 'jiangling', food: 100, gold: 50, troops: 30 })
    expect(s.cities.chengdu!.food).toBe(400 - 100)
    expect(s.cities.chengdu!.reserveTroops).toBe(100 - 30)
    expect(s.pendingCommands).toHaveLength(1)
    s = apply(s, { type: 'endMonth' })
    expect(s.officers.zhugeliang!.busy).toBe(false)
    expect(s.officers.zhugeliang!.cityId).toBe('chengdu') // 执行人回原城
    // 送达或永损二选一，但目标城不会减少
    const jl = s.cities.jiangling!
    const delivered = jl.food === beforeJL.food + 100
    expect(delivered || jl.food === beforeJL.food).toBe(true)
    expect(s.pendingCommands).toEqual([])
  })

  it('canApply 反映 canMove / canTransport 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'move', officerId: 'zhugeliang', targetCityId: 'jiangling' }).ok).toBe(true)
    expect(canApply(s, { type: 'move', officerId: 'zhugeliang', targetCityId: 'xuchang' }).ok).toBe(false)
    expect(canApply(s, { type: 'transport', officerId: 'zhugeliang', targetCityId: 'jiangling', food: 0, gold: 0, troops: 0 }).ok).toBe(true)
    expect(canApply(s, { type: 'transport', officerId: 'zhugeliang', targetCityId: 'xuchang', food: 0, gold: 0, troops: 0 }).ok).toBe(false)
  })
})

describe('端到端确定性', () => {
  it('相同 seed + 相同动作序列 -> 完全一致', () => {
    const actions: Action[] = [
      { type: 'reclaim', officerId: 'zhugeliang' },
      { type: 'allocate', officerId: 'pangtong', amount: 0 },
      { type: 'recruit', officerId: 'pangtong', amount: 80 },
      { type: 'reclaim', officerId: 'guanyu' },
      { type: 'endMonth' },
      { type: 'recruit', officerId: 'zhugeliang', amount: 50 },
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
