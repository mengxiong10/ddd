import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { Rng } from '../shared/rng'
import { randInt, pickRandom } from '../shared/rng'
import { spendFood } from '../world/city'
import { levelUp, setTroops, troopCapacity } from '../world/officer'
import { effectiveOfficer, officersInCity } from '../world/queries'
import { aiServingOfficers, adjacentEnemyCities, busyEnqueueMany } from './ai-shared'

const MILITARY_ROLL_MAX = 8
/** 军备每 3 个月给强化对象升一次级（month % 3 === 0）。 */
const MILITARY_LEVELUP_PERIOD = 3
/** 出征命令生成门槛（规则身份，内联常量）：可出征数下限 / 最高兵力下限 / 单次带兵上限。 */
const MIN_CAMPAIGN_OFFICERS = 4
const MIN_TOP_TROOPS = 1000
const MAX_CAMPAIGN_OFFICERS = 10

/**
 * 军备模块（5.5.4）：先随机选 1 名在任武将为整轮强化对象；若 month%3===0 先升其 1 级。
 * 随后逐人 RandInt(0,8)：1~5 把强化对象兵力补满至有效带兵量上限（不扣金/不动后备兵/不占人/不入队）；
 * 0/6/8 跳过；7=出征本切片 TODO（不产生命令）。
 */
export function runAiMilitary(state: GameState, cityId: CityId): GameState {
  const serving = aiServingOfficers(state, cityId)
  if (serving.length === 0) return state

  const [target, rngAfterPick] = pickRandom(state.rng, serving)
  let rng = rngAfterPick
  let next = state
  if (state.month % MILITARY_LEVELUP_PERIOD === 0) {
    next = {
      ...next,
      officers: { ...next.officers, [target.id]: levelUp(next.officers[target.id]!) },
    }
  }

  for (let i = 0; i < serving.length; i++) {
    const [roll, r] = randInt(rng, 0, MILITARY_ROLL_MAX)
    rng = r
    if (roll >= 1 && roll <= 5) next = refill(next, target.id)
    // 出征仅本模块第 1 次遍历（i===0）尝试，后续武将的 roll===7 直接跳过（每城每月至多一次出征尝试）。
    else if (roll === 7 && i === 0) {
      const [s2, r2] = tryCampaign(next, cityId, rng)
      next = s2
      rng = r2
    }
    // 0/6/8（及 i>0 的 7）跳过。
  }
  return { ...next, rng }
}

/**
 * 出征尝试（消费 rng 仅在 50% 那步；其余门槛不耗 RNG）。固定判定顺序：
 * 相邻敌城 → 可出征门槛（在任 ≥4、按兵力降序最高 ≥1000）→ 50% 掷骰 → 选最弱目标 → 组建名单 + 入队。
 * 任一前置不过则 no-op（不动 state/rng，50% 之前不耗 RNG）。
 */
function tryCampaign(state: GameState, cityId: CityId, rng: Rng): readonly [GameState, Rng] {
  const city = state.cities[cityId]!
  const enemies = adjacentEnemyCities(state, cityId, city.lordId)
  if (enemies.length === 0) return [state, rng]

  // 在任武将按兵力降序（平局 id 升序）：决定门槛与出征名单。
  const serving = officersInCity(state, cityId, { onlyAvailable: true }).sort(
    (a, b) => b.troops - a.troops || (a.id < b.id ? -1 : 1)
  )
  if (serving.length < MIN_CAMPAIGN_OFFICERS || serving[0]!.troops < MIN_TOP_TROOPS)
    return [state, rng]

  const [coin, r1] = randInt(rng, 0, 1)
  if (coin !== 0) return [state, r1]

  const targetCityId = weakestTarget(state, enemies)
  // 最多带 10 人且至少留 1 名守城 → 取兵力降序前 min(10, 在任数−1)。
  const take = Math.min(MAX_CAMPAIGN_OFFICERS, serving.length - 1)
  const officerIds = serving.slice(0, take).map((o) => o.id)
  const provisions = city.food // 随军粮草填本城全部粮
  const withFood = {
    ...state,
    cities: { ...state.cities, [cityId]: spendFood(city, provisions) },
  }
  return [
    busyEnqueueMany(withFood, officerIds, {
      type: 'campaign',
      officerIds,
      targetCityId,
      provisions,
    }),
    r1,
  ]
}

/**
 * 相邻敌城中守军合计最弱者（平局取 id 最小，enemies 已按 id 升序故 strict < 取首）。
 * 「守军合计」为选目标用估算（≠ defendingOfficers）：见 estimatedGarrison。
 */
function weakestTarget(state: GameState, enemies: readonly { id: CityId }[]): CityId {
  let best = enemies[0]!.id
  let bestG = estimatedGarrison(state, best)
  for (const c of enemies) {
    const g = estimatedGarrison(state, c.id)
    if (g < bestG) {
      best = c.id
      bestG = g
    }
  }
  return best
}

/**
 * 选目标用「守军合计」估算（下令时刻、不含后备兵）：
 * 本城在任武将兵 + 队列中该城已派出、且命令∉{move,campaign}的执行人兵（这些占人指令月末回城、仍算守军）。
 */
function estimatedGarrison(state: GameState, cityId: CityId): number {
  let sum = officersInCity(state, cityId, { onlyAvailable: true }).reduce((s, o) => s + o.troops, 0)
  for (const cmd of state.pendingCommands) {
    if (cmd.type === 'move' || cmd.type === 'campaign') continue
    const o = state.officers[cmd.officerId]
    if (o && o.cityId === cityId) sum += o.troops
  }
  return sum
}

/** 把强化对象兵力补满至有效带兵量上限（吃有效武力/智力）；不扣金、不动后备兵。 */
function refill(state: GameState, targetId: OfficerId): GameState {
  const cap = troopCapacity(effectiveOfficer(state, targetId))
  return {
    ...state,
    officers: { ...state.officers, [targetId]: setTroops(state.officers[targetId]!, cap) },
  }
}
