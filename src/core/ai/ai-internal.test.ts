import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { randInt } from '../shared/rng'
import type { GameState } from '../game-state'
import type { City } from '../world/city'
import { isBusy } from '../world/queries'
import { runAiInternal, pickMoveTarget } from './ai-internal'

function withCity(s: GameState, id: string, patch: Partial<City>): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}
function withOfficer(
  s: GameState,
  id: string,
  patch: Partial<GameState['officers'][string]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

/** ye 城单一在任武将 simayi（zhangliao 移出 ye 排除），便于镜像单次 RandInt(0,10)。 */
function singleServing(seed: number): GameState {
  let s = createInitialState(seed)
  s = withOfficer(s, 'zhangliao', { cityId: 'xuchang' })
  s = withCity(s, 'ye', {
    status: 'flood',
    disasterPrevention: 50,
    agriculture: 300,
    commerce: 260,
    loyalty: 50,
    population: 35000,
    gold: 450,
  })
  return s
}

describe('runAiInternal 5.5.1 逐分支', () => {
  it('roll 映射到固定成长效果；不扣城金；占人用 busy', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = singleServing(seed)
      const [roll] = randInt(s.rng, 0, 10)
      const out = runAiInternal(s, 'ye')
      const ye = out.cities.ye!
      expect(ye.gold).toBe(450) // 任何分支都不扣城金

      if (roll === 0) {
        expect(ye.agriculture).toBe(500)
        expect(isBusy(out, 'simayi')).toBe(true)
      } else if (roll === 1) {
        expect(ye.commerce).toBe(460)
        expect(isBusy(out, 'simayi')).toBe(true)
      } else if (roll === 2) {
        expect(out.pendingCommands).toContainEqual({ type: 'search', officerId: 'simayi' })
        expect(isBusy(out, 'simayi')).toBe(true)
      } else if (roll === 3) {
        expect(ye.loyalty).toBe(54)
        expect(ye.population).toBe(35100)
        expect(isBusy(out, 'simayi')).toBe(true)
      } else if (roll === 4) {
        expect(ye.status).toBe('normal')
        expect(ye.disasterPrevention).toBe(54)
        expect(isBusy(out, 'simayi')).toBe(true)
      } else {
        // 5/6/7/8/10 跳过；9 因 i=0<3 也跳过
        expect(isBusy(out, 'simayi')).toBe(false)
        expect(out.pendingCommands).toEqual([])
        expect(ye.agriculture).toBe(300)
        expect(ye.commerce).toBe(260)
        expect(ye.status).toBe('flood')
      }
    }
  })
})

describe('pickMoveTarget 移动选城', () => {
  it('i<3 → null 且不耗 RNG', () => {
    const s = createInitialState(1)
    const [target, next] = pickMoveTarget(s, 'caocao', 2, s.rng)
    expect(target).toBeNull()
    expect(next.seed).toBe(s.rng.seed)
  })

  it('本势力城 <2 → null', () => {
    // 把 ye 划给 simayi，使 caocao 仅剩 xuchang 一城
    const s = withCity(createInitialState(1), 'ye', { lordId: 'simayi' })
    const [target, next] = pickMoveTarget(s, 'caocao', 3, s.rng)
    expect(target).toBeNull()
    expect(next.seed).toBe(s.rng.seed)
  })

  it('偏好相邻敌城：caocao 仅 xuchang 邻接玩家城 jiangling → 目标恒 xuchang', () => {
    const s = createInitialState(1)
    for (let seed = 1; seed <= 20; seed++) {
      const st = createInitialState(seed)
      const [target] = pickMoveTarget(st, 'caocao', 3, st.rng)
      expect(target).toBe('xuchang')
    }
    // 找到敌邻城时消耗一次 RandInt(0,1)
    const [, next] = pickMoveTarget(s, 'caocao', 3, s.rng)
    expect(next.seed).not.toBe(s.rng.seed)
  })

  it('全程无敌邻城 → 用初始候选（本势力 id 升序首座）', () => {
    // 断开前线：仅保留 caocao 内部 xuchang-ye 边，去掉 jiangling-xuchang
    const s = {
      ...createInitialState(1),
      adjacency: { xuchang: ['ye'], ye: ['xuchang'] },
    }
    const [target, next] = pickMoveTarget(s, 'caocao', 3, s.rng)
    expect(target).toBe('xuchang') // 'xuchang' < 'ye'
    expect(next.seed).toBe(s.rng.seed) // 无敌邻城 → 不掷 50% 骰
  })
})

describe('runAiInternal 确定性 / 无副作用越界', () => {
  it('相同 seed 两次一致；不产生 campaign；不扣城金', () => {
    const s = createInitialState(9)
    const a = runAiInternal(s, 'ye')
    const b = runAiInternal(s, 'ye')
    expect(a).toEqual(b)
    expect(a.pendingCommands.some((c) => c.type === 'campaign')).toBe(false)
    expect(a.cities.ye!.gold).toBe(s.cities.ye!.gold)
  })
})
