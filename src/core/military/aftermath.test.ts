import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { isCaptive } from '../world/queries'
import { resolveCampaignOutcome, type CampaignOutcome } from './aftermath'

function withOfficer(
  s: GameState,
  id: string,
  patch: Partial<GameState['officers'][string]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}
function withCity(
  s: GameState,
  id: string,
  patch: Partial<GameState['cities'][string]>
): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}

// 默认：江陵关羽张飞 攻 许昌(曹操90,荀彧95,郭嘉98)。
function outcome(over: Partial<CampaignOutcome> = {}): CampaignOutcome {
  return {
    attackerWins: true,
    attackerLord: 'liubei',
    targetCityId: 'xuchang',
    attackerIds: ['guanyu', 'zhangfei'],
    defenderIds: ['caocao', 'xunyu', 'guojia'],
    mergedFood: 200,
    ...over,
  }
}

describe('resolveCampaignOutcome 攻方胜：占城 + 战损 + 覆盖粮草 + 胜方回城', () => {
  const next = resolveCampaignOutcome(createInitialState(1), outcome()).state
  it('占城：许昌归攻方君主', () => {
    expect(next.cities.xuchang!.lordId).toBe('liubei')
  })
  it('粮草覆盖式合并（=mergedFood，非累加）', () => {
    expect(next.cities.xuchang!.food).toBe(200)
  })
  it('无条件战损：农/商/金 -5%、民忠 -10%', () => {
    expect(next.cities.xuchang!.agriculture).toBe(Math.floor(350 * 0.95))
    expect(next.cities.xuchang!.commerce).toBe(Math.floor(320 * 0.95))
    expect(next.cities.xuchang!.gold).toBe(Math.floor(600 * 0.95))
    expect(next.cities.xuchang!.loyalty).toBe(Math.floor(50 * 0.9))
  })
  it('胜方参战武将进驻目标城', () => {
    expect(next.officers.guanyu!.cityId).toBe('xuchang')
    expect(next.officers.zhangfei!.cityId).toBe('xuchang')
  })
})

describe('resolveCampaignOutcome 败军逐人命运', () => {
  it('逃跑（高智力→过第一关、势力有存活城）：随机落该势力其余城、保留兵、非俘虏', () => {
    const s = withOfficer(createInitialState(1), 'xunyu', { intelligence: 100 })
    const next = resolveCampaignOutcome(s, outcome({ defenderIds: ['xunyu'] })).state
    expect(next.officers.xunyu!.cityId).toBe('ye') // 占许昌后 caocao 仅余邺城
    expect(next.officers.xunyu!.troops).toBe(100)
    expect(isCaptive(next, 'xunyu')).toBe(false)
  })

  it('被俘（势力无存活城、逃跑失败且非战死）：进目标城、兵清零、成俘虏', () => {
    const s = withCity(createInitialState(1), 'ye', { lordId: 'liubei' }) // caocao 仅余许昌
    const next = resolveCampaignOutcome(s, outcome({ defenderIds: ['xunyu'] })).state
    expect(next.officers.xunyu!.cityId).toBe('xuchang')
    expect(next.officers.xunyu!.troops).toBe(0)
    expect(isCaptive(next, 'xunyu')).toBe(true)
  })

  it('战死（逃跑失败 + RandInt===0）：道具入目标城且已发现、officer 永久删除', () => {
    let s = withCity(createInitialState(194), 'ye', { lordId: 'liubei' })
    s = withOfficer(s, 'xunyu', { intelligence: 50 })
    s = {
      ...s,
      items: {
        ...s.items,
        sword: {
          id: 'sword',
          name: '剑',
          forceBonus: 5,
          intelBonus: 0,
          movementBonus: 0,
          troopTypeOverride: 0,
          holder: { kind: 'officer', officerId: 'xunyu', equipSeq: 0 } as const,
          discovered: false,
          recruiterId: null,
        },
      },
    }
    const next = resolveCampaignOutcome(s, outcome({ defenderIds: ['xunyu'] })).state
    expect(next.officers.xunyu).toBeUndefined()
    expect(next.items.sword!.holder).toEqual({ kind: 'city', cityId: 'xuchang' })
    expect(next.items.sword!.discovered).toBe(true)
  })
})

describe('resolveCampaignOutcome 君主遭劫', () => {
  it('AI 君主被俘 → 自动立新君（邺城归司马懿、忠诚 100）', () => {
    const s = withOfficer(createInitialState(1), 'caocao', { intelligence: 0 }) // r1=67>0 → 直接被俘
    const next = resolveCampaignOutcome(s, outcome({ defenderIds: ['caocao'] })).state
    expect(isCaptive(next, 'caocao')).toBe(true)
    expect(next.cities.ye!.lordId).toBe('simayi')
    expect(next.officers.simayi!.lordId).toBe('simayi')
    expect(next.officers.simayi!.loyalty).toBe(100)
    expect(next.pendingSuccession).toBeNull()
  })

  it('玩家君主被俘 → 挂起 pendingSuccession、不换主、不灭亡', () => {
    const s = withOfficer(createInitialState(1), 'liubei', { intelligence: 0, cityId: 'jiangling' })
    const next = resolveCampaignOutcome(
      s,
      outcome({
        attackerWins: false,
        attackerLord: 'liubei',
        attackerIds: ['liubei'],
        defenderIds: ['caocao'],
      })
    ).state
    expect(next.pendingSuccession).toEqual({ lordId: 'liubei' })
    expect(isCaptive(next, 'liubei')).toBe(true)
    expect(next.officers.liubei!.cityId).toBe('xuchang')
    expect(next.cities.chengdu!.lordId).toBe('liubei') // 未换主
  })
})

describe('resolveCampaignOutcome 事件', () => {
  it('AI 君主遭劫 → lord-stricken + lord-succeeded', () => {
    const s = withOfficer(createInitialState(1), 'caocao', { intelligence: 0 })
    const { events } = resolveCampaignOutcome(s, outcome({ defenderIds: ['caocao'] }))
    expect(events).toContainEqual({ kind: 'lord-stricken', lordId: 'caocao' })
    expect(events).toContainEqual({
      kind: 'lord-succeeded',
      oldLordId: 'caocao',
      newLordId: 'simayi',
    })
  })

  it('玩家君主遭劫 → lord-stricken + succession-pending', () => {
    const s = withOfficer(createInitialState(1), 'liubei', { intelligence: 0, cityId: 'jiangling' })
    const { events } = resolveCampaignOutcome(
      s,
      outcome({
        attackerWins: false,
        attackerLord: 'liubei',
        attackerIds: ['liubei'],
        defenderIds: ['caocao'],
      })
    )
    expect(events).toContainEqual({ kind: 'lord-stricken', lordId: 'liubei' })
    expect(events).toContainEqual({ kind: 'succession-pending', lordId: 'liubei' })
  })

  it('君主遭劫且势力无城/无候选 → lord-eliminated', () => {
    // 让 caocao 仅余许昌（被占）、且邺城归刘备，则 caocao 占城后无城 → 灭亡。
    const s = withCity(createInitialState(1), 'ye', { lordId: 'liubei' })
    const { events } = resolveCampaignOutcome(s, outcome({ defenderIds: ['caocao'] }))
    expect(events).toContainEqual({ kind: 'lord-stricken', lordId: 'caocao' })
    expect(events).toContainEqual({ kind: 'lord-eliminated', lordId: 'caocao' })
  })
})
