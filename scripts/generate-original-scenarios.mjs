import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { format } from 'prettier'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_DIR = path.join(ROOT, 'data/sgby-reset')
const OUTPUT_DIR = path.join(ROOT, 'src/core/world/scenarios')
const PERIOD_KEYS = ['period_1', 'period_2', 'period_3', 'period_4']
const TROOP_TYPES = ['infantry', 'cavalry', 'archer', 'navy', 'mystic', 'elite']
const EXPECTED = [
  { lords: 19, emptyCities: 12, officers: 187, appeared: 157, items: 37 },
  { lords: 16, emptyCities: 8, officers: 184, appeared: 175, items: 33 },
  { lords: 11, emptyCities: 4, officers: 189, appeared: 179, items: 33 },
  { lords: 5, emptyCities: 5, officers: 176, appeared: 166, items: 33 },
]

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

async function readJson(name) {
  return JSON.parse(await readFile(path.join(SOURCE_DIR, `${name}.json`), 'utf8'))
}

function uniqueById(records, label) {
  const seen = new Set()
  for (const record of records) {
    invariant(Number.isInteger(record.id) && record.id > 0, `${label} invalid id: ${record.id}`)
    invariant(!seen.has(record.id), `${label} duplicate id: ${record.id}`)
    seen.add(record.id)
  }
}

function buildOfficerCatalog(periods) {
  const idByName = new Map()
  const records = []
  for (const period of periods) {
    for (const general of period.generals) {
      if (!general.name || idByName.has(general.name)) continue
      const id = records.length + 1
      idByName.set(general.name, id)
      records.push({ id, name: general.name })
    }
  }
  uniqueById(records, 'officer catalog')
  return { records, idByName }
}

function itemDefinition(source) {
  invariant(source.arm >= 0 && source.arm <= 6, `invalid item arm: ${source.arm}`)
  return {
    id: source.id,
    name: source.name,
    forceBonus: source.at,
    intelBonus: source.iq,
    movementBonus: source.move,
    troopTypeOverride: source.arm,
  }
}

function buildPeriod(period, periodIndex, generalsData, goodsData, officerIdByName) {
  const scenarioId = `period-${periodIndex + 1}`
  const periodKey = PERIOD_KEYS[periodIndex]
  const expected = EXPECTED[periodIndex]
  const appearances = generalsData.appearance_conditions[periodKey]
  const skills = generalsData.special_skill_ids[periodKey]
  const goodsAppearances = goodsData.appearance_conditions[periodKey]
  const sourceGenerals = period.generals
  const sourceOfficerId = (sourceId) => {
    if (sourceId === 0) return null
    const source = sourceGenerals[sourceId - 1]
    const id = source?.name ? officerIdByName.get(source.name) : undefined
    invariant(id !== undefined, `${scenarioId}: invalid officer reference ${sourceId}`)
    return id
  }
  const appearance = (condition) => ({
    birth: condition.birth,
    recruiterId: sourceOfficerId(condition.bole),
    cityId: condition.city === 0 ? null : condition.city,
  })

  invariant(period.cities.length === 38, `${scenarioId}: expected 38 cities`)
  invariant(sourceGenerals.length === appearances.length, `${scenarioId}: appearance mismatch`)
  invariant(sourceGenerals.length === skills.length, `${scenarioId}: skill mismatch`)

  const queued = new Map()
  for (const city of period.cities) {
    const values = period.general_queue.slice(city.person_queue, city.person_queue + city.persons)
    invariant(values.length === city.persons, `${scenarioId}: truncated generals for ${city.name}`)
    for (const zeroBased of values) {
      const generalId = zeroBased + 1
      invariant(!queued.has(generalId), `${scenarioId}: duplicate queued general ${generalId}`)
      invariant(
        sourceGenerals[generalId - 1]?.name,
        `${scenarioId}: queued empty general ${generalId}`
      )
      queued.set(generalId, city.id)
    }
  }

  const template = (oneBased) => {
    const value = goodsData.items[oneBased - 1]
    invariant(value?.id === oneBased, `${scenarioId}: missing item ${oneBased}`)
    return value
  }
  const equipmentFor = (general) =>
    general.equip.flatMap((itemId, equipSeq) =>
      itemId === 0 ? [] : [{ itemId, equipSeq, template: template(itemId) }]
    )
  const officerFields = (general) => {
    const equipment = equipmentFor(general)
    const forceBonus = equipment.reduce((sum, entry) => sum + entry.template.at, 0)
    const intelBonus = equipment.reduce((sum, entry) => sum + entry.template.iq, 0)
    const troopType = TROOP_TYPES[general.arms_type]
    invariant(troopType, `${scenarioId}: invalid troop type ${general.arms_type}`)
    invariant(general.force >= forceBonus, `${scenarioId}: negative base force ${general.name}`)
    invariant(general.iq >= intelBonus, `${scenarioId}: negative base intelligence ${general.name}`)
    return {
      id: officerIdByName.get(general.name),
      intelligence: general.iq - intelBonus,
      lordId: sourceOfficerId(general.belong),
      cityId: queued.get(general.id) ?? null,
      stamina: 100,
      troops: 100,
      level: general.level,
      force: general.force - forceBonus,
      loyalty: general.devotion,
      appearanceConditions: appearance(appearances[general.id - 1]),
      personality: 4 - general.character,
      troopType,
      experience: general.experience,
      personalSkills: skills[general.id - 1] === 0 ? [] : [skills[general.id - 1]],
    }
  }

  const officers = sourceGenerals
    .filter((general) => {
      if (!general.name) return false
      return queued.has(general.id) || appearances[general.id - 1].birth + 16 > period.start_year
    })
    .map(officerFields)
    .sort((a, b) => a.id - b.id)
  uniqueById(officers, `${scenarioId} officer`)
  for (const officer of officers) {
    if (officer.cityId === null) {
      invariant(
        officer.appearanceConditions.birth + 16 > period.start_year,
        `${scenarioId}: overdue officer ${officer.id}`
      )
    }
  }
  const memberIds = new Set(officers.map((officer) => officer.id))

  const cities = period.cities.map((source) => ({
    id: source.id,
    lordId: sourceOfficerId(source.belong),
    agriculture: source.farming,
    commerce: source.commerce,
    agricultureCap: source.farming_limit,
    commerceCap: source.commerce_limit,
    gold: source.money,
    food: source.food,
    loyalty: source.people_devotion,
    reserveTroops: source.mothball_arms,
    population: source.population,
    status: 'normal',
    disasterPrevention: source.avoid_calamity,
    battleMapId: 'plains',
  }))
  uniqueById(cities, `${scenarioId} city`)

  const itemStates = []
  const dispatched = new Set()
  const addItem = (itemId, holder, discovered) => {
    if (dispatched.has(itemId)) return
    dispatched.add(itemId)
    const condition = goodsAppearances[itemId - 1]
    invariant(condition?.id === itemId, `${scenarioId}: missing item condition ${itemId}`)
    const state = {
      id: itemId,
      holder,
      discovered,
      appearanceConditions: appearance(condition),
    }
    itemStates.push(state)
  }

  const cityByQueueIndex = new Map()
  for (const city of period.cities) {
    for (let index = city.tool_queue; index < city.tool_queue + city.tools; index += 1) {
      cityByQueueIndex.set(index, city.id)
    }
  }
  for (const [index, raw] of period.goods_queue.entries()) {
    const cityId = cityByQueueIndex.get(index)
    invariant(cityId !== undefined, `${scenarioId}: unowned goods queue index ${index}`)
    addItem((raw & 0x7fff) + 1, { kind: 'city', cityId }, (raw & 0x8000) !== 0)
  }
  for (const general of sourceGenerals) {
    if (!general.name || !memberIds.has(officerIdByName.get(general.name))) continue
    for (const entry of equipmentFor(general)) {
      addItem(
        entry.itemId,
        { kind: 'officer', officerId: officerIdByName.get(general.name), equipSeq: entry.equipSeq },
        true
      )
    }
  }
  itemStates.sort((a, b) => a.id - b.id)
  uniqueById(itemStates, `${scenarioId} item`)

  const lords = new Set(cities.map((city) => city.lordId).filter((id) => id !== null))
  invariant(lords.size === expected.lords, `${scenarioId}: lord count mismatch`)
  invariant(
    cities.filter((city) => city.lordId === null).length === expected.emptyCities,
    `${scenarioId}: empty city mismatch`
  )
  invariant(officers.length === expected.officers, `${scenarioId}: officer count mismatch`)
  invariant(
    officers.filter((officer) => officer.cityId !== null).length === expected.appeared,
    `${scenarioId}: appeared officer mismatch`
  )
  invariant(itemStates.length === expected.items, `${scenarioId}: item count mismatch`)
  for (const officer of officers) {
    invariant(
      officer.lordId === null || memberIds.has(officer.lordId),
      `${scenarioId}: dangling lord ${officer.id}`
    )
    invariant(
      officer.appearanceConditions.recruiterId === null ||
        memberIds.has(officer.appearanceConditions.recruiterId),
      `${scenarioId}: dangling recruiter ${officer.id}`
    )
  }
  for (const item of itemStates) {
    const h = item.holder
    invariant(h !== null, `${scenarioId}: unexpected pending item ${item.id}`)
    invariant(
      h.kind === 'city' || memberIds.has(h.officerId),
      `${scenarioId}: dangling item holder ${item.id}`
    )
    invariant(
      item.appearanceConditions.recruiterId === null ||
        memberIds.has(item.appearanceConditions.recruiterId),
      `${scenarioId}: dangling item recruiter ${item.id}`
    )
  }

  return {
    id: scenarioId,
    name: period.name,
    startYear: period.start_year,
    cities,
    officers,
    items: itemStates,
  }
}

async function serialize(value) {
  return format(JSON.stringify(value), { parser: 'json' })
}

export async function generateOriginalScenarios({ check = false } = {}) {
  const [periods, generals, goods, cities] = await Promise.all(
    ['periods', 'generals', 'goods', 'cities'].map(readJson)
  )
  const officerCatalog = buildOfficerCatalog(periods)
  const shared = {
    'cities.json': cities.names.map(({ index, value }) => ({ id: index, name: value })),
    'officers.json': officerCatalog.records,
    'items.json': goods.items.map(itemDefinition),
    'adjacency.json': cities.adjacency.edges.map(({ from, to }) => [from, to]),
  }
  uniqueById(shared['cities.json'], 'city catalog')
  uniqueById(shared['items.json'], 'item catalog')
  invariant(shared['cities.json'].length === 38, 'city catalog count mismatch')
  invariant(shared['items.json'].length === 37, 'item catalog count mismatch')
  invariant(shared['officers.json'].length === 295, 'officer catalog count mismatch')

  const periodsOut = periods.map((period, index) =>
    buildPeriod(period, index, generals, goods, officerCatalog.idByName)
  )
  const files = new Map()
  for (const [name, value] of Object.entries(shared)) files.set(name, await serialize(value))
  for (const [index, value] of periodsOut.entries()) {
    files.set(`period-${index + 1}.json`, await serialize(value))
  }

  if (check) {
    for (const [name, expected] of files) {
      let actual = null
      try {
        actual = await readFile(path.join(OUTPUT_DIR, name), 'utf8')
      } catch {
        // Unified stale/missing output error below.
      }
      invariant(actual === expected, `generated scenario is stale: ${name}`)
    }
    return periodsOut
  }

  await mkdir(OUTPUT_DIR, { recursive: true })
  await Promise.all(
    [...files].map(([name, value]) => writeFile(path.join(OUTPUT_DIR, name), value))
  )
  return periodsOut
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateOriginalScenarios({ check: process.argv.includes('--check') })
}
