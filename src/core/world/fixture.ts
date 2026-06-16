import type { GameState } from '../game-state'
import type { City } from './city'
import type { Officer } from './officer'
import { STAMINA_MAX } from './officer'
import type { CityId, OfficerId } from '../shared/ids'
import { createRng } from '../shared/rng'

/** 起始年份（公元 189 年，东汉末）。 */
const START_YEAR = 189
/** fixture 中每城的农业/商业上限默认值。 */
const DEFAULT_CAP = 1000
/** 新字段统一 mock 值（不逐人配，凸显占位、待后续平衡）。 */
const MOCK_LOYALTY = 50
const MOCK_RESERVE_TROOPS = 0
const MOCK_LEVEL = 1
const MOCK_FORCE = 50
const MOCK_TROOPS = 100

interface OfficerSeed {
  readonly id: OfficerId
  readonly name: string
  readonly intelligence: number
}

interface CitySeed {
  readonly id: CityId
  readonly name: string
  readonly lordId: OfficerId
  readonly agriculture: number
  readonly commerce: number
  readonly gold: number
  readonly food: number
  readonly officers: readonly OfficerSeed[]
}

const PLAYER_LORD: OfficerId = 'liubei'

const CITY_SEEDS: readonly CitySeed[] = [
  {
    id: 'chengdu', name: '成都', lordId: 'liubei',
    agriculture: 300, commerce: 200, gold: 500, food: 400,
    officers: [
      { id: 'liubei', name: '刘备', intelligence: 75 },
      { id: 'zhugeliang', name: '诸葛亮', intelligence: 100 },
      { id: 'pangtong', name: '庞统', intelligence: 90 },
    ],
  },
  {
    id: 'jiangling', name: '江陵', lordId: 'liubei',
    agriculture: 250, commerce: 280, gold: 400, food: 300,
    officers: [
      { id: 'guanyu', name: '关羽', intelligence: 75 },
      { id: 'zhangfei', name: '张飞', intelligence: 60 },
    ],
  },
  {
    id: 'xuchang', name: '许昌', lordId: 'caocao',
    agriculture: 350, commerce: 320, gold: 600, food: 500,
    officers: [
      { id: 'caocao', name: '曹操', intelligence: 90 },
      { id: 'xunyu', name: '荀彧', intelligence: 95 },
      { id: 'guojia', name: '郭嘉', intelligence: 98 },
    ],
  },
  {
    id: 'ye', name: '邺城', lordId: 'caocao',
    agriculture: 300, commerce: 260, gold: 450, food: 350,
    officers: [
      { id: 'simayi', name: '司马懿', intelligence: 96 },
      { id: 'zhangliao', name: '张辽', intelligence: 70 },
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

  for (const cs of CITY_SEEDS) {
    cities[cs.id] = {
      id: cs.id, name: cs.name, lordId: cs.lordId,
      agriculture: cs.agriculture, commerce: cs.commerce,
      agricultureCap: DEFAULT_CAP, commerceCap: DEFAULT_CAP,
      gold: cs.gold, food: cs.food,
      loyalty: MOCK_LOYALTY, reserveTroops: MOCK_RESERVE_TROOPS,
    }
    for (const os of cs.officers) {
      officers[os.id] = {
        id: os.id, name: os.name, intelligence: os.intelligence,
        lordId: cs.lordId, cityId: cs.id, stamina: STAMINA_MAX, busy: false,
        troops: MOCK_TROOPS, level: MOCK_LEVEL, force: MOCK_FORCE,
      }
    }
  }

  return {
    year: START_YEAR,
    month: 1,
    playerLordId: PLAYER_LORD,
    cities,
    officers,
    rng: createRng(seed),
    pendingCommands: [],
  }
}
