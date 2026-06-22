import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { DEFAULT_CONFIG } from '../shared/config'
import { endMonth } from '../turn/end-month'
import { runAiBottomLine, runAiLevelUp, pickStrategy, aiTakeTurn } from './ai'

function withCity(
  s: GameState,
  id: number,
  patch: Partial<GameState['cities'][number]>
): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}

// 玩家=刘备(chengdu/jiangling)；AI=曹操(xuchang/ye)
describe('runAiBottomLine 5.3 兜底', () => {
  it('AI 城状态强制正常、防灾 +1 封顶、粮<100 补到 500', () => {
    let s = createInitialState(1)
    s = withCity(s, 3, {
      status: 'drought',
      disasterPrevention: 50,
      food: 50,
    })
    const next = runAiBottomLine(s)
    expect(next.cities[3]!.status).toBe('normal')
    expect(next.cities[3]!.disasterPrevention).toBe(51)
    expect(next.cities[3]!.food).toBe(500)
  })

  it('防灾封顶 100；粮 >= 100 不动', () => {
    let s = createInitialState(1)
    s = withCity(s, 4, { disasterPrevention: 100, food: 350 })
    const next = runAiBottomLine(s)
    expect(next.cities[4]!.disasterPrevention).toBe(100)
    expect(next.cities[4]!.food).toBe(350)
  })

  it('玩家城完全不变', () => {
    let s = createInitialState(1)
    s = withCity(s, 1, { status: 'flood', disasterPrevention: 50, food: 10 })
    const next = runAiBottomLine(s)
    expect(next.cities[1]!.status).toBe('flood')
    expect(next.cities[1]!.disasterPrevention).toBe(50)
    expect(next.cities[1]!.food).toBe(10)
  })

  it('不消耗 RNG', () => {
    const s = createInitialState(1)
    expect(runAiBottomLine(s).rng.seed).toBe(s.rng.seed)
  })

  it('空城不执行兜底', () => {
    const s = withCity(createInitialState(1), 3, {
      lordId: null,
      status: 'drought',
      disasterPrevention: 50,
      food: 50,
    })
    expect(runAiBottomLine(s).cities[3]).toEqual(s.cities[3])
  })
})

function withOfficer(
  s: GameState,
  id: number,
  patch: Partial<GameState['officers'][number]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

describe('runAiLevelUp 5.4 自动升级', () => {
  it('rate=0 时无任何升级且不动 RNG', () => {
    const s = createInitialState(1)
    const next = runAiLevelUp(s, { ...DEFAULT_CONFIG, aiLevelUpRate: 0 })
    expect(next).toBe(s)
  })

  it('rate=100 时所有 AI 非俘虏武将 +1 级，玩家武将永不升', () => {
    const s = createInitialState(1)
    const next = runAiLevelUp(s, { ...DEFAULT_CONFIG, aiLevelUpRate: 100 })
    // AI 方（曹操）：xunyu/guojia/caocao/simayi/zhangliao
    expect(next.officers[6]!.level).toBe(2)
    expect(next.officers[7]!.level).toBe(2)
    expect(next.officers[9]!.level).toBe(2)
    // 玩家方（刘备）不变
    expect(next.officers[1]!.level).toBe(1)
    expect(next.officers[2]!.level).toBe(1)
    expect(next.officers[4]!.level).toBe(1)
  })

  it('俘虏不升级（AI 武将身处玩家城）', () => {
    // simayi(曹操) 落到玩家城 chengdu → 派生俘虏
    const s = withOfficer(createInitialState(1), 9, { cityId: 1 })
    const next = runAiLevelUp(s, { ...DEFAULT_CONFIG, aiLevelUpRate: 100 })
    expect(next.officers[9]!.level).toBe(1)
  })

  it('相同 seed 结果固定（确定性）', () => {
    const cfg = { ...DEFAULT_CONFIG, aiLevelUpRate: 50 }
    const a = runAiLevelUp(createInitialState(7), cfg)
    const b = runAiLevelUp(createInitialState(7), cfg)
    expect(a.rng.seed).toBe(b.rng.seed)
    for (const id of Object.keys(a.officers).map(Number)) {
      expect(a.officers[id]!.level).toBe(b.officers[id]!.level)
    }
  })
})

describe('pickStrategy 5.2 按君主性格三分', () => {
  it('和平(0)：内政 50 / 外交 80', () => {
    expect(pickStrategy(0, 49)).toBe('internal')
    expect(pickStrategy(0, 50)).toBe('diplomacy')
    expect(pickStrategy(0, 79)).toBe('diplomacy')
    expect(pickStrategy(0, 80)).toBe('military')
  })
  it('奸诈(2)：内政 30 / 外交 70', () => {
    expect(pickStrategy(2, 29)).toBe('internal')
    expect(pickStrategy(2, 30)).toBe('diplomacy')
    expect(pickStrategy(2, 69)).toBe('diplomacy')
    expect(pickStrategy(2, 70)).toBe('military')
  })
  it('冒进(4)：内政 10 / 外交 20', () => {
    expect(pickStrategy(4, 9)).toBe('internal')
    expect(pickStrategy(4, 10)).toBe('diplomacy')
    expect(pickStrategy(4, 19)).toBe('diplomacy')
    expect(pickStrategy(4, 20)).toBe('military')
  })
})

describe('aiTakeTurn 编排 / 玩家不受扰', () => {
  it('不触碰任何玩家城与玩家武将（无俘虏局面）', () => {
    const s = createInitialState(3)
    const out = aiTakeTurn(s, DEFAULT_CONFIG)
    for (const c of Object.values(s.cities)) {
      if (c.lordId === s.playerLordId) expect(out.cities[c.id]).toEqual(c)
    }
    for (const o of Object.values(s.officers)) {
      if (o.lordId === s.playerLordId) expect(out.officers[o.id]).toEqual(o)
    }
  })

  it('AI 城兜底已生效（防灾较起始 +1）', () => {
    const s = createInitialState(3)
    const out = aiTakeTurn(s, DEFAULT_CONFIG)
    // 兜底对每座 AI 城防灾 +1（治理可能再 +4，但至少 +1）
    expect(out.cities[3]!.disasterPrevention).toBeGreaterThanOrEqual(
      s.cities[3]!.disasterPrevention + 1
    )
  })

  it('新增 pendingCommands 均由 AI 武将发起', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = createInitialState(seed)
      const out = aiTakeTurn(s, DEFAULT_CONFIG)
      for (const cmd of out.pendingCommands) {
        const ownerId = 'officerId' in cmd ? cmd.officerId : cmd.officerIds[0]!
        expect(out.officers[ownerId]!.lordId).not.toBe(s.playerLordId)
      }
      expect(out.pendingCommands.some((c) => c.type === 'campaign')).toBe(false)
    }
  })

  it('确定性：相同 seed 两次一致', () => {
    const s = createInitialState(11)
    expect(aiTakeTurn(s, DEFAULT_CONFIG)).toEqual(aiTakeTurn(s, DEFAULT_CONFIG))
  })

  it('只有玩家城与空城时不为地图空位消费策略 RNG', () => {
    let s = withCity(createInitialState(11), 3, { lordId: null })
    s = withCity(s, 4, { lordId: null })
    const result = aiTakeTurn(s, { ...DEFAULT_CONFIG, aiLevelUpRate: 0 })
    expect(result.rng).toEqual(s.rng)
    expect(result.cities[3]).toEqual(s.cities[3])
    expect(result.cities[4]).toEqual(s.cities[4])
  })
})

describe('endMonth 集成（AI 经营接入月末）', () => {
  it('一次推进：月份 +1、无战斗挂起、确定性', () => {
    const s = createInitialState(4)
    const out = endMonth(s, DEFAULT_CONFIG)
    expect(out.month).toBe(2)
    expect(out.activeBattle).toBeNull()
    expect(out.pendingSuccession).toBeNull()
    expect(endMonth(s, DEFAULT_CONFIG)).toEqual(out)
  })

  it('AI 启用自动升级时仍能跑通月末', () => {
    const s = createInitialState(4)
    const out = endMonth(s, { ...DEFAULT_CONFIG, aiLevelUpRate: 50 })
    expect(out.month).toBe(2)
  })

  it('AI 出征玩家城：endMonth 全链（aiTakeTurn→pending→分流）挂起 pendingDefense', () => {
    // 预置一条 AI 出征（曹操→江陵）；它在队列首位，月末分流必先处理它。
    const s: GameState = {
      ...createInitialState(4),
      pendingCommands: [{ type: 'campaign', officerIds: [6], targetCityId: 2, provisions: 50 }],
    }
    const out = endMonth(s, DEFAULT_CONFIG)
    expect(out.pendingDefense).toEqual({ targetCityId: 2 })
    expect(out.activeBattle).toBeNull()
    expect(out.month).toBe(1) // 暂停、未推进
    expect(endMonth(s, DEFAULT_CONFIG)).toEqual(out) // 确定性
  })

  it('campaign-capable 地图整月可复现（同 seed 两次一致、不抛错）', () => {
    // 邺城自立为简懿势力（与曹操许昌相邻）→ 存在 AI vs AI 出征可能。
    for (let seed = 1; seed <= 60; seed++) {
      let s = withCity(createInitialState(seed), 4, { lordId: 9 })
      s = {
        ...s,
        officers: {
          ...s.officers,
          9: { ...s.officers[9]!, lordId: 9, troops: 1500 },
          10: { ...s.officers[10]!, lordId: 9, troops: 1200 },
        },
      }
      const out = endMonth(s, DEFAULT_CONFIG)
      expect(endMonth(s, DEFAULT_CONFIG)).toEqual(out)
      // 未挂起则月份必推进；挂起（玩家防守/选新君）则停在本月。
      const paused = out.pendingDefense || out.pendingSuccession || out.activeBattle
      expect(out.month).toBe(paused ? 1 : 2)
    }
  })
})
