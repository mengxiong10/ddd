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

describe('runAiMilitary 不出征 / 确定性', () => {
  it('本切片不产生任何 campaign 命令', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const out = runAiMilitary(createInitialState(seed), 'xuchang')
      expect(out.pendingCommands.some((c) => c.type === 'campaign')).toBe(false)
    }
  })

  it('相同 seed 两次一致', () => {
    const s = createInitialState(8)
    expect(runAiMilitary(s, 'ye')).toEqual(runAiMilitary(s, 'ye'))
  })
})
