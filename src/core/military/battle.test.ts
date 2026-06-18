import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import type { Position } from '../shared/position'
import { isCaptive } from '../world/queries'
import { BATTLE_MAPS, DEFAULT_MAP_ID } from './battle-map'
import type { BattleState, BattleUnit, BattleSide, BattleMode } from './battle'
import { initBattle, checkImmediateVictory, reduceBattle, canBattle, concludeBattle, startDay } from './battle'
import { WEATHER_ORDER } from './battle-weather'

const map = BATTLE_MAPS[DEFAULT_MAP_ID]!

function unit(officerId: string, side: BattleSide, pos: Position, troops = 100, extra: Partial<BattleUnit> = {}): BattleUnit {
  return { officerId, side, pos, troops, experience: 0, level: 1, acted: false, mp: 100, maxMp: 100, status: troops === 0 ? 'dead' : 'normal', ...extra }
}
function makeBattle(units: BattleUnit[], over: Partial<BattleState> = {}): BattleState {
  return {
    mode: 'attack', mapId: DEFAULT_MAP_ID, weather: 'wind', day: 1,
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
    expect(next.activeBattle!.units.caocao!.status).toBe('dead')
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
    const b = makeBattle([
      unit('guanyu', 'player', { x: 5, y: 5 }, 100),
      unit('caocao', 'opponent', { x: 20, y: 20 }),
    ], { playerProvisions: 2 })
    // 玩家方兵力100 → 耗粮 floor(sqrt(100)/3)=3 → 2-3=0
    const next = reduceBattle(withBattle(s, b), { type: 'endDay' })
    expect(next.activeBattle!.playerProvisions).toBe(0)
    expect(next.activeBattle!.outcome).toBe('playerLose')
  })
  it('天数推进并刷新行动；30 天后进攻方判败', () => {
    const b29 = makeBattle([
      { ...unit('guanyu', 'player', { x: 5, y: 5 }), acted: true },
      unit('caocao', 'opponent', { x: 20, y: 20 }),
    ], { day: 29 })
    const mid = reduceBattle(withBattle(s, b29), { type: 'endDay' })
    expect(mid.activeBattle!.day).toBe(30)
    expect(mid.activeBattle!.units.guanyu!.acted).toBe(false) // startDay 刷新行动
    expect(mid.activeBattle!.outcome).toBeNull()
    const over = reduceBattle(mid, { type: 'endDay' })
    expect(over.activeBattle!.day).toBe(31)
    expect(over.activeBattle!.outcome).toBe('playerLose')
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

const withPersonal = (s: GameState, id: string, skills: number[]): GameState => ({
  ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, personalSkills: skills } },
})

describe('reduceBattle cast 施法（诸葛亮 intel100 → seed1 必中、seed2 必失）', () => {
  it('火攻命中：倍率链扣兵（500→260）+ 扣 MP + acted + 耗 rng', () => {
    const s = createInitialState(1)
    const b = makeBattle([unit('zhugeliang', 'player', { x: 5, y: 5 }), unit('xunyu', 'opponent', { x: 6, y: 5 }, 500)])
    const next = reduceBattle(withBattle(s, b), { type: 'act', officerId: 'zhugeliang', terminal: { kind: 'cast', skillId: 5, target: { x: 6, y: 5 } } })
    const nb = next.activeBattle!
    expect(nb.units.xunyu!.troops).toBe(260) // effectValue(400,100,100,plain60,100)=240
    expect(nb.units.zhugeliang!.mp).toBe(85) // 100-15
    expect(nb.units.zhugeliang!.acted).toBe(true)
    expect(next.rng.seed).not.toBe(s.rng.seed)
  })
  it('火攻失败（seed2）：无伤害但仍扣 MP', () => {
    const s = createInitialState(2)
    const b = makeBattle([unit('zhugeliang', 'player', { x: 5, y: 5 }), unit('xunyu', 'opponent', { x: 6, y: 5 }, 500)])
    const nb = reduceBattle(withBattle(s, b), { type: 'act', officerId: 'zhugeliang', terminal: { kind: 'cast', skillId: 5, target: { x: 6, y: 5 } } }).activeBattle!
    expect(nb.units.xunyu!.troops).toBe(500)
    expect(nb.units.zhugeliang!.mp).toBe(85)
  })
  it('天变（self）：刷新天气 + 扣 MP', () => {
    const s = createInitialState(1)
    const b = makeBattle([unit('zhugeliang', 'player', { x: 5, y: 5 }), unit('caocao', 'opponent', { x: 20, y: 20 })])
    const next = reduceBattle(withBattle(s, b), { type: 'act', officerId: 'zhugeliang', terminal: { kind: 'cast', skillId: 22 } })
    expect(WEATHER_ORDER).toContain(next.activeBattle!.weather)
    expect(next.activeBattle!.units.zhugeliang!.mp).toBe(90) // 100-10
  })
  it('石阵：施加状态、不扣兵', () => {
    const s = createInitialState(1)
    const b = makeBattle([unit('zhugeliang', 'player', { x: 5, y: 5 }), unit('xunyu', 'opponent', { x: 6, y: 5 }, 500)])
    const nb = reduceBattle(withBattle(s, b), { type: 'act', officerId: 'zhugeliang', terminal: { kind: 'cast', skillId: 23, target: { x: 6, y: 5 } } }).activeBattle!
    expect(nb.units.xunyu!.status).toBe('stone')
    expect(nb.units.xunyu!.troops).toBe(500)
    expect(nb.units.zhugeliang!.mp).toBe(80) // 100-20
  })
  it('援兵（friendly heal）：封顶带兵量补兵（100→900）', () => {
    const s = withPersonal(createInitialState(1), 'zhugeliang', [17])
    const b = makeBattle([
      unit('zhugeliang', 'player', { x: 5, y: 5 }),
      unit('guanyu', 'player', { x: 6, y: 5 }, 100),
      unit('caocao', 'opponent', { x: 20, y: 20 }),
    ])
    const nb = reduceBattle(withBattle(s, b), { type: 'act', officerId: 'zhugeliang', terminal: { kind: 'cast', skillId: 17, target: { x: 6, y: 5 } } }).activeBattle!
    expect(nb.units.guanyu!.troops).toBe(900) // 100 + effectValue(800,100,100,100,100)=800（cap=1350）
  })
  it('火箭（破粮）：扣对手战场粮草（1000→850）', () => {
    const s = withPersonal(createInitialState(1), 'zhugeliang', [11])
    const b = makeBattle([
      unit('zhugeliang', 'player', { x: 26, y: 12 }),
      unit('xunyu', 'opponent', { x: 26, y: 15 }), // 村庄格
    ])
    const nb = reduceBattle(withBattle(s, b), { type: 'act', officerId: 'zhugeliang', terminal: { kind: 'cast', skillId: 11, target: { x: 26, y: 15 } } }).activeBattle!
    expect(nb.opponentProvisions).toBe(850) // effectValue(150,…)=150
  })
  it('围攻：目标四邻友军逐个普攻、友军获经验', () => {
    const s = withPersonal(createInitialState(1), 'zhugeliang', [27])
    const b = makeBattle([
      unit('zhugeliang', 'player', { x: 6, y: 3 }),
      unit('guanyu', 'player', { x: 5, y: 5 }),
      unit('zhangfei', 'player', { x: 7, y: 5 }),
      unit('xunyu', 'opponent', { x: 6, y: 5 }, 500),
    ])
    const nb = reduceBattle(withBattle(s, b), { type: 'act', officerId: 'zhugeliang', terminal: { kind: 'cast', skillId: 27, target: { x: 6, y: 5 } } }).activeBattle!
    expect(nb.units.xunyu!.troops).toBeLessThan(500)
    expect(nb.units.guanyu!.experience).toBeGreaterThan(0)
    expect(nb.units.zhangfei!.experience).toBeGreaterThan(0)
  })
})

describe('canBattle 施法守卫', () => {
  const s = createInitialState(1)
  it('禁咒状态不能施法', () => {
    const b = makeBattle([{ ...unit('zhugeliang', 'player', { x: 5, y: 5 }), status: 'sealed' }, unit('xunyu', 'opponent', { x: 6, y: 5 })])
    expect(canBattle(withBattle(s, b), { type: 'act', officerId: 'zhugeliang', terminal: { kind: 'cast', skillId: 5, target: { x: 6, y: 5 } } }).ok).toBe(false)
  })
  it('未掌握的技能不能施放（诸葛亮无骑兵践踏）', () => {
    const b = makeBattle([unit('zhugeliang', 'player', { x: 5, y: 5 }), unit('xunyu', 'opponent', { x: 6, y: 5 })])
    expect(canBattle(withBattle(s, b), { type: 'act', officerId: 'zhugeliang', terminal: { kind: 'cast', skillId: 1, target: { x: 6, y: 5 } } }).ok).toBe(false)
  })
  it('MP 不足不能施放', () => {
    const b = makeBattle([{ ...unit('zhugeliang', 'player', { x: 5, y: 5 }), mp: 5 }, unit('xunyu', 'opponent', { x: 6, y: 5 })])
    expect(canBattle(withBattle(s, b), { type: 'act', officerId: 'zhugeliang', terminal: { kind: 'cast', skillId: 5, target: { x: 6, y: 5 } } }).ok).toBe(false)
  })
  it('混乱状态不能行动（含施法/普攻）', () => {
    const b = makeBattle([{ ...unit('guanyu', 'player', { x: 5, y: 5 }), status: 'confused' }, unit('caocao', 'opponent', { x: 6, y: 5 })])
    expect(canBattle(withBattle(s, b), { type: 'act', officerId: 'guanyu', terminal: { kind: 'attack', target: { x: 6, y: 5 } } }).ok).toBe(false)
  })
})

describe('startDay 每日开头', () => {
  const s = createInitialState(1)
  it('刷新天气（消耗 rng）+ 重置当日行动', () => {
    const b = makeBattle([{ ...unit('guanyu', 'player', { x: 5, y: 5 }), acted: true }, unit('caocao', 'opponent', { x: 20, y: 20 })])
    const next = startDay(withBattle(s, b))
    expect(WEATHER_ORDER).toContain(next.activeBattle!.weather)
    expect(next.rng.seed).not.toBe(s.rng.seed)
    expect(next.activeBattle!.units.guanyu!.acted).toBe(false)
  })
  it('石阵单位先损兵 1/8（800→700）', () => {
    const b = makeBattle([
      { ...unit('guanyu', 'player', { x: 5, y: 5 }, 800), status: 'stone' },
      unit('caocao', 'opponent', { x: 20, y: 20 }),
    ])
    const next = startDay(withBattle(s, b))
    expect(next.activeBattle!.units.guanyu!.troops).toBe(700)
  })
  it('day>30 → 进攻方判败', () => {
    const b = makeBattle([unit('guanyu', 'player', { x: 5, y: 5 })], { day: 31 })
    expect(startDay(withBattle(s, b)).activeBattle!.outcome).toBe('playerLose')
  })
  it('日界查粮草：玩家方粮草为 0 → 判败', () => {
    const b = makeBattle([
      unit('guanyu', 'player', { x: 5, y: 5 }),
      unit('caocao', 'opponent', { x: 20, y: 20 }),
    ], { day: 2, playerProvisions: 0 })
    expect(startDay(withBattle(s, b)).activeBattle!.outcome).toBe('playerLose')
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
