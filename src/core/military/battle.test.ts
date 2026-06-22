import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import type { Position } from '../shared/position'
import {
  DEFAULT_MAP_ID,
  attackDirection,
  attackerSpawns,
  defenderSpawns,
  cityTile,
} from './battle-map'
import type { BattleState, BattleUnit, BattleSide, BattleMode } from './battle'
import {
  initBattle,
  checkImmediateVictory,
  reduceBattle,
  canBattle,
  concludeBattle,
  startDay,
} from './battle'
import { WEATHER_ORDER } from './battle-weather'

const map = createInitialState(1).battleMaps[DEFAULT_MAP_ID]!

function unit(
  officerId: number,
  side: BattleSide,
  pos: Position,
  troops = 100,
  extra: Partial<BattleUnit> = {}
): BattleUnit {
  return {
    officerId,
    side,
    pos,
    troops,
    experience: 0,
    level: 1,
    acted: false,
    mp: 100,
    maxMp: 100,
    status: troops === 0 ? 'dead' : 'normal',
    ...extra,
  }
}
function makeBattle(units: BattleUnit[], over: Partial<BattleState> = {}): BattleState {
  return {
    mode: 'attack',
    mapId: DEFAULT_MAP_ID,
    weather: 'wind',
    day: 1,
    units: Object.fromEntries(units.map((u) => [u.officerId, u])),
    playerProvisions: 1000,
    opponentProvisions: 1000,
    attackerCommanderId: 4,
    defenderCommanderId: 6,
    outcome: null,
    targetCityId: 3,
    ...over,
  }
}
const withBattle = (s: GameState, b: BattleState): GameState => ({ ...s, activeBattle: b })

describe('initBattle 玩家进攻许昌', () => {
  const s = createInitialState(1)
  const b = initBattle(s, [4, 5], 3, 120)
  it('模式=进攻、双方阵营正确', () => {
    expect(b.mode).toBe<BattleMode>('attack')
    expect(b.units[4]!.side).toBe('player')
    expect(b.units[6]!.side).toBe('opponent')
  })
  it('守方主将=太守（曹操驻许昌即太守、列首位）', () => {
    expect(b.defenderCommanderId).toBe(6)
  })
  it('攻方主将=出征名单首位', () => {
    expect(b.attackerCommanderId).toBe(4)
  })
  it('战场粮草：攻方=随军粮草、守方=目标城开战城粮', () => {
    expect(b.playerProvisions).toBe(120)
    expect(b.opponentProvisions).toBe(s.cities[3]!.food)
  })
  it('单位摆在对应出生点、兵力/经验/等级取自 Officer', () => {
    const direction = attackDirection(s.cities[2]!, s.cities[3]!)
    expect(direction).toBe('west')
    expect(b.units[4]!.pos).toEqual(attackerSpawns(map, direction)[0])
    expect(b.units[6]!.pos).toEqual(defenderSpawns(map)[0])
    expect(b.units[4]!.troops).toBe(100)
  })
  it('守方排序：太守领衔，其余按兵力降序入位', () => {
    const base = createInitialState(1)
    const s2: GameState = {
      ...base,
      officers: {
        ...base.officers,
        7: { ...base.officers[7]!, troops: 500 },
        8: { ...base.officers[8]!, troops: 100 },
      },
    }
    const b2 = initBattle(s2, [4], 3, 100)
    const spawns = defenderSpawns(map)
    expect(b2.units[6]!.pos).toEqual(spawns[0]) // 太守领衔
    expect(b2.units[7]!.pos).toEqual(spawns[1]) // 兵力高者次位
    expect(b2.units[8]!.pos).toEqual(spawns[2])
  })
})

it('initBattle rejects an unknown city battle-map id instead of falling back', () => {
  const base = createInitialState(1)
  const state: GameState = {
    ...base,
    cities: { ...base.cities, 3: { ...base.cities[3]!, battleMapId: 99 } },
  }
  expect(() => initBattle(state, [4], 3, 100)).toThrow('unknown battle map: 99')
})

describe('reduceBattle act 普攻：扣兵 + 经验', () => {
  const s = createInitialState(1)
  const b = makeBattle([unit(4, 'player', { x: 5, y: 5 }), unit(6, 'opponent', { x: 6, y: 5 })])
  const next = reduceBattle(withBattle(s, b), {
    type: 'act',
    officerId: 4,
    terminal: { kind: 'attack', target: { x: 6, y: 5 } },
  })
  const nb = next.activeBattle!
  it('目标扣兵（关羽550攻 vs 曹操693防，平原，骑骑相克100%）= 19', () => {
    expect(nb.units[6]!.troops).toBe(100 - 19)
  })
  it('行动者本日已行动并获得经验', () => {
    expect(nb.units[4]!.acted).toBe(true)
    expect(nb.units[4]!.experience).toBe(3)
  })
})

describe('reduceBattle act 击溃主将 → 玩家胜', () => {
  const s = createInitialState(1)
  const b = makeBattle([unit(4, 'player', { x: 5, y: 5 }), unit(6, 'opponent', { x: 6, y: 5 }, 5)])
  const next = reduceBattle(withBattle(s, b), {
    type: 'act',
    officerId: 4,
    terminal: { kind: 'attack', target: { x: 6, y: 5 } },
  })
  it('目标兵力归零成击溃、主将击溃即玩家胜', () => {
    expect(next.activeBattle!.units[6]!.status).toBe('dead')
    expect(next.activeBattle!.outcome).toBe('playerWin')
  })
  it('击溃额外经验（平级 +16）', () => {
    // dmg=5 → dmgExp=0 base=2；+16 = 18
    expect(next.activeBattle!.units[4]!.experience).toBe(18)
  })
})

describe('reduceBattle act 移动+休息：只占行动不伤害', () => {
  const s = createInitialState(1)
  const b = makeBattle([unit(4, 'player', { x: 5, y: 5 })])
  const next = reduceBattle(withBattle(s, b), {
    type: 'act',
    officerId: 4,
    moveTo: { x: 7, y: 5 },
    terminal: { kind: 'rest' },
  })
  it('移动落点生效、acted=true', () => {
    expect(next.activeBattle!.units[4]!.pos).toEqual({ x: 7, y: 5 })
    expect(next.activeBattle!.units[4]!.acted).toBe(true)
  })
})

describe('checkImmediateVictory 城池格 / 全灭', () => {
  const city = cityTile(map)
  it('玩家进攻单位进入城池格 → 玩家胜', () => {
    const b = makeBattle([unit(4, 'player', city), unit(6, 'opponent', { x: 1, y: 1 })])
    expect(checkImmediateVictory(b, map)).toBe('playerWin')
  })
  it('对手方全灭 → 玩家胜', () => {
    const b = makeBattle([
      unit(4, 'player', { x: 5, y: 5 }),
      unit(6, 'opponent', { x: 6, y: 5 }, 0),
    ])
    expect(checkImmediateVictory(b, map)).toBe('playerWin')
  })
  it('玩家方全灭 → 玩家败', () => {
    const b = makeBattle([
      unit(4, 'player', { x: 5, y: 5 }, 0),
      unit(6, 'opponent', { x: 6, y: 5 }),
    ])
    expect(checkImmediateVictory(b, map)).toBe('playerLose')
  })
  it('攻方主将（首位）被击溃 → 玩家败（即便其余攻方单位存活）', () => {
    const b = makeBattle([
      unit(4, 'player', { x: 5, y: 5 }, 0), // 攻方主将阵亡
      unit(5, 'player', { x: 5, y: 6 }, 100), // 其余攻方存活
      unit(6, 'opponent', { x: 20, y: 20 }, 100),
    ])
    expect(checkImmediateVictory(b, map)).toBe('playerLose')
  })
})

describe('reduceBattle endDay：扣粮 + 日界判负', () => {
  const s = createInitialState(1)
  it('扣当日粮草后玩家方粮草归零 → 玩家败', () => {
    const b = makeBattle(
      [unit(4, 'player', { x: 5, y: 5 }, 100), unit(6, 'opponent', { x: 20, y: 20 })],
      { playerProvisions: 2 }
    )
    // 玩家方兵力100 → 耗粮 floor(sqrt(100)/3)=3 → 2-3=0
    const next = reduceBattle(withBattle(s, b), { type: 'endDay' })
    expect(next.activeBattle!.playerProvisions).toBe(0)
    expect(next.activeBattle!.outcome).toBe('playerLose')
  })
  it('天数推进并刷新行动；30 天后进攻方判败', () => {
    const b29 = makeBattle(
      [
        { ...unit(4, 'player', { x: 5, y: 5 }), acted: true },
        unit(6, 'opponent', { x: 20, y: 20 }),
      ],
      { day: 29 }
    )
    const mid = reduceBattle(withBattle(s, b29), { type: 'endDay' })
    expect(mid.activeBattle!.day).toBe(30)
    expect(mid.activeBattle!.units[4]!.acted).toBe(false) // startDay 刷新行动
    expect(mid.activeBattle!.outcome).toBeNull()
    const over = reduceBattle(mid, { type: 'endDay' })
    expect(over.activeBattle!.day).toBe(31)
    expect(over.activeBattle!.outcome).toBe('playerLose')
  })
})

describe('reduceBattle retreat → 玩家败', () => {
  const s = createInitialState(1)
  const b = makeBattle([unit(4, 'player', { x: 5, y: 5 })])
  it('全军撤退立即判玩家败', () => {
    expect(reduceBattle(withBattle(s, b), { type: 'retreat' }).activeBattle!.outcome).toBe(
      'playerLose'
    )
  })
})

describe('canBattle 非法守卫', () => {
  const s = createInitialState(1)
  const b = makeBattle([unit(4, 'player', { x: 5, y: 5 }), unit(6, 'opponent', { x: 20, y: 20 })])
  const st = withBattle(s, b)
  it('操作对手方单位非法', () => {
    expect(canBattle(st, { type: 'act', officerId: 6, terminal: { kind: 'rest' } }).ok).toBe(false)
  })
  it('攻击范围外目标非法', () => {
    expect(
      canBattle(st, {
        type: 'act',
        officerId: 4,
        terminal: { kind: 'attack', target: { x: 20, y: 20 } },
      }).ok
    ).toBe(false)
  })
  it('已行动单位再次行动非法（reduce no-op）', () => {
    const acted = makeBattle([{ ...unit(4, 'player', { x: 5, y: 5 }), acted: true }])
    const before = withBattle(s, acted)
    const after = reduceBattle(before, {
      type: 'act',
      officerId: 4,
      terminal: { kind: 'rest' },
    })
    expect(after).toBe(before)
  })
})

const withPersonal = (s: GameState, id: number, skills: number[]): GameState => ({
  ...s,
  officers: { ...s.officers, [id]: { ...s.officers[id]!, personalSkills: skills } },
})

describe('reduceBattle cast 施法（诸葛亮 intel100 → seed1 必中、seed2 必失）', () => {
  it('火攻命中：倍率链扣兵（500→260）+ 扣 MP + acted + 耗 rng', () => {
    const s = createInitialState(1)
    const b = makeBattle([
      unit(2, 'player', { x: 5, y: 5 }),
      unit(7, 'opponent', { x: 6, y: 5 }, 500),
    ])
    const next = reduceBattle(withBattle(s, b), {
      type: 'act',
      officerId: 2,
      terminal: { kind: 'cast', skillId: 5, target: { x: 6, y: 5 } },
    })
    const nb = next.activeBattle!
    expect(nb.units[7]!.troops).toBe(260) // effectValue(400,100,100,plain60,100)=240
    expect(nb.units[2]!.mp).toBe(85) // 100-15
    expect(nb.units[2]!.acted).toBe(true)
    expect(next.rng.seed).not.toBe(s.rng.seed)
  })
  it('火攻失败（seed2）：无伤害但仍扣 MP', () => {
    const s = createInitialState(2)
    const b = makeBattle([
      unit(2, 'player', { x: 5, y: 5 }),
      unit(7, 'opponent', { x: 6, y: 5 }, 500),
    ])
    const nb = reduceBattle(withBattle(s, b), {
      type: 'act',
      officerId: 2,
      terminal: { kind: 'cast', skillId: 5, target: { x: 6, y: 5 } },
    }).activeBattle!
    expect(nb.units[7]!.troops).toBe(500)
    expect(nb.units[2]!.mp).toBe(85)
  })
  it('天变（self）：刷新天气 + 扣 MP', () => {
    const s = createInitialState(1)
    const b = makeBattle([unit(2, 'player', { x: 5, y: 5 }), unit(6, 'opponent', { x: 20, y: 20 })])
    const next = reduceBattle(withBattle(s, b), {
      type: 'act',
      officerId: 2,
      terminal: { kind: 'cast', skillId: 22 },
    })
    expect(WEATHER_ORDER).toContain(next.activeBattle!.weather)
    expect(next.activeBattle!.units[2]!.mp).toBe(90) // 100-10
  })
  it('石阵：施加状态、不扣兵', () => {
    const s = createInitialState(1)
    const b = makeBattle([
      unit(2, 'player', { x: 5, y: 5 }),
      unit(7, 'opponent', { x: 6, y: 5 }, 500),
    ])
    const nb = reduceBattle(withBattle(s, b), {
      type: 'act',
      officerId: 2,
      terminal: { kind: 'cast', skillId: 23, target: { x: 6, y: 5 } },
    }).activeBattle!
    expect(nb.units[7]!.status).toBe('stone')
    expect(nb.units[7]!.troops).toBe(500)
    expect(nb.units[2]!.mp).toBe(80) // 100-20
  })
  it('援兵（friendly heal）：封顶带兵量补兵（100→900）', () => {
    const s = withPersonal(createInitialState(1), 2, [17])
    const b = makeBattle([
      unit(2, 'player', { x: 5, y: 5 }),
      unit(4, 'player', { x: 6, y: 5 }, 100),
      unit(6, 'opponent', { x: 20, y: 20 }),
    ])
    const nb = reduceBattle(withBattle(s, b), {
      type: 'act',
      officerId: 2,
      terminal: { kind: 'cast', skillId: 17, target: { x: 6, y: 5 } },
    }).activeBattle!
    expect(nb.units[4]!.troops).toBe(900) // 100 + effectValue(800,100,100,100,100)=800（cap=1350）
  })
  it('火箭（破粮）：扣对手战场粮草（1000→850）', () => {
    const s = withPersonal(createInitialState(1), 2, [11])
    const b = makeBattle([
      unit(2, 'player', { x: 8, y: 4 }),
      unit(7, 'opponent', { x: 8, y: 1 }), // 原版地图 1 的村庄格
    ])
    const nb = reduceBattle(withBattle(s, b), {
      type: 'act',
      officerId: 2,
      terminal: { kind: 'cast', skillId: 11, target: { x: 8, y: 1 } },
    }).activeBattle!
    expect(nb.opponentProvisions).toBe(850) // effectValue(150,…)=150
  })
  it('围攻：目标四邻友军逐个普攻、友军获经验', () => {
    const s = withPersonal(createInitialState(1), 2, [27])
    const b = makeBattle([
      unit(2, 'player', { x: 6, y: 3 }),
      unit(4, 'player', { x: 5, y: 5 }),
      unit(5, 'player', { x: 7, y: 5 }),
      unit(7, 'opponent', { x: 6, y: 5 }, 500),
    ])
    const nb = reduceBattle(withBattle(s, b), {
      type: 'act',
      officerId: 2,
      terminal: { kind: 'cast', skillId: 27, target: { x: 6, y: 5 } },
    }).activeBattle!
    expect(nb.units[7]!.troops).toBeLessThan(500)
    expect(nb.units[4]!.experience).toBeGreaterThan(0)
    expect(nb.units[5]!.experience).toBeGreaterThan(0)
  })
})

describe('canBattle 施法守卫', () => {
  const s = createInitialState(1)
  it('禁咒状态不能施法', () => {
    const b = makeBattle([
      { ...unit(2, 'player', { x: 5, y: 5 }), status: 'sealed' },
      unit(7, 'opponent', { x: 6, y: 5 }),
    ])
    expect(
      canBattle(withBattle(s, b), {
        type: 'act',
        officerId: 2,
        terminal: { kind: 'cast', skillId: 5, target: { x: 6, y: 5 } },
      }).ok
    ).toBe(false)
  })
  it('未掌握的技能不能施放（诸葛亮无骑兵践踏）', () => {
    const b = makeBattle([unit(2, 'player', { x: 5, y: 5 }), unit(7, 'opponent', { x: 6, y: 5 })])
    expect(
      canBattle(withBattle(s, b), {
        type: 'act',
        officerId: 2,
        terminal: { kind: 'cast', skillId: 1, target: { x: 6, y: 5 } },
      }).ok
    ).toBe(false)
  })
  it('MP 不足不能施放', () => {
    const b = makeBattle([
      { ...unit(2, 'player', { x: 5, y: 5 }), mp: 5 },
      unit(7, 'opponent', { x: 6, y: 5 }),
    ])
    expect(
      canBattle(withBattle(s, b), {
        type: 'act',
        officerId: 2,
        terminal: { kind: 'cast', skillId: 5, target: { x: 6, y: 5 } },
      }).ok
    ).toBe(false)
  })
  it('混乱状态不能行动（含施法/普攻）', () => {
    const b = makeBattle([
      { ...unit(4, 'player', { x: 5, y: 5 }), status: 'confused' },
      unit(6, 'opponent', { x: 6, y: 5 }),
    ])
    expect(
      canBattle(withBattle(s, b), {
        type: 'act',
        officerId: 4,
        terminal: { kind: 'attack', target: { x: 6, y: 5 } },
      }).ok
    ).toBe(false)
  })
})

describe('startDay 每日开头', () => {
  const s = createInitialState(1)
  it('刷新天气（消耗 rng）+ 重置当日行动', () => {
    const b = makeBattle([
      { ...unit(4, 'player', { x: 5, y: 5 }), acted: true },
      unit(6, 'opponent', { x: 20, y: 20 }),
    ])
    const next = startDay(withBattle(s, b))
    expect(WEATHER_ORDER).toContain(next.activeBattle!.weather)
    expect(next.rng.seed).not.toBe(s.rng.seed)
    expect(next.activeBattle!.units[4]!.acted).toBe(false)
  })
  it('石阵单位先损兵 1/8（800→700）', () => {
    const b = makeBattle([
      { ...unit(4, 'player', { x: 5, y: 5 }, 800), status: 'stone' },
      unit(6, 'opponent', { x: 20, y: 20 }),
    ])
    const next = startDay(withBattle(s, b))
    expect(next.activeBattle!.units[4]!.troops).toBe(700)
  })
  it('day>30 → 进攻方判败', () => {
    const b = makeBattle([unit(4, 'player', { x: 5, y: 5 })], { day: 31 })
    expect(startDay(withBattle(s, b)).activeBattle!.outcome).toBe('playerLose')
  })
  it('日界查粮草：玩家方粮草为 0 → 判败', () => {
    const b = makeBattle(
      [unit(4, 'player', { x: 5, y: 5 }), unit(6, 'opponent', { x: 20, y: 20 })],
      { day: 2, playerProvisions: 0 }
    )
    expect(startDay(withBattle(s, b)).activeBattle!.outcome).toBe('playerLose')
  })
})

describe('concludeBattle 写回 + 组装 CampaignOutcome（攻方胜）', () => {
  const s = createInitialState(1)
  const b = makeBattle(
    [
      unit(4, 'player', { x: 28, y: 16 }, 55, { experience: 40, level: 2 }),
      unit(5, 'player', { x: 5, y: 5 }, 80),
      unit(6, 'opponent', { x: 6, y: 5 }, 0),
      unit(7, 'opponent', { x: 7, y: 5 }, 30),
      unit(8, 'opponent', { x: 8, y: 5 }, 30),
    ],
    { outcome: 'playerWin', playerProvisions: 120, opponentProvisions: 300 }
  )
  const next = concludeBattle(withBattle(s, b)).state
  it('胜方单位兵力/经验/等级写回 Officer 并进驻目标城', () => {
    expect(next.officers[4]!.troops).toBe(55)
    expect(next.officers[4]!.experience).toBe(40)
    expect(next.officers[4]!.level).toBe(2)
    expect(next.officers[4]!.cityId).toBe(3)
  })
  it('占城：许昌归刘备；粮草覆盖式合并（双方剩余战场粮之和）；无条件战损', () => {
    expect(next.cities[3]!.lordId).toBe(1)
    expect(next.cities[3]!.food).toBe(120 + 300) // 覆盖式合并，非累加
    expect(next.cities[3]!.agriculture).toBe(Math.floor(350 * 0.95)) // 战损
  })
  it('activeBattle 清空', () => {
    expect(next.activeBattle).toBeNull()
  })
})

describe('endDay 对手方（AI）行动（17-battle-ai）', () => {
  // 玩家进攻许昌（attack 模式）：曹操=对手方守军，邻接玩家主将关羽。
  // 把曹操属性压低、兵力远超带兵量 → 必跳技能筛、走普攻、扑主将关羽。
  const base = createInitialState(1)
  const s: GameState = {
    ...base,
    officers: {
      ...base.officers,
      6: {
        ...base.officers[6]!,
        force: 1,
        intelligence: 1,
        level: 1,
        troopType: 'cavalry',
      },
    },
  }
  const b = makeBattle([
    unit(4, 'player', { x: 5, y: 5 }, 100),
    unit(6, 'opponent', { x: 6, y: 5 }, 3000),
  ])
  const after = reduceBattle(withBattle(s, b), { type: 'endDay' })

  it('AI 守军普攻玩家主将 → 关羽掉兵', () => {
    expect(after.activeBattle!.units[4]!.troops).toBeLessThan(100)
  })
  it('未分胜负则推进到第 2 天', () => {
    expect(after.activeBattle!.day).toBe(2)
    expect(after.activeBattle!.outcome).toBeNull()
  })
  it('对手静止旧假设已不成立：endDay 不再是 no-op', () => {
    const stillFull = after.activeBattle!.units[4]!.troops === 100
    expect(stillFull).toBe(false)
  })
})
