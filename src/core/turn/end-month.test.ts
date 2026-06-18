import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import { develop } from '../economy/develop'
import { plunder } from '../economy/plunder'
import { campaign } from '../economy/campaign'
import { isCaptive } from '../world/queries'
import type { GameState } from '../game-state'
import type { BattleState } from '../military/battle'
import { endMonth, resumeMonth, chooseSuccessor } from './end-month'

const cfg = DEFAULT_CONFIG

function withOfficer(
  s: GameState,
  id: string,
  patch: Partial<GameState['officers'][string]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

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
    const afterCmd = develop(createInitialState(1), 'zhugeliang', 'agriculture', cfg)
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

  it('掠夺先于收粮/收税：收粮月按减半后的农业/商业结算，队列清空、执行人回城', () => {
    // 6 月（收粮+收税）：先掠夺成都（农 300->150、商 200->100），收益粮+750/金+300，再按减半后收粮 floor(150/4)=37、收税 floor(100/2)=50
    const queued = plunder({ ...createInitialState(1), month: 6 }, 'zhugeliang', cfg)
    const next = endMonth(queued, cfg)
    const c = next.cities.chengdu!
    expect(c.agriculture).toBe(150)
    expect(c.commerce).toBe(100)
    expect(c.loyalty).toBe(25)
    expect(c.food).toBe(400 + 750 + 37)
    expect(c.gold).toBe(500 + 300 + 50)
    expect(next.pendingCommands).toEqual([])
    expect(next.officers.zhugeliang!.busy).toBe(false)
  })

  it('玩家出征：endMonth 挂起为交互式战斗，不立即占城/不推进月份', () => {
    const boosted = withOfficer(createInitialState(1), 'guanyu', { troops: 500 })
    const queued = campaign(boosted, ['guanyu', 'zhangfei'], 'xuchang', 120)
    const next = endMonth(queued, cfg)

    expect(next.activeBattle).not.toBeNull()
    expect(next.activeBattle!.mode).toBe('attack')
    expect(next.cities.xuchang!.lordId).toBe('caocao') // 尚未结算
    expect(next.month).toBe(1) // 月末挂起，未推进
    expect(next.pendingCommands).toHaveLength(1) // campaign 留队待续战
  })

  it('resumeMonth：战斗玩家胜→占城 + 被俘君主重选 + 续完月末（进驻、busy=false、月份+1、队列清空）', () => {
    let boosted = withOfficer(createInitialState(1), 'guanyu', { troops: 500 })
    boosted = withOfficer(boosted, 'caocao', { intelligence: 0 }) // 战败必被俘（barring r1==0）
    const suspended = endMonth(campaign(boosted, ['guanyu', 'zhangfei'], 'xuchang', 120), cfg)
    const won: GameState = {
      ...suspended,
      activeBattle: { ...(suspended.activeBattle as BattleState), outcome: 'playerWin' },
    }
    const next = resumeMonth(won, cfg)

    expect(next.activeBattle).toBeNull()
    expect(next.cities.xuchang!.lordId).toBe('liubei')
    expect(next.officers.guanyu!.cityId).toBe('xuchang') // 进驻新城，未回江陵
    expect(next.officers.guanyu!.busy).toBe(false)
    expect(isCaptive(next, 'caocao')).toBe(true)
    // 曹操被俘 → 自动立新君接管邺城（具体人选取决于败军逃跑后的候选，故只验证已换主、新君归属自身）
    expect(next.cities.ye!.lordId).not.toBe('caocao')
    const newLord = next.cities.ye!.lordId
    expect(next.officers[newLord]!.lordId).toBe(newLord)
    expect(next.pendingCommands).toEqual([])
    expect(next.month).toBe(2)
  })

  it('resumeMonth：战斗玩家败→不占城、败方武将走命运判定，仍续完月末', () => {
    const boosted = withOfficer(createInitialState(1), 'guanyu', { troops: 500 })
    const suspended = endMonth(campaign(boosted, ['guanyu', 'zhangfei'], 'xuchang', 120), cfg)
    const lost: GameState = {
      ...suspended,
      activeBattle: { ...(suspended.activeBattle as BattleState), outcome: 'playerLose' },
    }
    const next = resumeMonth(lost, cfg)

    expect(next.activeBattle).toBeNull()
    expect(next.cities.xuchang!.lordId).toBe('caocao') // 败，未占城
    expect(next.officers.guanyu!.lordId).toBe('liubei') // 归属不变（被俘/逃跑均不改 lordId）
    expect(next.pendingCommands).toEqual([])
    expect(next.month).toBe(2)
  })

  it('resumeMonth：玩家君主随军被俘→挂起待选新君；chooseSuccessor 兑现换主并续完月末', () => {
    // 刘备(智力设0→必被俘)单独从江陵出征许昌、战败
    const s = withOfficer(createInitialState(1), 'liubei', { cityId: 'jiangling', intelligence: 0 })
    const suspended = endMonth(campaign(s, ['liubei'], 'xuchang', 50), cfg)
    const lost: GameState = {
      ...suspended,
      activeBattle: { ...(suspended.activeBattle as BattleState), outcome: 'playerLose' },
    }
    const paused = resumeMonth(lost, cfg)

    expect(paused.pendingSuccession).toEqual({ lordId: 'liubei' })
    expect(paused.month).toBe(1) // 挂起、未推进
    expect(paused.activeBattle).toBeNull()
    expect(isCaptive(paused, 'liubei')).toBe(true)

    const done = chooseSuccessor(paused, 'guanyu', cfg) // 玩家选关羽为新君
    expect(done.pendingSuccession).toBeNull()
    expect(done.playerLordId).toBe('guanyu')
    expect(done.cities.jiangling!.lordId).toBe('guanyu')
    expect(done.officers.guanyu!.lordId).toBe('guanyu')
    expect(done.month).toBe(2) // 续完月末
  })

  it('挂起战斗确定性可复现', () => {
    const boosted = withOfficer(createInitialState(1), 'guanyu', { troops: 500 })
    const run = () => endMonth(campaign(boosted, ['guanyu', 'zhangfei'], 'xuchang', 120), cfg)
    expect(run()).toEqual(run())
  })
})

function withCity(
  s: GameState,
  id: string,
  patch: Partial<GameState['cities'][string]>
): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}

describe('endMonth 灾害（月末最后一步）', () => {
  it('灾害在登场之后：先收粮再灾害——饥荒城借当月收粮翻身后恢复正常', () => {
    // 6 月收粮：成都农业 300 → 收粮 floor(300/4)=75。饥荒不碰粮，收粮后粮>0 → 恢复正常。
    const s = withCity({ ...createInitialState(1), month: 6 }, 'chengdu', {
      status: 'famine',
      food: 0,
    })
    const next = endMonth(s, cfg)
    expect(next.cities.chengdu!.food).toBeGreaterThan(0)
    expect(next.cities.chengdu!.status).toBe('normal')
  })

  it('异常城月末按破坏表受损（防灾=0 不恢复，旱灾粮 -5%）', () => {
    // 非结算月（1月），仅看破坏：旱灾粮食 floor(food×0.95)
    const s = withCity(createInitialState(1), 'chengdu', {
      status: 'drought',
      disasterPrevention: 0,
      food: 400,
    })
    const next = endMonth(s, cfg)
    expect(next.cities.chengdu!.status).toBe('drought')
    expect(next.cities.chengdu!.food).toBe(Math.floor(400 * 0.95))
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
    const before = s.cities.chengdu!
    s = endMonth(s, cfg)
    expect(s.cities.chengdu!.food).toBe(before.food + Math.floor(before.agriculture / 4))
    expect(s.cities.chengdu!.gold).toBe(before.gold + Math.floor(before.commerce / 2))
    expect(s.cities.chengdu!.status).toBe('normal')
  })
})
