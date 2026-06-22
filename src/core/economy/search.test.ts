import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import { randInt } from '../shared/rng'
import type { GameState } from '../game-state'
import { canSearch, search, executeSearch } from './search'
import { isBusy } from '../world/queries'
import { apply } from '../game'

const cfg = DEFAULT_CONFIG
// 成都(chengdu)：金500 粮400；诸葛亮(zhugeliang) 智力100、无道具 -> 有效智力 100。

/** 占用某武将（占用为派生：入队一条引用该武将的命令）。 */
function occupy(s: GameState, id: number): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, { type: 'develop', officerId: id }] }
}

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
/** 在成都放一名在野武将（lordId=null），指定伯乐。 */
function withWanderer(s: GameState, id: number, recruiterId: number | null): GameState {
  const o = {
    ...s.officers[2]!,
    id,
    name: String(id),
    lordId: null,
    cityId: 1,
    troops: 0,
    appearanceConditions: { ...s.officers[2]!.appearanceConditions, recruiterId },
  }
  return { ...s, officers: { ...s.officers, [id]: o } }
}
/** 在成都放一件未发现道具，指定伯乐。 */
function withHiddenItem(s: GameState, id: number, recruiterId: number | null): GameState {
  return {
    ...s,
    items: {
      ...s.items,
      [id]: {
        id,
        name: String(id),
        forceBonus: 1,
        intelBonus: 0,
        movementBonus: 0,
        troopTypeOverride: 0,
        holder: { kind: 'city', cityId: 1 } as const,
        discovered: false,
        appearanceConditions: { birth: 0, recruiterId, cityId: null },
      },
    },
  }
}

const firstBranch = (seed: number) => randInt({ seed }, 0, 3)[0]
function findSeed(pred: (seed: number) => boolean): number {
  for (let seed = 1; seed < 500000; seed++) if (pred(seed)) return seed
  throw new Error('seed not found')
}

describe('canSearch 前置校验', () => {
  it('合法：在任武将、体力≥8', () => {
    expect(canSearch(createInitialState(1), 2, cfg).ok).toBe(true)
  })
  it('武将不存在 -> 拒绝', () => {
    expect(canSearch(createInitialState(1), 999, cfg).ok).toBe(false)
  })
  it('已占用 -> 拒绝', () => {
    expect(canSearch(occupy(createInitialState(1), 2), 2, cfg).ok).toBe(false)
  })
  it('俘虏 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 1, { lordId: 6 }) // 成都易主，诸葛亮成俘虏
    expect(canSearch(s, 2, cfg).ok).toBe(false)
  })
  it('体力 < 8 -> 拒绝', () => {
    expect(canSearch(withOfficer(createInitialState(1), 2, { stamina: 7 }), 2, cfg).ok).toBe(false)
  })
})

describe('search 下令', () => {
  it('扣体力8、占用(入队 search)；城/RNG 不变', () => {
    const s = createInitialState(1)
    const next = search(s, 2, cfg).state
    expect(next.officers[2]!.stamina).toBe(100 - 8)
    expect(isBusy(next, 2)).toBe(true)
    expect(next.rng.seed).toBe(s.rng.seed)
    expect(next.cities).toEqual(s.cities)
    expect(next.pendingCommands).toEqual([{ type: 'search', officerId: 2 }])
  })
  it('非法下令 no-op（state 不变、自报告失败 reason）', () => {
    const s = withOfficer(createInitialState(1), 2, { stamina: 0 })
    const res = search(s, 2, cfg)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('stamina-insufficient')
  })
})

describe('executeSearch 四分支', () => {
  it('无事发生（branch 0）：除 RNG 外不变', () => {
    const seed = findSeed((sd) => firstBranch(sd) === 0)
    const s = { ...createInitialState(1), rng: { seed } }
    const { state: next, events } = executeSearch(s, 2)
    expect(next.cities).toEqual(s.cities)
    expect(next.officers).toEqual(s.officers)
    expect(next.items).toEqual(s.items)
    expect(next.rng.seed).not.toBe(s.rng.seed)
    expect(events).toEqual([{ kind: 'search-none', officerId: 2, cityId: 1 }])
  })

  it('获得金钱（branch 2）：城金 += RandInt(10, max(10,智力×2))', () => {
    const seed = findSeed((sd) => firstBranch(sd) === 2)
    const [, r1] = randInt({ seed }, 0, 3)
    const [amount] = randInt(r1, 10, Math.max(10, 100 * 2))
    const s = { ...createInitialState(1), rng: { seed } }
    const { state: next, events } = executeSearch(s, 2)
    expect(next.cities[1]!.gold).toBe(500 + amount)
    expect(next.cities[1]!.food).toBe(400)
    expect(events).toEqual([
      {
        kind: 'search-resource',
        officerId: 2,
        cityId: 1,
        resource: 'gold',
        amount,
      },
    ])
  })

  it('获得粮食（branch 3）：城粮 += 同公式', () => {
    const seed = findSeed((sd) => firstBranch(sd) === 3)
    const [, r1] = randInt({ seed }, 0, 3)
    const [amount] = randInt(r1, 10, Math.max(10, 100 * 2))
    const s = { ...createInitialState(1), rng: { seed } }
    const next = executeSearch(s, 2).state
    expect(next.cities[1]!.food).toBe(400 + amount)
    expect(next.cities[1]!.gold).toBe(500)
  })

  it('金钱封顶 30000', () => {
    const seed = findSeed((sd) => firstBranch(sd) === 2)
    const s = withCity({ ...createInitialState(1), rng: { seed } }, 1, { gold: 29995 })
    expect(executeSearch(s, 2).state.cities[1]!.gold).toBe(30000)
  })
})

describe('executeSearch 发现武将（招募）', () => {
  it('伯乐=null：存在能招募成功的种子；成功后归执行人君主、忠诚∈[70,99]', () => {
    const base = withWanderer(createInitialState(1), 100, null)
    const seed = findSeed(
      (sd) => executeSearch({ ...base, rng: { seed: sd } }, 2).state.officers[100]!.lordId === 1
    )
    const next = executeSearch({ ...base, rng: { seed } }, 2).state
    expect(next.officers[100]!.lordId).toBe(1)
    expect(next.officers[100]!.cityId).toBe(1)
    expect(next.officers[100]!.troops).toBe(0)
    expect(next.officers[100]!.loyalty).toBeGreaterThanOrEqual(70)
    expect(next.officers[100]!.loyalty).toBeLessThanOrEqual(99)
  })

  it('伯乐=执行人本人：到达武将分支即必中', () => {
    const base = withWanderer(createInitialState(1), 100, 2)
    const seed = findSeed(
      (sd) => executeSearch({ ...base, rng: { seed: sd } }, 2).state.officers[100]!.lordId === 1
    )
    expect(executeSearch({ ...base, rng: { seed } }, 2).state.officers[100]!.lordId).toBe(1)
  })

  it('伯乐=他人：必败（路径可达但从不成功）', () => {
    const sNull = withWanderer(createInitialState(1), 100, null)
    const sOther = withWanderer(createInitialState(1), 100, 4)
    let reachable = false
    let everRecruited = false
    for (let seed = 1; seed < 3000; seed++) {
      if (executeSearch({ ...sNull, rng: { seed } }, 2).state.officers[100]!.lordId === 1)
        reachable = true
      if (executeSearch({ ...sOther, rng: { seed } }, 2).state.officers[100]!.lordId !== null)
        everRecruited = true
    }
    expect(reachable).toBe(true)
    expect(everRecruited).toBe(false)
  })

  it('候选为空：武将分支当作无事（不改 officers/items）', () => {
    // 构造一颗到达 branch1→过筛→kind0(武将) 的种子；成都无在野武将
    const seed = findSeed((sd) => {
      const [b, r1] = randInt({ seed: sd }, 0, 3)
      if (b !== 1) return false
      const [sieve, r2] = randInt(r1, 0, 149)
      if (sieve >= 100) return false
      const [kind] = randInt(r2, 0, 1)
      return kind === 0
    })
    const s = { ...createInitialState(1), rng: { seed } }
    const next = executeSearch(s, 2).state
    expect(next.officers).toEqual(s.officers)
    expect(next.items).toEqual(s.items)
    expect(next.cities).toEqual(s.cities)
  })

  it('已招募后不被重复获得：在野武将归属后退出候选', () => {
    const recruited = withOfficer(withWanderer(createInitialState(1), 100, null), 100, {
      lordId: 1,
      cityId: 1,
    })
    // 任何种子下该武将都不再是候选 -> 武将分支命中也不会再改其归属
    for (let seed = 1; seed < 500; seed++) {
      const r = executeSearch({ ...recruited, rng: { seed } }, 2).state
      expect(r.officers[100]!.lordId).toBe(1)
    }
  })
})

describe('executeSearch 发现道具', () => {
  it('伯乐=null：存在发现成功的种子；成功后 discovered=true', () => {
    const base = withHiddenItem(createInitialState(1), 101, null)
    const seed = findSeed(
      (sd) => executeSearch({ ...base, rng: { seed: sd } }, 2).state.items[101]!.discovered
    )
    expect(executeSearch({ ...base, rng: { seed } }, 2).state.items[101]!.discovered).toBe(true)
  })

  it('伯乐=他人：必败（从不被发现）', () => {
    const sNull = withHiddenItem(createInitialState(1), 101, null)
    const sOther = withHiddenItem(createInitialState(1), 101, 4)
    let reachable = false
    let everFound = false
    for (let seed = 1; seed < 3000; seed++) {
      if (executeSearch({ ...sNull, rng: { seed } }, 2).state.items[101]!.discovered)
        reachable = true
      if (executeSearch({ ...sOther, rng: { seed } }, 2).state.items[101]!.discovered)
        everFound = true
    }
    expect(reachable).toBe(true)
    expect(everFound).toBe(false)
  })
})

describe('搜寻端到端（apply + 月末执行 + 回城）', () => {
  it('下令后入队，月末执行并释放占用（出队 → isBusy=false）', () => {
    const s = apply(createInitialState(1), { type: 'search', officerId: 2 })
    expect(s.pendingCommands).toHaveLength(1)
    const next = apply(s, { type: 'endMonth' })
    expect(next.pendingCommands).toHaveLength(0)
    expect(isBusy(next, 2)).toBe(false)
  })
})
