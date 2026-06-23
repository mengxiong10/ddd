import { describe, it, expect } from 'vitest'
import { createInitialState } from './world/fixture'
import { apply, applyWithEvents, canApply, type Action } from './game'
import type { GameState } from './game-state'
import { isBusy } from './world/queries'
import { WEATHER_ORDER } from './military/battle-weather'

function run(seed: number, actions: Action[]) {
  return actions.reduce((s, a) => apply(s, a), createInitialState(seed))
}

describe('game apply 分派', () => {
  it('reclaim 增长农业并占用武将', () => {
    const next = apply(createInitialState(1), { type: 'reclaim', officerId: 2 })
    expect(next.cities[1]!.agriculture).toBeGreaterThan(300)
    expect(isBusy(next, 2)).toBe(true)
  })

  it('commerce 增长商业', () => {
    const next = apply(createInitialState(1), { type: 'commerce', officerId: 2 })
    expect(next.cities[1]!.commerce).toBeGreaterThan(200)
  })

  it('endMonth 推进月份', () => {
    const next = apply(createInitialState(1), { type: 'endMonth' })
    expect(next.month).toBe(2)
  })

  it('applyWithEvents 产事件、自报告 ok、apply 取其 .state（逐字节一致）', () => {
    const s = createInitialState(1)
    const action: Action = { type: 'reclaim', officerId: 2 }
    const { ok, reason, state, events } = applyWithEvents(s, action)
    expect(ok).toBe(true)
    expect(reason).toBeUndefined()
    expect(state).toEqual(apply(s, action))
    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe('develop-done')
  })

  it('applyWithEvents 经营动作失败：冒泡 reason、state 不变、无事件（校验只跑一次）', () => {
    const s = createInitialState(1)
    // 庞统占用诸葛亮后再令其开垦 → officer-busy
    const busy = { ...s, pendingCommands: [{ type: 'reclaim', officerId: 2 } as const] }
    const res = applyWithEvents(busy, { type: 'reclaim', officerId: 2 })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('officer-busy')
    expect(res.state).toBe(busy)
    expect(res.events).toEqual([])
  })

  it('战斗端到端：出征→endMonth 挂起→battle 撤退→resumeMonth 续月末', () => {
    const ordered = apply(createInitialState(1), {
      type: 'campaign',
      officerIds: [4, 5],
      targetCityId: 3,
      provisions: 120,
    })
    const suspended = apply(ordered, { type: 'endMonth' })
    expect(suspended.activeBattle).not.toBeNull()
    // 战斗进行中不可 endMonth
    expect(canApply(suspended, { type: 'endMonth' }).ok).toBe(false)
    // 撤退判玩家败，再续月末
    const retreated = apply(suspended, { type: 'battle', action: { type: 'retreat' } })
    expect(retreated.activeBattle!.outcome).toBe('playerLose')
    const next = apply(retreated, { type: 'resumeMonth' })
    expect(next.activeBattle).toBeNull()
    expect(next.month).toBe(2)
    expect(next.cities[3]!.lordId).toBe(6) // 败，未占城
  })

  it('玩家君主出征被俘：resumeMonth 挂起待选新君→endMonth 被拒→chooseSuccessor 续跑', () => {
    // 刘备(智力设0→必被俘)单独从江陵出征许昌
    let s = createInitialState(1)
    s = {
      ...s,
      officers: {
        ...s.officers,
        1: { ...s.officers[1]!, cityId: 2, intelligence: 0 },
      },
    }
    const ordered = apply(s, {
      type: 'campaign',
      officerIds: [1],
      targetCityId: 3,
      provisions: 50,
    })
    const suspended = apply(ordered, { type: 'endMonth' })
    const lost = apply(suspended, { type: 'battle', action: { type: 'retreat' } }) // 撤退判败
    const paused = apply(lost, { type: 'resumeMonth' })

    expect(paused.pendingSuccession).toEqual({ lordId: 1 })
    expect(canApply(paused, { type: 'endMonth' }).ok).toBe(false) // 待选新君期间拒绝推进
    expect(canApply(paused, { type: 'chooseSuccessor', officerId: 6 }).ok).toBe(false) // 非候选

    const done = apply(paused, { type: 'chooseSuccessor', officerId: 4 })
    expect(done.pendingSuccession).toBeNull()
    expect(done.playerLordId).toBe(4)
    expect(done.month).toBe(2)
  })

  it('AI 进攻玩家城：pendingDefense 期间拒推进，chooseDefenders 开战/弃守经 apply 分派', () => {
    // 模拟 AI 已下令：曹操出征江陵；挂起待玩家选守军。
    const base = createInitialState(1)
    const paused: GameState = {
      ...base,
      pendingCommands: [{ type: 'campaign', officerIds: [6], targetCityId: 2, provisions: 50 }],
      pendingDefense: { targetCityId: 2 },
    }
    expect(canApply(paused, { type: 'endMonth' }).ok).toBe(false)
    expect(canApply(paused, { type: 'chooseDefenders', officerIds: [6] }).ok).toBe(false)
    expect(canApply(paused, { type: 'chooseDefenders', officerIds: [4] }).ok).toBe(true)

    const fighting = apply(paused, { type: 'chooseDefenders', officerIds: [4, 5] })
    expect(fighting.pendingDefense).toBeNull()
    expect(fighting.activeBattle!.mode).toBe('defend')

    // 弃守（选 0 名）→ 直接被占、续跑月末。
    const surrendered = apply(paused, { type: 'chooseDefenders', officerIds: [] })
    expect(surrendered.cities[2]!.lordId).toBe(6)
    expect(surrendered.month).toBe(2)
  })

  it('战斗挂起即初始化技能系统：天气/MP/状态（initBattle+startDay 全链接线）', () => {
    const ordered = apply(createInitialState(1), {
      type: 'campaign',
      officerIds: [4, 5],
      targetCityId: 3,
      provisions: 120,
    })
    const b = apply(ordered, { type: 'endMonth' }).activeBattle!
    expect(WEATHER_ORDER).toContain(b.weather) // startDay 已刷新天气
    expect(b.units[4]!.mp).toBeGreaterThan(0) // initBattle 派生 MP
    expect(b.units[4]!.status).toBe('normal')
  })
})

describe('canApply', () => {
  it('指令反映 canDevelop 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'reclaim', officerId: 999 }).ok).toBe(false)
    expect(canApply(s, { type: 'reclaim', officerId: 2 }).ok).toBe(true)
  })

  it('指令反映 canRecruit / canAllocate 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'recruit', officerId: 2, amount: 100 }).ok).toBe(true)
    expect(canApply(s, { type: 'recruit', officerId: 2, amount: 99999 }).ok).toBe(false)
    expect(canApply(s, { type: 'allocate', officerId: 2, amount: 0 }).ok).toBe(true)
  })

  it('endMonth 恒可执行', () => {
    expect(canApply(createInitialState(1), { type: 'endMonth' }).ok).toBe(true)
  })
})

describe('征兵 / 分配 端到端', () => {
  it('征兵占人后经 endMonth 月末回城', () => {
    let s = apply(createInitialState(1), { type: 'recruit', officerId: 2, amount: 100 })
    expect(isBusy(s, 2)).toBe(true)
    expect(s.cities[1]!.reserveTroops).toBe(100)
    s = apply(s, { type: 'endMonth' })
    expect(isBusy(s, 2)).toBe(false)
  })

  it('分配不占人，同月该武将可再被下令（随后征兵）', () => {
    let s = apply(createInitialState(1), { type: 'allocate', officerId: 2, amount: 0 })
    expect(isBusy(s, 2)).toBe(false)
    expect(s.officers[2]!.troops).toBe(0)
    expect(s.cities[1]!.reserveTroops).toBe(100)
    s = apply(s, { type: 'recruit', officerId: 2, amount: 50 })
    expect(isBusy(s, 2)).toBe(true)
    expect(s.cities[1]!.reserveTroops).toBe(150)
  })
})

describe('掠夺 / 侦察 端到端', () => {
  it('掠夺占人、效果延到月末（破坏+收益）后回城、队列清空', () => {
    let s = apply(createInitialState(1), { type: 'plunder', officerId: 2 })
    expect(isBusy(s, 2)).toBe(true)
    expect(s.cities[1]!.agriculture).toBe(300) // 下令当下不破坏
    expect(s.pendingCommands).toHaveLength(1)
    s = apply(s, { type: 'endMonth' })
    expect(s.cities[1]!.agriculture).toBe(150) // 月末破坏
    expect(s.cities[1]!.food).toBe(400 + 750)
    expect(s.cities[1]!.gold).toBe(500 + 300)
    expect(isBusy(s, 2)).toBe(false)
    expect(s.pendingCommands).toEqual([])
  })

  it('侦察占人、即时扣金扣体力，月末回城', () => {
    let s = apply(createInitialState(1), {
      type: 'scout',
      officerId: 2,
      targetCityId: 3,
    })
    expect(isBusy(s, 2)).toBe(true)
    expect(s.cities[1]!.gold).toBe(500 - 20)
    s = apply(s, { type: 'endMonth' })
    expect(isBusy(s, 2)).toBe(false)
  })

  it('canApply 反映 canPlunder / canScout 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'plunder', officerId: 2 }).ok).toBe(true)
    expect(canApply(s, { type: 'scout', officerId: 2, targetCityId: 2 }).ok).toBe(false)
    expect(canApply(s, { type: 'scout', officerId: 2, targetCityId: 3 }).ok).toBe(true)
  })
})

describe('赏赐 / 没收 端到端', () => {
  it('赏赐：道具转给武将、忠诚+8、不占人（同月可再下令）', () => {
    let s = apply(createInitialState(1), {
      type: 'reward',
      officerId: 2,
      itemId: 1,
    })
    expect(s.items[1]!.holder).toEqual({
      kind: 'officer',
      officerId: 2,
      equipSeq: 0,
    })
    expect(s.officers[2]!.loyalty).toBe(58)
    expect(isBusy(s, 2)).toBe(false)
    s = apply(s, { type: 'reclaim', officerId: 2 }) // 不占人 -> 仍可下令
    expect(isBusy(s, 2)).toBe(true)
  })

  it('没收：道具收回城、忠诚−20', () => {
    let s = apply(createInitialState(1), {
      type: 'reward',
      officerId: 2,
      itemId: 1,
    })
    s = apply(s, { type: 'confiscate', officerId: 2, itemId: 1 })
    expect(s.items[1]!.holder).toEqual({ kind: 'city', cityId: 1 })
    expect(s.officers[2]!.loyalty).toBe(38) // 50 +8(赏) −20(没) = 38
  })

  it('canApply 反映 canReward / canConfiscate 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'reward', officerId: 2, itemId: 1 }).ok).toBe(true)
    expect(canApply(s, { type: 'reward', officerId: 2, itemId: 2 }).ok).toBe(false)
    expect(canApply(s, { type: 'confiscate', officerId: 2, itemId: 1 }).ok).toBe(false)
  })
})

describe('出巡 / 宴请 / 交易 端到端', () => {
  it('出巡占人、即时提升民忠+人口，月末回城', () => {
    let s = apply(createInitialState(1), { type: 'patrol', officerId: 2 })
    expect(isBusy(s, 2)).toBe(true)
    expect(s.cities[1]!.population).toBe(30000 + 100)
    expect(s.cities[1]!.loyalty).toBeGreaterThan(50)
    expect(s.cities[1]!.gold).toBe(500 - 50)
    expect(s.pendingCommands).toEqual([{ type: 'patrol', officerId: 2 }])
    s = apply(s, { type: 'endMonth' })
    expect(isBusy(s, 2)).toBe(false)
  })

  it('宴请不占人：被宴请者同月仍可被派去开垦', () => {
    let s = apply(createInitialState(1), { type: 'banquet', officerId: 2 })
    expect(isBusy(s, 2)).toBe(false)
    expect(s.cities[1]!.gold).toBe(500 - 100)
    s = apply(s, { type: 'reclaim', officerId: 2 })
    expect(isBusy(s, 2)).toBe(true)
  })

  it('交易买入即时结算并占人', () => {
    const s = apply(createInitialState(1), {
      type: 'trade',
      officerId: 2,
      mode: 'buy',
      amount: 50,
    })
    expect(s.cities[1]!.food).toBe(450)
    expect(s.cities[1]!.gold).toBe(250)
    expect(isBusy(s, 2)).toBe(true)
  })

  it('canApply 反映 canPatrol / canBanquet / canTrade 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'patrol', officerId: 2 }).ok).toBe(true)
    expect(canApply(s, { type: 'banquet', officerId: 999 }).ok).toBe(false)
    expect(canApply(s, { type: 'trade', officerId: 2, mode: 'buy', amount: 99999 }).ok).toBe(false)
  })
})

describe('移动 / 输送 端到端', () => {
  it('移动占人、月末落到目标己方城（不回出发城）、队列清空', () => {
    let s = apply(createInitialState(1), {
      type: 'move',
      officerId: 2,
      targetCityId: 2,
    })
    expect(isBusy(s, 2)).toBe(true)
    expect(s.officers[2]!.cityId).toBe(1) // 下令当下未移动
    expect(s.pendingCommands).toHaveLength(1)
    s = apply(s, { type: 'endMonth' })
    expect(s.officers[2]!.cityId).toBe(2)
    expect(isBusy(s, 2)).toBe(false)
    expect(s.pendingCommands).toEqual([])
  })

  it('输送：下令即扣出发城资源，月末送达/永损后执行人回原城', () => {
    let s0 = createInitialState(1)
    s0 = { ...s0, cities: { ...s0.cities, 1: { ...s0.cities[1]!, reserveTroops: 100 } } }
    const beforeJL = s0.cities[2]!
    let s = apply(s0, {
      type: 'transport',
      officerId: 2,
      targetCityId: 2,
      food: 100,
      gold: 50,
      troops: 30,
    })
    expect(s.cities[1]!.food).toBe(400 - 100)
    expect(s.cities[1]!.reserveTroops).toBe(100 - 30)
    expect(s.pendingCommands).toHaveLength(1)
    s = apply(s, { type: 'endMonth' })
    expect(isBusy(s, 2)).toBe(false)
    expect(s.officers[2]!.cityId).toBe(1) // 执行人回原城
    // 送达或永损二选一，但目标城不会减少
    const jl = s.cities[2]!
    const delivered = jl.food === beforeJL.food + 100
    expect(delivered || jl.food === beforeJL.food).toBe(true)
    expect(s.pendingCommands).toEqual([])
  })

  it('canApply 反映 canMove / canTransport 校验', () => {
    const s = createInitialState(1)
    expect(canApply(s, { type: 'move', officerId: 2, targetCityId: 2 }).ok).toBe(true)
    expect(canApply(s, { type: 'move', officerId: 2, targetCityId: 3 }).ok).toBe(false)
    expect(
      canApply(s, {
        type: 'transport',
        officerId: 2,
        targetCityId: 2,
        food: 0,
        gold: 0,
        troops: 0,
      }).ok
    ).toBe(true)
    expect(
      canApply(s, {
        type: 'transport',
        officerId: 2,
        targetCityId: 3,
        food: 0,
        gold: 0,
        troops: 0,
      }).ok
    ).toBe(false)
  })
})

describe('招降 / 处斩 / 流放 端到端', () => {
  // 许昌被刘备占（曹操等成俘虏），关羽进许昌当执行人。
  function conquered(seed: number) {
    let s = createInitialState(seed)
    s = { ...s, cities: { ...s.cities, 3: { ...s.cities[3]!, lordId: 1 } } }
    s = {
      ...s,
      officers: {
        ...s.officers,
        4: { ...s.officers[4]!, cityId: 3, intelligence: 100 },
      },
    }
    s = {
      ...s,
      officers: { ...s.officers, 6: { ...s.officers[6]!, intelligence: 1, loyalty: 0 } },
    }
    return s
  }

  it('招降占人、月末四关后归己（忠诚0必成），执行人回城、队列清空', () => {
    let s = apply(conquered(1), { type: 'suborn', officerId: 4, captiveId: 6 })
    expect(isBusy(s, 4)).toBe(true)
    expect(s.officers[6]!.lordId).toBe(6) // 下令当下未生效
    expect(s.pendingCommands).toHaveLength(1)
    s = apply(s, { type: 'endMonth' })
    expect(s.officers[6]!.lordId).toBe(1) // 月末归己
    expect(isBusy(s, 4)).toBe(false)
    expect(s.pendingCommands).toEqual([])
  })

  it('同城两招降同一俘虏：先成者归己，后者守卫跳过（不报错）', () => {
    let s = conquered(1)
    s = {
      ...s,
      officers: {
        ...s.officers,
        5: { ...s.officers[5]!, cityId: 3, intelligence: 100 },
      },
    }
    s = apply(s, { type: 'suborn', officerId: 4, captiveId: 6 })
    s = apply(s, { type: 'suborn', officerId: 5, captiveId: 6 })
    expect(s.pendingCommands).toHaveLength(2)
    s = apply(s, { type: 'endMonth' })
    expect(s.officers[6]!.lordId).toBe(1)
  })

  it('处斩即时删除俘虏', () => {
    const s = apply(conquered(1), { type: 'behead', captiveId: 6 })
    expect(s.officers[6]).toBeUndefined()
  })

  it('流放即时变在野', () => {
    const s = apply(conquered(1), { type: 'banish', officerId: 6 })
    expect(s.officers[6]!.lordId).toBeNull()
  })

  it('canApply 反映 canSuborn / canBehead / canBanish 校验', () => {
    const s = conquered(1)
    expect(canApply(s, { type: 'suborn', officerId: 4, captiveId: 6 }).ok).toBe(true)
    expect(canApply(s, { type: 'behead', captiveId: 6 }).ok).toBe(true)
    expect(canApply(s, { type: 'banish', officerId: 1 }).ok).toBe(false) // 在任君主
    expect(canApply(createInitialState(1), { type: 'behead', captiveId: 6 }).ok).toBe(false) // 未被俘
  })
})

describe('端到端确定性', () => {
  it('相同 seed + 相同动作序列 -> 完全一致', () => {
    const actions: Action[] = [
      { type: 'reclaim', officerId: 2 },
      { type: 'allocate', officerId: 3, amount: 0 },
      { type: 'recruit', officerId: 3, amount: 80 },
      { type: 'reclaim', officerId: 4 },
      { type: 'endMonth' },
      { type: 'recruit', officerId: 2, amount: 50 },
      { type: 'endMonth' },
    ]
    expect(run(99, actions)).toEqual(run(99, actions))
  })

  it('推进半年后在 6 月完成首次收粮+收税', () => {
    // 起始 1 月，连续 5 次 endMonth 到 6 月，再 endMonth 触发 6 月结算。
    // 防灾值置满 100 隔绝灾害噪声（永不发灾、无破坏），只验收粮/收税日历本身。
    const init = createInitialState(1)
    let s: GameState = {
      ...init,
      cities: Object.fromEntries(
        Object.entries(init.cities).map(([id, c]) => [id, { ...c, disasterPrevention: 100 }])
      ),
    }
    for (let i = 0; i < 5; i++) s = apply(s, { type: 'endMonth' })
    expect(s.month).toBe(6)
    const before = s.cities[1]!
    s = apply(s, { type: 'endMonth' })
    expect(s.cities[1]!.food).toBe(before.food + Math.floor(before.agriculture / 4))
    expect(s.cities[1]!.gold).toBe(before.gold + Math.floor(before.commerce / 2))
    expect(s.month).toBe(7)
  })
})
