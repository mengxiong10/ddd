import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { Position } from '../shared/position'
import { samePos } from '../shared/position'
import { BATTLE_MAPS, DEFAULT_MAP_ID } from './battle-map'
import type { BattleState, BattleUnit, BattleSide } from './battle'
import { reachableTiles, attackableTiles } from './battle-movement'

const state = createInitialState(1)
const map = BATTLE_MAPS[DEFAULT_MAP_ID]!

function unit(officerId: string, side: BattleSide, pos: Position): BattleUnit {
  return { officerId, side, pos, troops: 100, experience: 0, level: 1, acted: false, routed: false }
}
function makeBattle(units: BattleUnit[]): BattleState {
  return {
    mode: 'attack', mapId: DEFAULT_MAP_ID, day: 1,
    units: Object.fromEntries(units.map((u) => [u.officerId, u])),
    playerProvisions: 100, opponentProvisions: 100, commanderId: 'caocao',
    outcome: null, attackerLord: 'liubei', defenderLord: 'caocao',
    targetCityId: 'xuchang', provisions: 50, officerIds: ['guanyu'],
  }
}
const has = (ps: Position[], p: Position) => ps.some((q) => samePos(q, p))

describe('reachableTiles 开阔平原（骑兵移动力 5）', () => {
  const battle = makeBattle([unit('guanyu', 'player', { x: 3, y: 3 })])
  const r = reachableTiles(state, battle, 'guanyu')
  it('含起点（原地不动）', () => {
    expect(has(r, { x: 3, y: 3 })).toBe(true)
  })
  it('距离 5 可达、距离 6 不可达', () => {
    expect(has(r, { x: 8, y: 3 })).toBe(true)
    expect(has(r, { x: 3, y: 8 })).toBe(true)
    expect(has(r, { x: 9, y: 3 })).toBe(false)
  })
})

describe('reachableTiles 友方穿越但不可落点', () => {
  const battle = makeBattle([
    unit('guanyu', 'player', { x: 3, y: 3 }),
    unit('zhangfei', 'player', { x: 4, y: 3 }),
  ])
  const r = reachableTiles(state, battle, 'guanyu')
  it('友方所占格不可作为落点', () => {
    expect(has(r, { x: 4, y: 3 })).toBe(false)
  })
  it('可穿越友方落到其后方格', () => {
    expect(has(r, { x: 5, y: 3 })).toBe(true)
  })
})

describe('reachableTiles 敌方占格阻挡 + 接敌停步区', () => {
  const battle = makeBattle([
    unit('guanyu', 'player', { x: 3, y: 3 }),
    unit('caocao', 'opponent', { x: 6, y: 3 }),
  ])
  const r = reachableTiles(state, battle, 'guanyu')
  it('敌方占格不可进入', () => {
    expect(has(r, { x: 6, y: 3 })).toBe(false)
  })
  it('接敌停步区格本身可落（停步），但其外侧不可穿越到达', () => {
    expect(has(r, { x: 5, y: 3 })).toBe(true) // ZoC 格，进入即停
    expect(has(r, { x: 7, y: 3 })).toBe(false) // 敌后方，需绕行超预算
  })
})

describe('attackableTiles 兵种掩码', () => {
  it('骑兵十字 4 格', () => {
    const r = attackableTiles(map, { x: 3, y: 3 }, 'cavalry')
    expect(r).toHaveLength(4)
    expect(has(r, { x: 3, y: 2 })).toBe(true)
    expect(has(r, { x: 4, y: 3 })).toBe(true)
  })
  it('弓兵散点 8 格', () => {
    const r = attackableTiles(map, { x: 3, y: 3 }, 'archer')
    expect(r).toHaveLength(8)
    expect(has(r, { x: 5, y: 3 })).toBe(true)
    expect(has(r, { x: 3, y: 1 })).toBe(true)
  })
  it('越界格被剔除', () => {
    const r = attackableTiles(map, { x: 0, y: 0 }, 'cavalry')
    expect(r).toHaveLength(2)
  })
})
