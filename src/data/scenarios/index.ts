import type { GameState } from '../../core/game-state'
import type { BattleMapId, CityId, OfficerId } from '../../core/shared/ids'
import { createRng } from '../../core/shared/rng'
import { buildAdjacency } from '../../core/world/adjacency'
import type { City } from '../../core/world/city'
import type { Item } from '../../core/world/item'
import type { Officer } from '../../core/world/officer'
import { createBattleMapCatalog, type BattleMap } from '../../core/military/battle-map'
import cityCatalogJson from './generated/cities.json'
import officerCatalogJson from './generated/officers.json'
import itemCatalogJson from './generated/items.json'
import adjacencyJson from './generated/adjacency.json'
import battleMapsJson from './generated/battle-maps.json'
import period1Json from './generated/period-1.json'
import period2Json from './generated/period-2.json'
import period3Json from './generated/period-3.json'
import period4Json from './generated/period-4.json'

export type ScenarioId = 'period-1' | 'period-2' | 'period-3' | 'period-4'

export interface ScenarioSummary {
  readonly id: ScenarioId
  readonly name: string
  readonly startYear: number
}

export interface ScenarioLordSummary {
  readonly id: OfficerId
  readonly name: string
  readonly cityCount: number
}

export interface CreateScenarioRequest {
  readonly scenarioId: ScenarioId
  readonly playerLordId: OfficerId
  readonly seed: number
}

interface IdentityRecord<I extends number> {
  readonly id: I
  readonly name: string
}

interface CityDefinition extends IdentityRecord<CityId> {
  readonly x: number
  readonly y: number
  readonly battleMapId: BattleMapId
}

type CityPeriodState = Omit<City, 'name' | 'x' | 'y' | 'battleMapId'>
type OfficerPeriodState = Omit<Officer, 'name'>
type ItemPeriodState = Pick<Item, 'id' | 'holder' | 'discovered' | 'appearanceConditions'>
type ItemDefinition = Omit<Item, 'holder' | 'discovered' | 'appearanceConditions'>

interface PeriodData extends ScenarioSummary {
  readonly cities: readonly CityPeriodState[]
  readonly officers: readonly OfficerPeriodState[]
  readonly items: readonly ItemPeriodState[]
}

interface ScenarioData extends ScenarioSummary {
  readonly cities: readonly City[]
  readonly officers: readonly Officer[]
  readonly items: readonly Item[]
}

const CITY_CATALOG = cityCatalogJson as readonly CityDefinition[]
const OFFICER_CATALOG = officerCatalogJson as readonly IdentityRecord<OfficerId>[]
const ITEM_CATALOG = itemCatalogJson as unknown as readonly ItemDefinition[]
const ADJACENCY_EDGES = adjacencyJson as unknown as readonly (readonly [CityId, CityId])[]
const BATTLE_MAP_DATA = battleMapsJson as unknown as readonly BattleMap[]

function byId<T extends { readonly id: number }>(records: readonly T[]): Map<number, T> {
  return new Map(records.map((record) => [record.id, record]))
}

const CITY_BY_ID = byId(CITY_CATALOG)
const OFFICER_BY_ID = byId(OFFICER_CATALOG)
const ITEM_BY_ID = byId(ITEM_CATALOG)

function hydrate(raw: PeriodData): ScenarioData {
  const cities = raw.cities.map((state) => {
    const identity = CITY_BY_ID.get(state.id)
    if (!identity) throw new Error(`scenario ${raw.id} references unknown city: ${state.id}`)
    return { ...identity, ...state }
  })
  const officers = raw.officers.map((state) => {
    const identity = OFFICER_BY_ID.get(state.id)
    if (!identity) throw new Error(`scenario ${raw.id} references unknown officer: ${state.id}`)
    return { ...identity, ...state }
  })
  const items = raw.items.map((state) => {
    const definition = ITEM_BY_ID.get(state.id)
    if (!definition) throw new Error(`scenario ${raw.id} references unknown item: ${state.id}`)
    return { ...definition, ...state }
  })
  return { id: raw.id, name: raw.name, startYear: raw.startYear, cities, officers, items }
}

const PERIODS = [
  period1Json,
  period2Json,
  period3Json,
  period4Json,
] as unknown as readonly PeriodData[]
const DATA = Object.fromEntries(PERIODS.map((period) => [period.id, hydrate(period)])) as Readonly<
  Record<ScenarioId, ScenarioData>
>

export const SCENARIOS: readonly ScenarioSummary[] = Object.values(DATA).map(
  ({ id, name, startYear }) => ({ id, name, startYear })
)

function scenarioData(id: ScenarioId): ScenarioData {
  const data = DATA[id]
  if (!data) throw new Error(`unknown scenario: ${id}`)
  return data
}

export function lordsForScenario(scenarioId: ScenarioId): readonly ScenarioLordSummary[] {
  const data = scenarioData(scenarioId)
  const cityCounts = new Map<OfficerId, number>()
  for (const city of data.cities) {
    if (city.lordId !== null) cityCounts.set(city.lordId, (cityCounts.get(city.lordId) ?? 0) + 1)
  }
  return [...cityCounts.entries()]
    .map(([id, cityCount]) => {
      const officer = data.officers.find(
        (candidate) => candidate.id === id && candidate.lordId === id
      )
      if (!officer) throw new Error(`scenario ${scenarioId} has invalid lord: ${id}`)
      return { id, name: officer.name, cityCount }
    })
    .sort((a, b) => a.id - b.id)
}

function indexById<T extends { readonly id: number }>(records: readonly T[]): Record<number, T> {
  return Object.fromEntries(records.map((record) => [record.id, record]))
}

export function createScenarioState(request: CreateScenarioRequest): GameState {
  const source = scenarioData(request.scenarioId)
  if (!lordsForScenario(request.scenarioId).some((lord) => lord.id === request.playerLordId)) {
    throw new Error(`invalid player lord for ${request.scenarioId}: ${request.playerLordId}`)
  }
  const data = structuredClone(source)
  return {
    year: data.startYear,
    month: 1,
    playerLordId: request.playerLordId,
    cities: indexById(data.cities),
    officers: indexById(data.officers),
    items: indexById(data.items),
    rng: createRng(request.seed),
    adjacency: buildAdjacency(ADJACENCY_EDGES),
    battleMaps: createBattleMapCatalog(BATTLE_MAP_DATA),
    pendingCommands: [],
    activeBattle: null,
    pendingSuccession: null,
    pendingDefense: null,
  }
}
