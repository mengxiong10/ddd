import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import type { Officer } from '../world/officer'
import type { Position } from '../shared/position'
import { DEFAULT_MAP_ID } from './battle-map'
import type { BattleState, BattleUnit, BattleSide } from './battle-core'
import { nextOpponentAction } from './battle-ai'

const map = createInitialState(1).battleMaps[DEFAULT_MAP_ID]!
const CITY = map.cityTiles[0]!

function mkOfficer(id: number, over: Partial<Officer> = {}): Officer {
  return {
    id,
    name: String(id),
    intelligence: 50,
    lordId: 200,
    cityId: 200,
    stamina: 100,
    troops: 100,
    level: 1,
    force: 50,
    loyalty: 50,
    appearanceConditions: { birth: 0, recruiterId: null, cityId: null },
    personality: 0,
    troopType: 'cavalry',
    experience: 0,
    personalSkills: [],
    ...over,
  }
}

function withOfficers(s: GameState, officers: Officer[]): GameState {
  return {
    ...s,
    officers: { ...s.officers, ...Object.fromEntries(officers.map((o) => [o.id, o])) },
  }
}

function unit(
  officerId: number,
  side: BattleSide,
  pos: Position,
  extra: Partial<BattleUnit> = {}
): BattleUnit {
  return {
    officerId,
    side,
    pos,
    troops: 100,
    experience: 0,
    level: 1,
    acted: false,
    mp: 100,
    maxMp: 100,
    status: 'normal',
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
    attackerCommanderId: 100,
    defenderCommanderId: 100,
    outcome: null,
    targetCityId: 3,
    ...over,
  }
}
const withBattle = (s: GameState, b: BattleState): GameState => ({ ...s, activeBattle: b })

describe('nextOpponentAction 守卫', () => {
  it('无战斗 → null', () => {
    expect(nextOpponentAction(createInitialState(1))).toBeNull()
  })
  it('已分胜负 → null', () => {
    const s = withOfficers(createInitialState(1), [mkOfficer(100), mkOfficer(101)])
    const b = makeBattle(
      [unit(100, 'player', { x: 5, y: 5 }), unit(101, 'opponent', { x: 6, y: 5 })],
      {
        outcome: 'playerWin',
      }
    )
    expect(nextOpponentAction(withBattle(s, b))).toBeNull()
  })
  it('无可动对手单位（全已行动/混乱/石阵）→ null', () => {
    const s = withOfficers(createInitialState(1), [mkOfficer(100), mkOfficer(101), mkOfficer(102)])
    const b = makeBattle([
      unit(100, 'player', { x: 5, y: 5 }),
      unit(101, 'opponent', { x: 6, y: 5 }, { acted: true }),
      unit(102, 'opponent', { x: 7, y: 5 }, { status: 'confused' }),
    ])
    expect(nextOpponentAction(withBattle(s, b))).toBeNull()
  })
})

describe('选将（§7.2）：离目标点曼哈顿最小', () => {
  it('attack 模式取离玩家主将更近的对手单位', () => {
    const s = withOfficers(createInitialState(1), [mkOfficer(100), mkOfficer(101), mkOfficer(102)])
    const b = makeBattle([
      unit(100, 'player', { x: 5, y: 5 }),
      unit(102, 'opponent', { x: 5, y: 20 }), // 远
      unit(101, 'opponent', { x: 5, y: 8 }), // 近
    ])
    const r = nextOpponentAction(withBattle(s, b))!
    expect(r.action.officerId).toBe(101)
  })
})

describe('选落点（§7.4）', () => {
  it('已站城池格 → 原地不动（无 moveTo）', () => {
    const s = withOfficers(createInitialState(1), [mkOfficer(100), mkOfficer(101)])
    const b = makeBattle([unit(100, 'player', { x: 5, y: 5 }), unit(101, 'opponent', { ...CITY })])
    const r = nextOpponentAction(withBattle(s, b))!
    expect(r.action.moveTo).toBeUndefined()
  })

  it('defend 模式可达城池格 → 进城（moveTo=城池格）', () => {
    const s = withOfficers(createInitialState(1), [mkOfficer(104), mkOfficer(101)])
    const b = makeBattle(
      [unit(104, 'player', { x: 5, y: 5 }), unit(101, 'opponent', { x: CITY.x, y: CITY.y + 2 })],
      { mode: 'defend', attackerCommanderId: 101, defenderCommanderId: 104 }
    )
    const r = nextOpponentAction(withBattle(s, b))!
    expect(r.action.moveTo).toEqual(CITY)
  })
})

describe('终结动作（§7.6/§7.7）', () => {
  it('攻击优先：兵力远超带兵量 → 跳过技能、普攻最近敌方', () => {
    // cap(cavalry, force50/intel50/lv1)=1100；troops=3000 > floor(1100*1.5) → 兵力筛恒跳过技能。
    const s = withOfficers(createInitialState(1), [mkOfficer(100), mkOfficer(103), mkOfficer(101)])
    const b = makeBattle([
      unit(100, 'player', { x: 25, y: 25 }), // 主将（远、够不到）
      unit(103, 'player', { x: 5, y: 5 }), // 普通敌方
      unit(101, 'opponent', { x: 6, y: 5 }, { troops: 3000 }),
    ])
    const r = nextOpponentAction(withBattle(s, b))!
    expect(r.action.terminal.kind).toBe('attack')
    if (r.action.terminal.kind === 'attack')
      expect(r.action.terminal.target).toEqual({ x: 5, y: 5 })
  })

  it('孤立无敌、技能无目标 → 休息', () => {
    const s = withOfficers(createInitialState(1), [mkOfficer(100), mkOfficer(101)])
    const b = makeBattle([
      unit(100, 'player', { x: 25, y: 25 }),
      unit(101, 'opponent', { x: 3, y: 3 }),
    ])
    const r = nextOpponentAction(withBattle(s, b))!
    expect(r.action.terminal.kind).toBe('rest')
  })

  it('玄兵技能优先：高智力过筛 + 范围内敌方 → 施法（最佳=高序号优先）', () => {
    // 玄兵免兵力筛；intelligence=149 → 智力筛 r1≤149 必过。level1 玄兵仅解锁技能 14（咒封，敌方）。
    const s = withOfficers(createInitialState(1), [
      mkOfficer(100, { intelligence: 50 }),
      mkOfficer(101, { troopType: 'mystic', intelligence: 149 }),
    ])
    const b = makeBattle([
      unit(100, 'player', { x: 8, y: 5 }), // 距 a1 曼哈顿 3，在咒封 r3 菱形内
      unit(101, 'opponent', { x: 5, y: 5 }, { mp: 100 }),
    ])
    const r = nextOpponentAction(withBattle(s, b))!
    expect(r.action.terminal.kind).toBe('cast')
    if (r.action.terminal.kind === 'cast') {
      expect(r.action.terminal.skillId).toBe(14)
      expect(r.action.terminal.target).toEqual({ x: 8, y: 5 })
    }
  })

  it('主将在普攻范围 → 无条件优先打主将', () => {
    const s = withOfficers(createInitialState(1), [mkOfficer(100), mkOfficer(103), mkOfficer(101)])
    // a1 同时邻接主将 pcmd 与普通 p1；应选打主将。
    const b = makeBattle([
      unit(100, 'player', { x: 5, y: 5 }),
      unit(103, 'player', { x: 7, y: 6 }),
      unit(101, 'opponent', { x: 6, y: 5 }, { troops: 3000 }),
    ])
    const r = nextOpponentAction(withBattle(s, b))!
    expect(r.action.terminal.kind).toBe('attack')
    if (r.action.terminal.kind === 'attack')
      expect(r.action.terminal.target).toEqual({ x: 5, y: 5 })
  })
})

describe('治疗筛（§7.7）：只给损失≥1/4 兵力的友军', () => {
  // a1 玄兵带个人技能 17（援兵，友方恢复）；范围内无敌方（仅默认 14 无目标）。
  const baseOfficers = [
    mkOfficer(100, { intelligence: 50 }),
    mkOfficer(101, { troopType: 'mystic', intelligence: 149, personalSkills: [17] }),
    mkOfficer(102, { troopType: 'mystic', intelligence: 50 }),
  ]
  const aA1 = { x: 6, y: 5 }
  const aA2 = { x: 5, y: 5 }
  function scenario(allyTroops: number) {
    const s = withOfficers(createInitialState(1), baseOfficers)
    const b = makeBattle([
      unit(100, 'player', { x: 25, y: 25 }), // 远，无敌在范围
      // rooted=移动力 1：a1 几乎不挪窝，友军始终留在援兵范围内（隔离「选位不为治疗服务」的干扰）
      unit(101, 'opponent', aA1, { mp: 100, status: 'rooted' }),
      unit(102, 'opponent', aA2, { troops: allyTroops }),
    ])
    return nextOpponentAction(withBattle(s, b))!
  }
  it('友军满编（损失 < 1/4）→ 不施治疗 → 休息', () => {
    // a2 cap=1100，满编 → 援兵无目标；无敌方 → 14 无目标 → 休息。
    const r = scenario(1100)
    expect(r.action.officerId).toBe(101)
    expect(r.action.terminal.kind).toBe('rest')
  })
  it('友军损失≥1/4 → 施援兵于该友军', () => {
    const r = scenario(100) // 损失 1000 ≥ floor(1100/4)=275
    expect(r.action.officerId).toBe(101)
    expect(r.action.terminal.kind).toBe('cast')
    if (r.action.terminal.kind === 'cast') {
      expect(r.action.terminal.skillId).toBe(17)
      expect(r.action.terminal.target).toEqual(aA2)
    }
  })
})

describe('确定性', () => {
  it('同 state（同 seed）多次调用结果一致', () => {
    const s = withOfficers(createInitialState(7), [
      mkOfficer(100, { intelligence: 80 }),
      mkOfficer(101, { troopType: 'mystic', intelligence: 80 }),
    ])
    const b = makeBattle([
      unit(100, 'player', { x: 8, y: 5 }),
      unit(101, 'opponent', { x: 5, y: 5 }, { mp: 100, troops: 80 }),
    ])
    const r1 = nextOpponentAction(withBattle(s, b))!
    const r2 = nextOpponentAction(withBattle(s, b))!
    expect(r1.action).toEqual(r2.action)
    expect(r1.state.rng.seed).toBe(r2.state.rng.seed)
  })
})
