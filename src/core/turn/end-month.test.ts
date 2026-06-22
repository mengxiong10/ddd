import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import { develop } from '../economy/develop'
import { plunder } from '../economy/plunder'
import { campaign } from '../economy/campaign'
import { isBusy, isCaptive } from '../world/queries'
import type { GameState } from '../game-state'
import type { BattleState } from '../military/battle'
import {
  endMonth,
  endMonthWithEvents,
  resumeMonth,
  chooseSuccessor,
  advanceCampaigns,
  chooseDefenders,
  canChooseDefenders,
} from './end-month'
import type { PendingCommand } from '../game-state'

const cfg = DEFAULT_CONFIG

function withOfficer(
  s: GameState,
  id: number,
  patch: Partial<GameState['officers'][number]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

describe('endMonth 月末编排', () => {
  it('月份 +1', () => {
    const next = endMonth(createInitialState(1), cfg)
    expect(next.month).toBe(2)
    expect(next.year).toBe(189)
  })

  it('月末执行的掠夺事件经 endMonthWithEvents 冒泡（与 .state 同步）', () => {
    const queued = plunder(createInitialState(1), 2, cfg).state
    const { state, events } = endMonthWithEvents(queued, cfg)
    expect(events).toContainEqual({
      kind: 'plunder-done',
      officerId: 2,
      cityId: 1,
      goldGained: 300,
      foodGained: 750,
    })
    expect(state).toEqual(endMonth(queued, cfg))
  })

  it('12 月跨年到次年 1 月', () => {
    const next = endMonth({ ...createInitialState(1), month: 12 }, cfg)
    expect(next.month).toBe(1)
    expect(next.year).toBe(190)
  })

  it('占用武将月末释放占用、体力 +4 封顶', () => {
    const afterCmd = develop(createInitialState(1), 2, 'agriculture', cfg).state
    expect(isBusy(afterCmd, 2)).toBe(true)
    expect(afterCmd.officers[2]!.stamina).toBe(92)

    const next = endMonth(afterCmd, cfg)
    expect(isBusy(next, 2)).toBe(false)
    expect(next.officers[2]!.stamina).toBe(96)
  })

  it('满体力武将恢复后仍封顶 100', () => {
    const next = endMonth(createInitialState(1), cfg)
    expect(next.officers[4]!.stamina).toBe(100)
  })

  it('结算月触发收粮/收税', () => {
    const next = endMonth({ ...createInitialState(1), month: 6 }, cfg)
    expect(next.cities[1]!.food).toBe(400 + 75)
    expect(next.cities[1]!.gold).toBe(500 + 100)
    expect(next.month).toBe(7)
  })

  it('掠夺先于收粮/收税：收粮月按减半后的农业/商业结算，队列清空、执行人回城', () => {
    // 6 月（收粮+收税）：先掠夺成都（农 300->150、商 200->100），收益粮+750/金+300，再按减半后收粮 floor(150/4)=37、收税 floor(100/2)=50
    const queued = plunder({ ...createInitialState(1), month: 6 }, 2, cfg).state
    const next = endMonth(queued, cfg)
    const c = next.cities[1]!
    expect(c.agriculture).toBe(150)
    expect(c.commerce).toBe(100)
    expect(c.loyalty).toBe(25)
    expect(c.food).toBe(400 + 750 + 37)
    expect(c.gold).toBe(500 + 300 + 50)
    expect(next.pendingCommands).toEqual([])
    expect(isBusy(next, 2)).toBe(false)
  })

  it('玩家出征：endMonth 挂起为交互式战斗，不立即占城/不推进月份', () => {
    const boosted = withOfficer(createInitialState(1), 4, { troops: 500 })
    const queued = campaign(boosted, [4, 5], 3, 120).state
    const next = endMonth(queued, cfg)

    expect(next.activeBattle).not.toBeNull()
    expect(next.activeBattle!.mode).toBe('attack')
    expect(next.cities[3]!.lordId).toBe(6) // 尚未结算
    expect(next.month).toBe(1) // 月末挂起，未推进
    expect(next.pendingCommands).toHaveLength(1) // campaign 留队待续战
  })

  it('resumeMonth：战斗玩家胜→占城 + 被俘君主重选 + 续完月末（进驻、释放占用、月份+1、队列清空）', () => {
    let boosted = withOfficer(createInitialState(1), 4, { troops: 500 })
    boosted = withOfficer(boosted, 6, { intelligence: 0 }) // 战败必被俘（barring r1==0）
    const suspended = endMonth(campaign(boosted, [4, 5], 3, 120).state, cfg)
    const won: GameState = {
      ...suspended,
      activeBattle: { ...(suspended.activeBattle as BattleState), outcome: 'playerWin' },
    }
    const next = resumeMonth(won, cfg).state

    expect(next.activeBattle).toBeNull()
    expect(next.cities[3]!.lordId).toBe(1)
    expect(next.officers[4]!.cityId).toBe(3) // 进驻新城，未回江陵
    expect(isBusy(next, 4)).toBe(false)
    expect(isCaptive(next, 6)).toBe(true)
    // 曹操被俘 → 自动立新君接管邺城（具体人选取决于败军逃跑后的候选，故只验证已换主、新君归属自身）
    expect(next.cities[4]!.lordId).not.toBe(6)
    const newLord = next.cities[4]!.lordId
    expect(newLord).not.toBeNull()
    if (newLord === null) throw new Error('expected successor')
    expect(next.officers[newLord]!.lordId).toBe(newLord)
    expect(next.pendingCommands).toEqual([])
    expect(next.month).toBe(2)
  })

  it('resumeMonth：战斗玩家败→不占城、败方武将走命运判定，仍续完月末', () => {
    const boosted = withOfficer(createInitialState(1), 4, { troops: 500 })
    const suspended = endMonth(campaign(boosted, [4, 5], 3, 120).state, cfg)
    const lost: GameState = {
      ...suspended,
      activeBattle: { ...(suspended.activeBattle as BattleState), outcome: 'playerLose' },
    }
    const next = resumeMonth(lost, cfg).state

    expect(next.activeBattle).toBeNull()
    expect(next.cities[3]!.lordId).toBe(6) // 败，未占城
    expect(next.officers[4]!.lordId).toBe(1) // 归属不变（被俘/逃跑均不改 lordId）
    expect(next.pendingCommands).toEqual([])
    expect(next.month).toBe(2)
  })

  it('resumeMonth：玩家君主随军被俘→挂起待选新君；chooseSuccessor 兑现换主并续完月末', () => {
    // 刘备(智力设0→必被俘)单独从江陵出征许昌、战败
    const s = withOfficer(createInitialState(1), 1, { cityId: 2, intelligence: 0 })
    const suspended = endMonth(campaign(s, [1], 3, 50).state, cfg)
    const lost: GameState = {
      ...suspended,
      activeBattle: { ...(suspended.activeBattle as BattleState), outcome: 'playerLose' },
    }
    const paused = resumeMonth(lost, cfg).state

    expect(paused.pendingSuccession).toEqual({ lordId: 1 })
    expect(paused.month).toBe(1) // 挂起、未推进
    expect(paused.activeBattle).toBeNull()
    expect(isCaptive(paused, 1)).toBe(true)

    const done = chooseSuccessor(paused, 4, cfg).state // 玩家选关羽为新君
    expect(done.pendingSuccession).toBeNull()
    expect(done.playerLordId).toBe(4)
    expect(done.cities[2]!.lordId).toBe(4)
    expect(done.officers[4]!.lordId).toBe(4)
    expect(done.month).toBe(2) // 续完月末
  })

  it('挂起战斗确定性可复现', () => {
    const boosted = withOfficer(createInitialState(1), 4, { troops: 500 })
    const run = () => endMonth(campaign(boosted, [4, 5], 3, 120).state, cfg)
    expect(run()).toEqual(run())
  })
})

function withCity(
  s: GameState,
  id: number,
  patch: Partial<GameState['cities'][number]>
): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}

describe('endMonth 灾害（月末最后一步）', () => {
  it('灾害在登场之后：先收粮再灾害——饥荒城借当月收粮翻身后恢复正常', () => {
    // 6 月收粮：成都农业 300 → 收粮 floor(300/4)=75。饥荒不碰粮，收粮后粮>0 → 恢复正常。
    const s = withCity({ ...createInitialState(1), month: 6 }, 1, {
      status: 'famine',
      food: 0,
    })
    const next = endMonth(s, cfg)
    expect(next.cities[1]!.food).toBeGreaterThan(0)
    expect(next.cities[1]!.status).toBe('normal')
  })

  it('异常城月末按破坏表受损（防灾=0 不恢复，旱灾粮 -5%）', () => {
    // 非结算月（1月），仅看破坏：旱灾粮食 floor(food×0.95)
    const s = withCity(createInitialState(1), 1, {
      status: 'drought',
      disasterPrevention: 0,
      food: 400,
    })
    const next = endMonth(s, cfg)
    expect(next.cities[1]!.status).toBe('drought')
    expect(next.cities[1]!.food).toBe(Math.floor(400 * 0.95))
  })

  it('全城防灾=100 时收粮/收税不被灾害扰动（日历不回归）', () => {
    let s: GameState = {
      ...createInitialState(1),
      month: 6,
      cities: Object.fromEntries(
        Object.entries(createInitialState(1).cities).map(([id, c]) => [
          id,
          { ...c, disasterPrevention: 100 },
        ])
      ),
    }
    const before = s.cities[1]!
    s = endMonth(s, cfg)
    expect(s.cities[1]!.food).toBe(before.food + Math.floor(before.agriculture / 4))
    expect(s.cities[1]!.gold).toBe(before.gold + Math.floor(before.commerce / 2))
    expect(s.cities[1]!.status).toBe('normal')
  })
})

// --- 16-ai-campaign：出征三类分流 + 玩家防守选守军 ---

function enqueue(s: GameState, cmd: PendingCommand): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, cmd] }
}
/** 把某城及其武将整体改归一个自立君主（造独立 AI 势力）。 */
function makeIndependentLord(
  s: GameState,
  cityId: number,
  lord: number,
  members: number[]
): GameState {
  let next: GameState = {
    ...s,
    cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId: lord } },
  }
  for (const id of members) next = withOfficer(next, id, { lordId: lord })
  return next
}

describe('advanceCampaigns 三类分流', () => {
  it('无守军城（玩家进攻空敌城）→ 直接占城、不进战斗、续跑到月末', () => {
    // 把邺城守军移走 → 邺城无守军；江陵关羽出征邺城。
    let s = withOfficer(createInitialState(1), 9, { cityId: 3 })
    s = withOfficer(s, 10, { cityId: 3 })
    s = enqueue(s, { type: 'campaign', officerIds: [4], targetCityId: 4, provisions: 50 })
    const out = advanceCampaigns(s, cfg).state
    expect(out.cities[4]!.lordId).toBe(1) // 直接占城
    expect(out.activeBattle).toBeNull()
    expect(out.pendingDefense).toBeNull()
    expect(out.month).toBe(2) // 走到月末尾段
    expect(out.pendingCommands).toEqual([])
  })

  it('玩家进攻有守军敌城 → 挂起交互式战斗（attack 模式），月份不推进', () => {
    const s = enqueue(createInitialState(1), {
      type: 'campaign',
      officerIds: [4],
      targetCityId: 3,
      provisions: 50,
    })
    const out = advanceCampaigns(s, cfg).state
    expect(out.activeBattle).not.toBeNull()
    expect(out.activeBattle!.mode).toBe('attack')
    expect(out.month).toBe(1)
  })

  it('AI 进攻有守军玩家城 → 挂起 pendingDefense，月份不推进、不进战斗', () => {
    const s = enqueue(createInitialState(1), {
      type: 'campaign',
      officerIds: [6],
      targetCityId: 2,
      provisions: 50,
    })
    const out = advanceCampaigns(s, cfg).state
    expect(out.pendingDefense).toEqual({ targetCityId: 2 })
    expect(out.activeBattle).toBeNull()
    expect(out.month).toBe(1)
  })

  it('AI vs AI 有守军 → 速算（不暂停、不进地图战），续跑到月末', () => {
    // 邺城自立为简懿势力；曹操(许昌)出征邺城 = AI vs AI。
    let s = makeIndependentLord(createInitialState(7), 4, 9, [9, 10])
    s = withOfficer(s, 6, { troops: 8000 })
    s = enqueue(s, { type: 'campaign', officerIds: [6], targetCityId: 4, provisions: 40 })
    const out = advanceCampaigns(s, cfg).state
    expect(out.activeBattle).toBeNull()
    expect(out.pendingDefense).toBeNull()
    expect(out.pendingSuccession).toBeNull()
    expect(out.pendingCommands.some((c) => c.type === 'campaign')).toBe(false)
    expect(out.month).toBe(2)
  })
})

describe('chooseDefenders 玩家防守选守军', () => {
  function pending(): GameState {
    const s = enqueue(createInitialState(1), {
      type: 'campaign',
      officerIds: [6],
      targetCityId: 2,
      provisions: 50,
    })
    return advanceCampaigns(s, cfg).state // 挂起 pendingDefense
  }

  it('选 ≥1 守军 → 进 defend 交互式战斗、清空 pendingDefense', () => {
    const out = chooseDefenders(pending(), [4], cfg).state
    expect(out.pendingDefense).toBeNull()
    expect(out.activeBattle).not.toBeNull()
    expect(out.activeBattle!.mode).toBe('defend')
    expect(out.activeBattle!.units[4]).toBeTruthy()
  })

  it('选 0 名（弃守）→ 直接被占、续跑到月末', () => {
    const out = chooseDefenders(pending(), [], cfg).state
    expect(out.cities[2]!.lordId).toBe(6)
    expect(out.pendingDefense).toBeNull()
    expect(out.activeBattle).toBeNull()
    expect(out.month).toBe(2)
  })

  it('canChooseDefenders：无 pendingDefense / 越界 / 非该城武将 → 拒；合法子集 → 通过', () => {
    const base = createInitialState(1)
    expect(canChooseDefenders(base, [4]).ok).toBe(false) // 无 pendingDefense
    const pd = pending()
    expect(canChooseDefenders(pd, [4, 4]).ok).toBe(false) // 重复
    expect(canChooseDefenders(pd, [6]).ok).toBe(false) // 非江陵守军
    expect(canChooseDefenders(pd, [4, 5]).ok).toBe(true)
    expect(canChooseDefenders(pd, []).ok).toBe(true) // 弃守合法
    expect(chooseDefenders(pd, [6], cfg).state).toEqual(pd) // 非法 no-op
  })

  it('pendingDefense 非空时 endMonth 拒推进', () => {
    const pd = pending()
    expect(endMonth(pd, cfg)).toEqual(pd)
  })
})
