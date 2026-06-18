import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import type { Position } from '../shared/position'
import { isCaptive } from '../world/queries'
import { BATTLE_MAPS, DEFAULT_MAP_ID } from './battle-map'
import type { BattleState, BattleUnit, BattleSide, BattleMode } from './battle'
import { initBattle, checkImmediateVictory, reduceBattle, canBattle, concludeBattle } from './battle'

const map = BATTLE_MAPS[DEFAULT_MAP_ID]!

function unit(officerId: string, side: BattleSide, pos: Position, troops = 100, extra: Partial<BattleUnit> = {}): BattleUnit {
  return { officerId, side, pos, troops, experience: 0, level: 1, acted: false, routed: troops === 0, ...extra }
}
function makeBattle(units: BattleUnit[], over: Partial<BattleState> = {}): BattleState {
  return {
    mode: 'attack', mapId: DEFAULT_MAP_ID, day: 1,
    units: Object.fromEntries(units.map((u) => [u.officerId, u])),
    playerProvisions: 1000, opponentProvisions: 1000, commanderId: 'caocao',
    outcome: null, attackerLord: 'liubei', defenderLord: 'caocao',
    targetCityId: 'xuchang', provisions: 120, officerIds: ['guanyu', 'zhangfei'], ...over,
  }
}
const withBattle = (s: GameState, b: BattleState): GameState => ({ ...s, activeBattle: b })

describe('initBattle 玩家进攻许昌', () => {
  const s = createInitialState(1)
  const b = initBattle(s, ['guanyu', 'zhangfei'], 'xuchang', 120)
  it('模式=进攻、双方阵营正确', () => {
    expect(b.mode).toBe<BattleMode>('attack')
    expect(b.units.guanyu!.side).toBe('player')
    expect(b.units.caocao!.side).toBe('opponent')
  })
  it('主将=防守方第一名（id 定序）', () => {
    expect(b.commanderId).toBe('caocao')
  })
  it('战场粮草：攻方=随军粮草、守方=目标城开战城粮', () => {
    expect(b.playerProvisions).toBe(120)
    expect(b.opponentProvisions).toBe(s.cities.xuchang!.food)
  })
  it('单位摆在对应出生点、兵力/经验/等级取自 Officer', () => {
    expect(b.units.guanyu!.pos).toEqual(map.attackerSpawns[0])
    expect(b.units.caocao!.pos).toEqual(map.defenderSpawns[0])
    expect(b.units.guanyu!.troops).toBe(100)
  })
})

describe('reduceBattle act 普攻：扣兵 + 经验', () => {
  const s = createInitialState(1)
  const b = makeBattle([
    unit('guanyu', 'player', { x: 5, y: 5 }),
    unit('caocao', 'opponent', { x: 6, y: 5 }),
  ])
  const next = reduceBattle(withBattle(s, b), { type: 'act', officerId: 'guanyu', terminal: { kind: 'attack', target: { x: 6, y: 5 } } })
  const nb = next.activeBattle!
  it('目标扣兵（关羽550攻 vs 曹操693防，平原，骑骑相克100%）= 19', () => {
    expect(nb.units.caocao!.troops).toBe(100 - 19)
  })
  it('行动者本日已行动并获得经验', () => {
    expect(nb.units.guanyu!.acted).toBe(true)
    expect(nb.units.guanyu!.experience).toBe(3)
  })
})

describe('reduceBattle act 击溃主将 → 玩家胜', () => {
  const s = createInitialState(1)
  const b = makeBattle([
    unit('guanyu', 'player', { x: 5, y: 5 }),
    unit('caocao', 'opponent', { x: 6, y: 5 }, 5),
  ])
  const next = reduceBattle(withBattle(s, b), { type: 'act', officerId: 'guanyu', terminal: { kind: 'attack', target: { x: 6, y: 5 } } })
  it('目标兵力归零成击溃、主将击溃即玩家胜', () => {
    expect(next.activeBattle!.units.caocao!.routed).toBe(true)
    expect(next.activeBattle!.outcome).toBe('playerWin')
  })
  it('击溃额外经验（平级 +16）', () => {
    // dmg=5 → dmgExp=0 base=2；+16 = 18
    expect(next.activeBattle!.units.guanyu!.experience).toBe(18)
  })
})

describe('reduceBattle act 移动+休息：只占行动不伤害', () => {
  const s = createInitialState(1)
  const b = makeBattle([unit('guanyu', 'player', { x: 5, y: 5 })])
  const next = reduceBattle(withBattle(s, b), { type: 'act', officerId: 'guanyu', moveTo: { x: 7, y: 5 }, terminal: { kind: 'rest' } })
  it('移动落点生效、acted=true', () => {
    expect(next.activeBattle!.units.guanyu!.pos).toEqual({ x: 7, y: 5 })
    expect(next.activeBattle!.units.guanyu!.acted).toBe(true)
  })
})

describe('checkImmediateVictory 城池格 / 全灭', () => {
  const city = map.cityTiles[0]!
  it('玩家进攻单位进入城池格 → 玩家胜', () => {
    const b = makeBattle([unit('guanyu', 'player', city), unit('caocao', 'opponent', { x: 1, y: 1 })])
    expect(checkImmediateVictory(b, map)).toBe('playerWin')
  })
  it('对手方全灭 → 玩家胜', () => {
    const b = makeBattle([unit('guanyu', 'player', { x: 5, y: 5 }), unit('caocao', 'opponent', { x: 6, y: 5 }, 0)])
    expect(checkImmediateVictory(b, map)).toBe('playerWin')
  })
  it('玩家方全灭 → 玩家败', () => {
    const b = makeBattle([unit('guanyu', 'player', { x: 5, y: 5 }, 0), unit('caocao', 'opponent', { x: 6, y: 5 })])
    expect(checkImmediateVictory(b, map)).toBe('playerLose')
  })
})

describe('reduceBattle endDay：扣粮 + 日界判负', () => {
  const s = createInitialState(1)
  it('扣当日粮草后玩家方粮草归零 → 玩家败', () => {
    const b = makeBattle([unit('guanyu', 'player', { x: 5, y: 5 }, 100)], { playerProvisions: 2 })
    // 玩家方兵力100 → 耗粮 floor(sqrt(100)/3)=3 → 2-3=0
    const next = reduceBattle(withBattle(s, b), { type: 'endDay' })
    expect(next.activeBattle!.playerProvisions).toBe(0)
    expect(next.activeBattle!.outcome).toBe('playerLose')
  })
  it('天数推进并刷新行动；30 天后进攻方判败', () => {
    const b30 = makeBattle([{ ...unit('guanyu', 'player', { x: 5, y: 5 }), acted: true }], { day: 30 })
    const next = reduceBattle(withBattle(s, b30), { type: 'endDay' })
    expect(next.activeBattle!.day).toBe(31)
    expect(next.activeBattle!.units.guanyu!.acted).toBe(false)
    expect(next.activeBattle!.outcome).toBe('playerLose')
  })
})

describe('reduceBattle retreat → 玩家败', () => {
  const s = createInitialState(1)
  const b = makeBattle([unit('guanyu', 'player', { x: 5, y: 5 })])
  it('全军撤退立即判玩家败', () => {
    expect(reduceBattle(withBattle(s, b), { type: 'retreat' }).activeBattle!.outcome).toBe('playerLose')
  })
})

describe('canBattle 非法守卫', () => {
  const s = createInitialState(1)
  const b = makeBattle([
    unit('guanyu', 'player', { x: 5, y: 5 }),
    unit('caocao', 'opponent', { x: 20, y: 20 }),
  ])
  const st = withBattle(s, b)
  it('操作对手方单位非法', () => {
    expect(canBattle(st, { type: 'act', officerId: 'caocao', terminal: { kind: 'rest' } }).ok).toBe(false)
  })
  it('攻击范围外目标非法', () => {
    expect(canBattle(st, { type: 'act', officerId: 'guanyu', terminal: { kind: 'attack', target: { x: 20, y: 20 } } }).ok).toBe(false)
  })
  it('已行动单位再次行动非法（reduce no-op）', () => {
    const acted = makeBattle([{ ...unit('guanyu', 'player', { x: 5, y: 5 }), acted: true }])
    const before = withBattle(s, acted)
    const after = reduceBattle(before, { type: 'act', officerId: 'guanyu', terminal: { kind: 'rest' } })
    expect(after).toBe(before)
  })
})

describe('concludeBattle 写回 + 占城（攻方胜）', () => {
  const s = createInitialState(1)
  const b = makeBattle([
    unit('guanyu', 'player', { x: 28, y: 16 }, 55, { experience: 40, level: 2 }),
    unit('zhangfei', 'player', { x: 5, y: 5 }, 80),
    unit('caocao', 'opponent', { x: 6, y: 5 }, 0),
    unit('xunyu', 'opponent', { x: 7, y: 5 }, 30),
    unit('guojia', 'opponent', { x: 8, y: 5 }, 30),
  ], { outcome: 'playerWin' })
  const next = concludeBattle(withBattle(s, b))
  it('单位兵力/经验/等级写回 Officer', () => {
    expect(next.officers.guanyu!.troops).toBe(55)
    expect(next.officers.guanyu!.experience).toBe(40)
    expect(next.officers.guanyu!.level).toBe(2)
    expect(next.officers.xunyu!.troops).toBe(30)
  })
  it('占城：许昌归刘备、城粮+=随军粮草、出征武将进驻', () => {
    expect(next.cities.xuchang!.lordId).toBe('liubei')
    expect(next.cities.xuchang!.food).toBe(500 + 120)
    expect(next.officers.guanyu!.cityId).toBe('xuchang')
  })
  it('原守军成俘虏 + 被俘君主曹操触发重选（邺城归司马懿）', () => {
    expect(isCaptive(next, 'xunyu')).toBe(true)
    expect(isCaptive(next, 'caocao')).toBe(true)
    expect(next.cities.ye!.lordId).toBe('simayi')
  })
  it('activeBattle 清空', () => {
    expect(next.activeBattle).toBeNull()
  })
})
