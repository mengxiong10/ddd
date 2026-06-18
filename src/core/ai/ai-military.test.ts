import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { randInt } from '../shared/rng'
import type { GameState } from '../game-state'
import { runAiMilitary } from './ai-military'

function withOfficer(
  s: GameState,
  id: string,
  patch: Partial<GameState['officers'][string]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

/** ye 仅 simayi 在任（zhangliao busy），simayi 兵力起始 10。 */
function single(seed: number, patch: Partial<GameState> = {}): GameState {
  let s = createInitialState(seed)
  s = withOfficer(s, 'zhangliao', { busy: true })
  s = withOfficer(s, 'simayi', { troops: 10 })
  return { ...s, ...patch }
}

// simayi: level1 force50 intel96 → 带兵量 = 100 + 500 + 960 = 1560（level2 时 1660）
describe('runAiMilitary 5.5.4 补兵', () => {
  it('roll 1~5 把强化对象补满带兵量上限，其余不动；不占人/不扣金/不动后备兵', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const s = single(seed) // month 1，不升级
      const [, r1] = randInt(s.rng, 0, 0) // 单人 → 选强化对象消耗一次
      const [roll] = randInt(r1, 0, 8)
      const out = runAiMilitary(s, 'ye')
      expect(out.officers.simayi!.busy).toBe(false)
      expect(out.cities.ye!.gold).toBe(s.cities.ye!.gold)
      expect(out.cities.ye!.reserveTroops).toBe(s.cities.ye!.reserveTroops)
      expect(out.pendingCommands).toEqual([])
      if (roll >= 1 && roll <= 5) expect(out.officers.simayi!.troops).toBe(1560)
      else expect(out.officers.simayi!.troops).toBe(10)
    }
  })

  it('month%3===0：强化对象先升级，补兵用新上限', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = single(seed, { month: 3 })
      const [, r1] = randInt(s.rng, 0, 0)
      const [roll] = randInt(r1, 0, 8)
      const out = runAiMilitary(s, 'ye')
      expect(out.officers.simayi!.level).toBe(2) // 无论 roll 都升级
      if (roll >= 1 && roll <= 5) expect(out.officers.simayi!.troops).toBe(1660)
      else expect(out.officers.simayi!.troops).toBe(10)
    }
  })

  it('非整除月不升级', () => {
    const out = runAiMilitary(single(1, { month: 4 }), 'ye')
    expect(out.officers.simayi!.level).toBe(1)
  })
})

describe('runAiMilitary 出征生成（16-ai-campaign）', () => {
  it('门槛不足不出征：fixture AI 城在任武将 <4 → 永不产生 campaign', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(
        runAiMilitary(createInitialState(seed), 'xuchang').pendingCommands.some(
          (c) => c.type === 'campaign'
        )
      ).toBe(false)
    }
  })

  it('相同 seed 两次一致（确定性）', () => {
    const s = createInitialState(8)
    expect(runAiMilitary(s, 'ye')).toEqual(runAiMilitary(s, 'ye'))
  })

  /** 给邺城凑足 ≥4 在任武将且最高兵力 ≥1000，并保证邺城有相邻敌城（把许昌划给玩家=敌）。 */
  function campaignReady(seed: number): GameState {
    let s = createInitialState(seed)
    // 许昌改归玩家 → 成为邺城(曹操)的相邻敌城；其武将随城归玩家（避免成俘虏）。
    s = { ...s, cities: { ...s.cities, xuchang: { ...s.cities.xuchang!, lordId: 'liubei' } } }
    for (const id of ['caocao', 'xunyu', 'guojia'])
      s = withOfficer(s, id, { lordId: 'liubei', cityId: 'xuchang' })
    // 邺城补到 4 名在任曹操武将（含原 simayi/zhangliao），最高兵力 1500。
    s = withOfficer(s, 'simayi', { troops: 1500 })
    s = { ...s, officers: { ...s.officers } }
    for (const [id, _force] of [
      ['m1', 60],
      ['m2', 60],
    ] as const) {
      s = {
        ...s,
        officers: {
          ...s.officers,
          [id]: {
            ...s.officers.zhangliao!,
            id,
            name: id,
            lordId: 'caocao',
            cityId: 'ye',
            troops: 500,
            busy: false,
          },
        },
      }
    }
    return s
  }

  it('过门槛+50%命中：向最弱相邻敌城出征，带兵≤10且留≥1守城，粮草填满本城且清零', () => {
    // 找一个 i===0 roll===7 且 50% 命中的 seed。
    let found = false
    for (let seed = 1; seed <= 200 && !found; seed++) {
      const s = campaignReady(seed)
      const out = runAiMilitary(s, 'ye')
      const camp = out.pendingCommands.find((c) => c.type === 'campaign')
      if (!camp || camp.type !== 'campaign') continue
      found = true
      expect(camp.targetCityId).toBe('xuchang') // 唯一相邻敌城=最弱
      expect(camp.officerIds.length).toBeLessThanOrEqual(10)
      // 邺城在任=4（simayi/zhangliao/m1/m2）→ 留 1 守 → 带 3 人。
      expect(camp.officerIds.length).toBe(3)
      expect(camp.officerIds).toContain('simayi') // 兵力最高领衔
      expect(camp.provisions).toBe(s.cities.ye!.food)
      expect(out.cities.ye!.food).toBe(0) // 粮随军清零
      for (const id of camp.officerIds) expect(out.officers[id]!.busy).toBe(true)
    }
    expect(found).toBe(true)
  })

  it('仅首位武将（i===0）可触发出征：构造确保至多一条 campaign', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const out = runAiMilitary(campaignReady(seed), 'ye')
      expect(out.pendingCommands.filter((c) => c.type === 'campaign').length).toBeLessThanOrEqual(1)
    }
  })
})
