import type { GameState } from '../game-state'
import type { City } from './city'
import type { Officer, Personality } from './officer'
import { STAMINA_MAX } from './officer'
import type { Item } from './item'
import type { TroopType, TroopTypeOverride } from './troop-type'
import type { CityId, ItemId, OfficerId } from '../shared/ids'
import { createRng } from '../shared/rng'
import { buildAdjacency } from './adjacency'
import {
  createBattleMapCatalog,
  DEFAULT_MAP_ID,
  GRID_SIZE,
  type Terrain,
} from '../military/battle-map'
import { DEFAULT_APPEARANCE } from './appearance'

const START_YEAR = 189
const DEFAULT_CAP = 1000
const MOCK_CITY_LOYALTY = 50
const MOCK_RESERVE_TROOPS = 0
const MOCK_DISASTER_PREVENTION = 50
const MOCK_LEVEL = 1
const MOCK_FORCE = 50
const MOCK_TROOPS = 100
const MOCK_LORD_LOYALTY = 100
const MOCK_OFFICER_LOYALTY = 50

function fixtureBattleMaps() {
  const tiles: Terrain[] = new Array(GRID_SIZE * GRID_SIZE).fill('plain')
  const set = (x: number, y: number, terrain: Terrain) => {
    tiles[y * GRID_SIZE + x] = terrain
  }
  for (let y = 0; y < GRID_SIZE; y += 1) {
    if (y < 14 || y > 17) {
      set(10, y, 'river')
      set(21, y, 'river')
    }
  }
  for (let y = 12; y <= 19; y += 1) {
    for (let x = 14; x <= 17; x += 1) set(x, y, 'mountain')
  }
  for (let y = 10; y <= 21; y += 1) {
    set(13, y, 'forest')
    set(18, y, 'forest')
  }
  set(8, 1, 'village')
  set(27, 16, 'camp')
  set(28, 16, 'city')
  return createBattleMapCatalog([
    { id: DEFAULT_MAP_ID, width: GRID_SIZE, height: GRID_SIZE, tiles },
  ])
}

interface OfficerSeed {
  readonly id: OfficerId
  readonly name: string
  readonly intelligence: number
  readonly personality: Personality
  readonly troopType: TroopType
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

const PLAYER_LORD: OfficerId = 1

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
  {
    id: 1,
    name: '雌雄双股剑',
    forceBonus: 10,
    intelBonus: 0,
    movementBonus: 0,
    troopTypeOverride: 0,
    cityId: 1,
  },
  {
    id: 2,
    name: '孟德新书',
    forceBonus: 0,
    intelBonus: 10,
    movementBonus: 0,
    troopTypeOverride: 0,
    cityId: 3,
  },
]

const ADJACENCY_EDGES: readonly (readonly [CityId, CityId])[] = [
  [1, 2],
  [2, 3],
  [3, 4],
]

const CITY_SEEDS: readonly CitySeed[] = [
  {
    id: 1,
    name: '成都',
    lordId: 1,
    agriculture: 300,
    commerce: 200,
    gold: 500,
    food: 400,
    population: 30000,
    officers: [
      { id: 1, name: '刘备', intelligence: 75, personality: 1, troopType: 'cavalry' },
      {
        id: 2,
        name: '诸葛亮',
        intelligence: 100,
        personality: 0,
        troopType: 'infantry',
        personalSkills: [22, 23],
      },
      { id: 3, name: '庞统', intelligence: 90, personality: 1, troopType: 'infantry' },
    ],
  },
  {
    id: 2,
    name: '江陵',
    lordId: 1,
    agriculture: 250,
    commerce: 280,
    gold: 400,
    food: 300,
    population: 25000,
    officers: [
      { id: 4, name: '关羽', intelligence: 75, personality: 0, troopType: 'cavalry' },
      { id: 5, name: '张飞', intelligence: 60, personality: 4, troopType: 'cavalry' },
    ],
  },
  {
    id: 3,
    name: '许昌',
    lordId: 6,
    agriculture: 350,
    commerce: 320,
    gold: 600,
    food: 500,
    population: 40000,
    officers: [
      { id: 6, name: '曹操', intelligence: 90, personality: 2, troopType: 'cavalry' },
      { id: 7, name: '荀彧', intelligence: 95, personality: 0, troopType: 'infantry' },
      { id: 8, name: '郭嘉', intelligence: 98, personality: 1, troopType: 'infantry' },
    ],
  },
  {
    id: 4,
    name: '邺城',
    lordId: 6,
    agriculture: 300,
    commerce: 260,
    gold: 450,
    food: 350,
    population: 35000,
    officers: [
      { id: 9, name: '司马懿', intelligence: 96, personality: 1, troopType: 'infantry' },
      { id: 10, name: '张辽', intelligence: 70, personality: 0, troopType: 'cavalry' },
    ],
  },
]

export function createInitialState(seed: number): GameState {
  const cities: Record<CityId, City> = {}
  const officers: Record<OfficerId, Officer> = {}
  const items: Record<ItemId, Item> = {}

  for (const cs of CITY_SEEDS) {
    cities[cs.id] = {
      id: cs.id,
      name: cs.name,
      x: cs.id - 1,
      y: 0,
      lordId: cs.lordId,
      agriculture: cs.agriculture,
      commerce: cs.commerce,
      agricultureCap: DEFAULT_CAP,
      commerceCap: DEFAULT_CAP,
      gold: cs.gold,
      food: cs.food,
      loyalty: MOCK_CITY_LOYALTY,
      reserveTroops: MOCK_RESERVE_TROOPS,
      population: cs.population,
      status: 'normal',
      disasterPrevention: MOCK_DISASTER_PREVENTION,
      battleMapId: DEFAULT_MAP_ID,
    }
    for (const os of cs.officers) {
      officers[os.id] = {
        id: os.id,
        name: os.name,
        intelligence: os.intelligence,
        lordId: cs.lordId,
        cityId: cs.id,
        stamina: STAMINA_MAX,
        troops: MOCK_TROOPS,
        level: MOCK_LEVEL,
        force: MOCK_FORCE,
        loyalty: os.id === cs.lordId ? MOCK_LORD_LOYALTY : MOCK_OFFICER_LOYALTY,
        appearanceConditions: DEFAULT_APPEARANCE,
        personality: os.personality,
        troopType: os.troopType,
        experience: 0,
        personalSkills: os.personalSkills ?? [],
      }
    }
  }

  for (const seedItem of ITEM_SEEDS) {
    items[seedItem.id] = {
      ...seedItem,
      holder: { kind: 'city', cityId: seedItem.cityId },
      discovered: true,
      appearanceConditions: DEFAULT_APPEARANCE,
    }
  }

  officers[11] = {
    id: 11,
    name: '赵云',
    intelligence: 76,
    lordId: null,
    cityId: null,
    stamina: STAMINA_MAX,
    troops: 0,
    level: MOCK_LEVEL,
    force: 96,
    loyalty: MOCK_OFFICER_LOYALTY,
    appearanceConditions: { birth: 175, recruiterId: null, cityId: 2 },
    personality: 0,
    troopType: 'cavalry',
    experience: 0,
    personalSkills: [],
  }
  officers[12] = {
    id: 12,
    name: '姜维',
    intelligence: 92,
    lordId: null,
    cityId: null,
    stamina: STAMINA_MAX,
    troops: 0,
    level: MOCK_LEVEL,
    force: 88,
    loyalty: MOCK_OFFICER_LOYALTY,
    appearanceConditions: { birth: 176, recruiterId: 2, cityId: null },
    personality: 1,
    troopType: 'cavalry',
    experience: 0,
    personalSkills: [],
  }
  items[3] = {
    id: 3,
    name: '青釭剑',
    forceBonus: 12,
    intelBonus: 0,
    movementBonus: 0,
    troopTypeOverride: 0,
    holder: null,
    discovered: false,
    appearanceConditions: { birth: 191, recruiterId: null, cityId: 3 },
  }

  return {
    year: START_YEAR,
    month: 1,
    playerLordId: PLAYER_LORD,
    cities,
    officers,
    items,
    rng: createRng(seed),
    pendingCommands: [],
    adjacency: buildAdjacency(ADJACENCY_EDGES),
    battleMaps: fixtureBattleMaps(),
    activeBattle: null,
    pendingSuccession: null,
    pendingDefense: null,
  }
}
