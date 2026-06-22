import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { isCaptive } from '../world/queries'
import { resolveCampaignOutcome, type CampaignOutcome } from './aftermath'

function withOfficer(
  s: GameState,
  id: number,
  patch: Partial<GameState['officers'][number]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}
function withCity(
  s: GameState,
  id: number,
  patch: Partial<GameState['cities'][number]>
): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}

// 默认：江陵关羽张飞 攻 许昌(曹操90,荀彧95,郭嘉98)。
function outcome(over: Partial<CampaignOutcome> = {}): CampaignOutcome {
  return {
    attackerWins: true,
    attackerLord: 1,
    targetCityId: 3,
    attackerIds: [4, 5],
    defenderIds: [6, 7, 8],
    mergedFood: 200,
    ...over,
  }
}

describe('resolveCampaignOutcome 攻方胜：占城 + 战损 + 覆盖粮草 + 胜方回城', () => {
  const next = resolveCampaignOutcome(createInitialState(1), outcome()).state
  it('占城：许昌归攻方君主', () => {
    expect(next.cities[3]!.lordId).toBe(1)
  })
  it('粮草覆盖式合并（=mergedFood，非累加）', () => {
    expect(next.cities[3]!.food).toBe(200)
  })
  it('无条件战损：农/商/金 -5%、民忠 -10%', () => {
    expect(next.cities[3]!.agriculture).toBe(Math.floor(350 * 0.95))
    expect(next.cities[3]!.commerce).toBe(Math.floor(320 * 0.95))
    expect(next.cities[3]!.gold).toBe(Math.floor(600 * 0.95))
    expect(next.cities[3]!.loyalty).toBe(Math.floor(50 * 0.9))
  })
  it('胜方参战武将进驻目标城', () => {
    expect(next.officers[4]!.cityId).toBe(3)
    expect(next.officers[5]!.cityId).toBe(3)
  })
})

describe('resolveCampaignOutcome 败军逐人命运', () => {
  it('逃跑（高智力→过第一关、势力有存活城）：随机落该势力其余城、保留兵、非俘虏', () => {
    const s = withOfficer(createInitialState(1), 7, { intelligence: 100 })
    const next = resolveCampaignOutcome(s, outcome({ defenderIds: [7] })).state
    expect(next.officers[7]!.cityId).toBe(4) // 占许昌后 caocao 仅余邺城
    expect(next.officers[7]!.troops).toBe(100)
    expect(isCaptive(next, 7)).toBe(false)
  })

  it('被俘（势力无存活城、逃跑失败且非战死）：进目标城、兵清零、成俘虏', () => {
    const s = withCity(createInitialState(1), 4, { lordId: 1 }) // caocao 仅余许昌
    const next = resolveCampaignOutcome(s, outcome({ defenderIds: [7] })).state
    expect(next.officers[7]!.cityId).toBe(3)
    expect(next.officers[7]!.troops).toBe(0)
    expect(isCaptive(next, 7)).toBe(true)
  })

  it('战死（逃跑失败 + RandInt===0）：道具入目标城且已发现、officer 永久删除', () => {
    let s = withCity(createInitialState(194), 4, { lordId: 1 })
    s = withOfficer(s, 7, { intelligence: 50 })
    s = {
      ...s,
      items: {
        ...s.items,
        100: {
          id: 100,
          name: '剑',
          forceBonus: 5,
          intelBonus: 0,
          movementBonus: 0,
          troopTypeOverride: 0,
          holder: { kind: 'officer', officerId: 7, equipSeq: 0 } as const,
          discovered: false,
          appearanceConditions: { birth: 0, recruiterId: null, cityId: null },
        },
      },
    }
    const next = resolveCampaignOutcome(s, outcome({ defenderIds: [7] })).state
    expect(next.officers[7]).toBeUndefined()
    expect(next.items[100]!.holder).toEqual({ kind: 'city', cityId: 3 })
    expect(next.items[100]!.discovered).toBe(true)
  })
})

describe('resolveCampaignOutcome 君主遭劫', () => {
  it('AI 君主被俘 → 自动立新君（邺城归司马懿、忠诚 100）', () => {
    const s = withOfficer(createInitialState(1), 6, { intelligence: 0 }) // r1=67>0 → 直接被俘
    const next = resolveCampaignOutcome(s, outcome({ defenderIds: [6] })).state
    expect(isCaptive(next, 6)).toBe(true)
    expect(next.cities[4]!.lordId).toBe(9)
    expect(next.officers[9]!.lordId).toBe(9)
    expect(next.officers[9]!.loyalty).toBe(100)
    expect(next.pendingSuccession).toBeNull()
  })

  it('玩家君主被俘 → 挂起 pendingSuccession、不换主、不灭亡', () => {
    const s = withOfficer(createInitialState(1), 1, { intelligence: 0, cityId: 2 })
    const next = resolveCampaignOutcome(
      s,
      outcome({
        attackerWins: false,
        attackerLord: 1,
        attackerIds: [1],
        defenderIds: [6],
      })
    ).state
    expect(next.pendingSuccession).toEqual({ lordId: 1 })
    expect(isCaptive(next, 1)).toBe(true)
    expect(next.officers[1]!.cityId).toBe(3)
    expect(next.cities[1]!.lordId).toBe(1) // 未换主
  })
})

describe('resolveCampaignOutcome 事件', () => {
  it('AI 君主遭劫 → lord-stricken + lord-succeeded', () => {
    const s = withOfficer(createInitialState(1), 6, { intelligence: 0 })
    const { events } = resolveCampaignOutcome(s, outcome({ defenderIds: [6] }))
    expect(events).toContainEqual({ kind: 'lord-stricken', lordId: 6 })
    expect(events).toContainEqual({
      kind: 'lord-succeeded',
      oldLordId: 6,
      newLordId: 9,
    })
  })

  it('玩家君主遭劫 → lord-stricken + succession-pending', () => {
    const s = withOfficer(createInitialState(1), 1, { intelligence: 0, cityId: 2 })
    const { events } = resolveCampaignOutcome(
      s,
      outcome({
        attackerWins: false,
        attackerLord: 1,
        attackerIds: [1],
        defenderIds: [6],
      })
    )
    expect(events).toContainEqual({ kind: 'lord-stricken', lordId: 1 })
    expect(events).toContainEqual({ kind: 'succession-pending', lordId: 1 })
  })

  it('君主遭劫且势力无城/无候选 → lord-eliminated', () => {
    // 让 caocao 仅余许昌（被占）、且邺城归刘备，则 caocao 占城后无城 → 灭亡。
    const s = withCity(createInitialState(1), 4, { lordId: 1 })
    const { events } = resolveCampaignOutcome(s, outcome({ defenderIds: [6] }))
    expect(events).toContainEqual({ kind: 'lord-stricken', lordId: 6 })
    expect(events).toContainEqual({ kind: 'lord-eliminated', lordId: 6 })
  })
})
