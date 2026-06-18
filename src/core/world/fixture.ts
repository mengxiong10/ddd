import type { DebutEntry, GameState } from '../game-state'
import type { City } from './city'
import type { Officer, Personality } from './officer'
import { STAMINA_MAX } from './officer'
import type { Item } from './item'
import type { TroopType, TroopTypeOverride } from './troop-type'
import type { CityId, ItemId, OfficerId } from '../shared/ids'
import { createRng } from '../shared/rng'
import { buildAdjacency } from './adjacency'
import { DEFAULT_MAP_ID } from '../military/battle-map'

/** 起始年份（公元 189 年，东汉末）。 */
const START_YEAR = 189
/** fixture 中每城的农业/商业上限默认值。 */
const DEFAULT_CAP = 1000
/** 新字段统一 mock 值（不逐人配，凸显占位、待后续平衡）。 */
const MOCK_CITY_LOYALTY = 50
const MOCK_RESERVE_TROOPS = 0
/** 初始防灾值统一 mock（不逐城配，待平衡阶段再调）。 */
const MOCK_DISASTER_PREVENTION = 50
const MOCK_LEVEL = 1
const MOCK_FORCE = 50
const MOCK_TROOPS = 100
/** 武将忠诚 mock：君主恒 100（亦由 officerLoyalty 派生保证），其余 50。 */
const MOCK_LORD_LOYALTY = 100
const MOCK_OFFICER_LOYALTY = 50

interface OfficerSeed {
  readonly id: OfficerId
  readonly name: string
  readonly intelligence: number
  /** 性格 0..4（君主取君主表含义、普通取普通表含义）。 */
  readonly personality: Personality
  /** 基础兵种（mock 占位，待平衡）。 */
  readonly troopType: TroopType
  /** 个人技能 id（战斗技能，默认 []）。 */
  readonly personalSkills?: readonly number[]
}

interface CitySeed {
  readonly id: CityId
  readonly name: string
  readonly lordId: OfficerId
  readonly agriculture: number
  readonly commerce: number
  readonly gold: number
  readonly food: number
  readonly population: number
  readonly officers: readonly OfficerSeed[]
}

const PLAYER_LORD: OfficerId = 'liubei'

/** 初始道具：均归属城（holder=城），待玩家赏赐给武将。数值为可调默认。 */
interface ItemSeed {
  readonly id: ItemId
  readonly name: string
  readonly forceBonus: number
  readonly intelBonus: number
  readonly movementBonus: number
  readonly troopTypeOverride: TroopTypeOverride
  readonly cityId: CityId
}

const ITEM_SEEDS: readonly ItemSeed[] = [
  { id: 'cixiongshuanggujian', name: '雌雄双股剑', forceBonus: 10, intelBonus: 0, movementBonus: 0, troopTypeOverride: 0, cityId: 'chengdu' },
  { id: 'mengde-xinshu', name: '孟德新书', forceBonus: 0, intelBonus: 10, movementBonus: 0, troopTypeOverride: 0, cityId: 'xuchang' },
]

/**
 * 待登场池播种（未登场武将/道具）：到达 debutYear 后于月末登场。
 * targetCityId=null 表示登场时随机落城。officer 的 lordId=null（无主/在野）、troops=0；
 * item 的 discovered=false（未发现）。recruiterId=null 表示无指定伯乐。
 */
const DEBUT_OFFICER_SEEDS: readonly {
  readonly id: OfficerId
  readonly name: string
  readonly intelligence: number
  readonly force: number
  readonly debutYear: number
  readonly targetCityId: CityId | null
  readonly recruiterId: OfficerId | null
  readonly personality: Personality
  readonly troopType: TroopType
}[] = [
  // 赵云：指定登场江陵，无指定伯乐（按执行人智力判定）。
  { id: 'zhaoyun', name: '赵云', intelligence: 76, force: 96, debutYear: 191, targetCityId: 'jiangling', recruiterId: null, personality: 0, troopType: 'cavalry' }, // 忠义
  // 姜维：随机落城，伯乐=诸葛亮（仅诸葛亮搜寻必中）。
  { id: 'jiangwei', name: '姜维', intelligence: 92, force: 88, debutYear: 192, targetCityId: null, recruiterId: 'zhugeliang', personality: 1, troopType: 'cavalry' }, // 大志
]

const DEBUT_ITEM_SEEDS: readonly {
  readonly id: ItemId
  readonly name: string
  readonly forceBonus: number
  readonly intelBonus: number
  readonly movementBonus: number
  readonly troopTypeOverride: TroopTypeOverride
  readonly debutYear: number
  readonly targetCityId: CityId | null
  readonly recruiterId: OfficerId | null
}[] = [
  // 青釭剑：指定登场许昌，无指定伯乐。
  { id: 'qinggangjian', name: '青釭剑', forceBonus: 12, intelBonus: 0, movementBonus: 0, troopTypeOverride: 0, debutYear: 191, targetCityId: 'xuchang', recruiterId: null },
]

/**
 * 城邻接边（无向）：成都-江陵（刘备内部）、江陵-许昌（跨势力前线）、许昌-邺城（曹操内部）。
 * 保证玩家江陵与曹操许昌相邻可攻。
 */
const ADJACENCY_EDGES: readonly (readonly [CityId, CityId])[] = [
  ['chengdu', 'jiangling'],
  ['jiangling', 'xuchang'],
  ['xuchang', 'ye'],
]

const CITY_SEEDS: readonly CitySeed[] = [
  {
    id: 'chengdu', name: '成都', lordId: 'liubei',
    agriculture: 300, commerce: 200, gold: 500, food: 400, population: 30000,
    officers: [
      { id: 'liubei', name: '刘备', intelligence: 75, personality: 1, troopType: 'cavalry' }, // 君主·大义
      { id: 'zhugeliang', name: '诸葛亮', intelligence: 100, personality: 0, troopType: 'infantry', personalSkills: [22, 23] }, // 忠义·天变/石阵
      { id: 'pangtong', name: '庞统', intelligence: 90, personality: 1, troopType: 'infantry' }, // 大志
    ],
  },
  {
    id: 'jiangling', name: '江陵', lordId: 'liubei',
    agriculture: 250, commerce: 280, gold: 400, food: 300, population: 25000,
    officers: [
      { id: 'guanyu', name: '关羽', intelligence: 75, personality: 0, troopType: 'cavalry' }, // 忠义
      { id: 'zhangfei', name: '张飞', intelligence: 60, personality: 4, troopType: 'cavalry' }, // 卤莽
    ],
  },
  {
    id: 'xuchang', name: '许昌', lordId: 'caocao',
    agriculture: 350, commerce: 320, gold: 600, food: 500, population: 40000,
    officers: [
      { id: 'caocao', name: '曹操', intelligence: 90, personality: 2, troopType: 'cavalry' }, // 君主·奸诈
      { id: 'xunyu', name: '荀彧', intelligence: 95, personality: 0, troopType: 'infantry' }, // 忠义
      { id: 'guojia', name: '郭嘉', intelligence: 98, personality: 1, troopType: 'infantry' }, // 大志
    ],
  },
  {
    id: 'ye', name: '邺城', lordId: 'caocao',
    agriculture: 300, commerce: 260, gold: 450, food: 350, population: 35000,
    officers: [
      { id: 'simayi', name: '司马懿', intelligence: 96, personality: 1, troopType: 'infantry' }, // 大志
      { id: 'zhangliao', name: '张辽', intelligence: 70, personality: 0, troopType: 'cavalry' }, // 忠义
    ],
  },
]

/**
 * 构造最小固定初始局面（玩家=刘备、AI=曹操，各 2 城）。
 * seed 注入 RNG 以便整段对局可复现；数值为可调默认，平衡后再说。
 */
export function createInitialState(seed: number): GameState {
  const cities: Record<CityId, City> = {}
  const officers: Record<OfficerId, Officer> = {}
  const items: Record<ItemId, Item> = {}

  for (const cs of CITY_SEEDS) {
    cities[cs.id] = {
      id: cs.id, name: cs.name, lordId: cs.lordId,
      agriculture: cs.agriculture, commerce: cs.commerce,
      agricultureCap: DEFAULT_CAP, commerceCap: DEFAULT_CAP,
      gold: cs.gold, food: cs.food,
      loyalty: MOCK_CITY_LOYALTY, reserveTroops: MOCK_RESERVE_TROOPS,
      population: cs.population,
      status: 'normal', disasterPrevention: MOCK_DISASTER_PREVENTION,
      battleMapId: DEFAULT_MAP_ID,
    }
    for (const os of cs.officers) {
      officers[os.id] = {
        id: os.id, name: os.name, intelligence: os.intelligence,
        lordId: cs.lordId, cityId: cs.id, stamina: STAMINA_MAX, busy: false,
        troops: MOCK_TROOPS, level: MOCK_LEVEL, force: MOCK_FORCE,
        loyalty: os.id === cs.lordId ? MOCK_LORD_LOYALTY : MOCK_OFFICER_LOYALTY,
        recruiterId: null, personality: os.personality, troopType: os.troopType,
        experience: 0, personalSkills: os.personalSkills ?? [],
      }
    }
  }

  for (const is of ITEM_SEEDS) {
    items[is.id] = {
      id: is.id, name: is.name, forceBonus: is.forceBonus, intelBonus: is.intelBonus,
      movementBonus: is.movementBonus, troopTypeOverride: is.troopTypeOverride,
      holder: { kind: 'city', cityId: is.cityId },
      discovered: true, recruiterId: null,
    }
  }

  // 待登场池：officer 用 Omit<…,'cityId'>（lordId=null、troops=0），item 用 Omit<…,'holder'>（discovered=false）。
  const pendingDebuts: DebutEntry[] = [
    ...DEBUT_OFFICER_SEEDS.map((s): DebutEntry => ({
      type: 'officer',
      debutYear: s.debutYear,
      targetCityId: s.targetCityId,
      officer: {
        id: s.id, name: s.name, intelligence: s.intelligence,
        lordId: null, stamina: STAMINA_MAX, busy: false,
        troops: 0, level: MOCK_LEVEL, force: s.force,
        loyalty: MOCK_OFFICER_LOYALTY, recruiterId: s.recruiterId, personality: s.personality,
        troopType: s.troopType, experience: 0, personalSkills: [],
      },
    })),
    ...DEBUT_ITEM_SEEDS.map((s): DebutEntry => ({
      type: 'item',
      debutYear: s.debutYear,
      targetCityId: s.targetCityId,
      item: {
        id: s.id, name: s.name, forceBonus: s.forceBonus, intelBonus: s.intelBonus,
        movementBonus: s.movementBonus, troopTypeOverride: s.troopTypeOverride,
        discovered: false, recruiterId: s.recruiterId,
      },
    })),
  ]

  return {
    year: START_YEAR,
    month: 1,
    playerLordId: PLAYER_LORD,
    cities,
    officers,
    items,
    rng: createRng(seed),
    pendingCommands: [],
    pendingDebuts,
    adjacency: buildAdjacency(ADJACENCY_EDGES),
    activeBattle: null,
  }
}
