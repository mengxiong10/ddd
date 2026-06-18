import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { Rng } from '../shared/rng'
import { randInt } from '../shared/rng'
import {
  raiseAttribute,
  gainLoyalty,
  addPopulation,
  setStatus,
  raisePrevention,
} from '../world/city'
import { citiesOfLord } from '../world/queries'
import { aiServingOfficers, busyEnqueue, byId, adjacentEnemyCities } from './ai-shared'

/**
 * 内政固定成长（规则身份，内联——AI 作弊：不吃智力公式、不扣城金）：
 * 开垦/招商 +200 封顶城级上限；出巡民忠 +4·人口 +100；治理防灾 +4。
 */
const AI_DEVELOP_DELTA = 200
const AI_PATROL_LOYALTY = 4
const AI_PATROL_POPULATION = 100
const AI_GOVERN_PREVENTION = 4
/** 移动门槛：前 3 名（i<3）不被协调移动；本势力城数须 ≥ 2。 */
const MOVE_MIN_INDEX = 3
const MOVE_MIN_CITIES = 2
const INTERNAL_ROLL_MAX = 10

/**
 * 内政模块（5.5.1）：对在任武将（id 升序）逐人 RandInt(0,10) 分派。
 * 0/1 开垦·招商 +200；2 搜寻入队；3 出巡；4 治理；9 满足条件移动入队；其余跳过。
 * 立即生效命令只置 busy（不入队、不扣金）；搜寻/移动复用现有月末执行器。
 */
export function runAiInternal(state: GameState, cityId: CityId): GameState {
  const serving = aiServingOfficers(state, cityId)
  let next = state
  let rng = state.rng
  for (let i = 0; i < serving.length; i++) {
    const id = serving[i]!.id
    const lordId = serving[i]!.lordId!
    const [roll, r1] = randInt(rng, 0, INTERNAL_ROLL_MAX)
    rng = r1
    switch (roll) {
      case 0:
        next = developBusy(next, cityId, id, 'agriculture')
        break
      case 1:
        next = developBusy(next, cityId, id, 'commerce')
        break
      case 2:
        next = busyEnqueue(next, id, { type: 'search', officerId: id })
        break
      case 3:
        next = patrolBusy(next, cityId, id)
        break
      case 4:
        next = governBusy(next, cityId, id)
        break
      case 9: {
        const [target, r2] = pickMoveTarget(next, lordId, i, rng)
        rng = r2
        if (target !== null)
          next = busyEnqueue(next, id, { type: 'move', officerId: id, targetCityId: target })
        break
      }
      default:
        break // 5/6/7/8/10：跳过
    }
  }
  return { ...next, rng }
}

/** 开垦/招商 +200 封顶上限 + 占人；不扣城金。 */
function developBusy(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  kind: 'agriculture' | 'commerce'
): GameState {
  const city = raiseAttribute(state.cities[cityId]!, kind, AI_DEVELOP_DELTA)
  return setCityBusy(state, cityId, city, officerId, 'develop')
}

/** 出巡：民忠 +4 封顶、人口 +100 + 占人。 */
function patrolBusy(state: GameState, cityId: CityId, officerId: OfficerId): GameState {
  const city = addPopulation(
    gainLoyalty(state.cities[cityId]!, AI_PATROL_LOYALTY),
    AI_PATROL_POPULATION
  )
  return setCityBusy(state, cityId, city, officerId, 'patrol')
}

/** 治理：状态改 normal、防灾 +4 封顶 + 占人。 */
function governBusy(state: GameState, cityId: CityId, officerId: OfficerId): GameState {
  const city = raisePrevention(setStatus(state.cities[cityId]!, 'normal'), AI_GOVERN_PREVENTION)
  return setCityBusy(state, cityId, city, officerId, 'govern')
}

/** 写回城 + 入队对应即时 type（占用由队列派生 queries.isBusy；月末空操作）。 */
function setCityBusy(
  state: GameState,
  cityId: CityId,
  city: GameState['cities'][CityId],
  officerId: OfficerId,
  type: 'develop' | 'patrol' | 'govern'
): GameState {
  return busyEnqueue({ ...state, cities: { ...state.cities, [cityId]: city } }, officerId, {
    type,
    officerId,
  })
}

/**
 * 移动选城（5.5.1）：返回 [目标城 | null, 推进后 rng]。
 * 条件不满足（i<3 或本势力城 <2）→ null、不耗 RNG。
 * 否则：初始候选 = 本势力城（id 升序）首座；扫描本势力城，遇「有相邻敌城」者更新候选并
 * RandInt(0,1)===0（50%）即停步返回；全程无敌邻城则用初始候选。目标可能 = 本城（executeMove 容忍）。
 */
export function pickMoveTarget(
  state: GameState,
  lordId: OfficerId,
  index: number,
  rng: Rng
): readonly [target: CityId | null, next: Rng] {
  if (index < MOVE_MIN_INDEX) return [null, rng]
  const ownCities = citiesOfLord(state, lordId).sort(byId)
  if (ownCities.length < MOVE_MIN_CITIES) return [null, rng]

  let candidate = ownCities[0]!.id
  let cur = rng
  for (const c of ownCities) {
    if (adjacentEnemyCities(state, c.id, lordId).length === 0) continue
    candidate = c.id
    const [stop, r] = randInt(cur, 0, 1)
    cur = r
    if (stop === 0) return [candidate, cur]
  }
  return [candidate, cur]
}
