import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import {
  withEvents,
  commandOk,
  commandFail,
  type WithEvents,
  type WithCheck,
} from '../shared/outcome'
import type { Rng } from '../shared/rng'
import { randInt } from '../shared/rng'
import { spendStamina } from '../world/officer'
import { discover } from '../world/item'
import {
  effectiveOfficer,
  isBusy,
  isCaptive,
  undiscoveredItemsInCity,
  wanderingOfficersInCity,
} from '../world/queries'

/**
 * 搜寻规则身份（内联常量，不入 config——皆为公式/阈值/量纲上限）：
 * - 四分支均分（RandInt(0,3)：0 无事 / 1 发现 / 2 金 / 3 粮）。
 * - 发现先过筛：RandInt(0,149) < 有效智力 才继续。
 * - 招募（伯乐=null 时）：RandInt(0,109) < 有效智力 才成功。
 * - 招募成功忠诚区间 [70,99]。
 * - 外快/粮食：上限 = max(10, 有效智力×2)，获得 = RandInt(10,上限)；城金/城粮所得封顶 30000。
 */
const SEARCH_SIEVE_MAX = 149
const RECRUIT_ROLL_MAX = 109
const RECRUIT_LOYALTY_MIN = 70
const RECRUIT_LOYALTY_MAX = 99
const SEARCH_GAIN_MIN = 10
const SEARCH_GAIN_INTEL_FACTOR = 2
const SEARCH_RESOURCE_CAP = 30000

/**
 * 校验搜寻前置（不改状态）：作用城 = 执行人所在城。
 * 武将存在、未占用、非俘虏（须在任）→ 体力 ≥ searchStaminaCost；不需金钱。
 */
export function canSearch(
  state: GameState,
  officerId: OfficerId,
  config: GameConfig
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  if (isCaptive(state, officerId)) return { ok: false, reason: 'is-captive' }
  if (officer.stamina < config.searchStaminaCost)
    return { ok: false, reason: 'stamina-insufficient' }
  return { ok: true }
}

/**
 * 下令搜寻：效果延到月末（见 executeSearch）。下令仅扣体力、入队（占用由队列派生）；不改城、不动 RNG。
 * 前置不满足为 no-op。
 */
export function search(
  state: GameState,
  officerId: OfficerId,
  config: GameConfig
): WithCheck<GameState> {
  const check = canSearch(state, officerId, config)
  if (!check.ok) return commandFail(check, state)

  const officer = state.officers[officerId]!
  const nextOfficer = spendStamina(officer, config.searchStaminaCost)
  return commandOk({
    ...state,
    officers: { ...state.officers, [officerId]: nextOfficer },
    pendingCommands: [...state.pendingCommands, { type: 'search', officerId }],
  })
}

/**
 * 月末执行单条搜寻（供 turn 分派，非 campaign 趟）。本城 = 执行人所在城；智力取有效智力。
 * 四分支各 1/4，发现分支再做过筛/找谁/选候选/成败——RNG 调用次序固定（见各步注释），保可复现。
 */
export function executeSearch(state: GameState, officerId: OfficerId): WithEvents<GameState> {
  const officer = state.officers[officerId]
  if (!officer) return withEvents(state)
  const cityId = officer.cityId!
  const intel = effectiveOfficer(state, officerId).intelligence
  const none = (s: GameState): WithEvents<GameState> =>
    withEvents(s, [{ kind: 'search-none', officerId, cityId }])

  // ① 分支
  const [branch, rng1] = randInt(state.rng, 0, 3)
  if (branch === 0) return none({ ...state, rng: rng1 }) // 无事发生
  if (branch === 2 || branch === 3) {
    // ② 金/粮：上限 = max(10, 智力×2)
    const cap = Math.max(SEARCH_GAIN_MIN, intel * SEARCH_GAIN_INTEL_FACTOR)
    const [amount, rng2] = randInt(rng1, SEARCH_GAIN_MIN, cap)
    const city = state.cities[cityId]!
    const resource = branch === 2 ? 'gold' : 'food'
    const nextCity =
      branch === 2
        ? { ...city, gold: Math.min(city.gold + amount, SEARCH_RESOURCE_CAP) }
        : { ...city, food: Math.min(city.food + amount, SEARCH_RESOURCE_CAP) }
    const gained = branch === 2 ? nextCity.gold - city.gold : nextCity.food - city.food
    return withEvents({ ...state, rng: rng2, cities: { ...state.cities, [cityId]: nextCity } }, [
      { kind: 'search-resource', officerId, cityId, resource, amount: gained },
    ])
  }

  // branch === 1：发现 —— ③ 过筛
  const [sieve, rng2] = randInt(rng1, 0, SEARCH_SIEVE_MAX)
  if (sieve >= intel) return none({ ...state, rng: rng2 }) // 未过筛 -> 无事
  const [kind, rng3] = randInt(rng2, 0, 1) // 0 武将 / 1 道具
  return kind === 0
    ? discoverOfficer(state, officerId, cityId, intel, rng3)
    : discoverItem(state, officerId, cityId, rng3)
}

/** 搜到武将：随机选一名在野候选，按伯乐条件判定招募。候选空 -> 无事（不改找道具）。 */
function discoverOfficer(
  state: GameState,
  officerId: OfficerId,
  cityId: CityId,
  intel: number,
  rng: Rng
): WithEvents<GameState> {
  const candidates = wanderingOfficersInCity(state, cityId)
  if (candidates.length === 0)
    return withEvents({ ...state, rng }, [{ kind: 'search-none', officerId, cityId }])

  const [pick, rngP] = randInt(rng, 0, candidates.length - 1)
  const target = candidates[pick]!
  const executorLord = state.officers[officerId]!.lordId
  const recruited = (s: GameState): WithEvents<GameState> =>
    withEvents(s, [{ kind: 'search-recruited', officerId, cityId, targetId: target.id }])
  const notRecruited = (s: GameState): WithEvents<GameState> =>
    withEvents(s, [{ kind: 'search-found-not-recruited', officerId, cityId, targetId: target.id }])

  if (target.appearanceConditions.recruiterId === officerId)
    return recruited(recruit(state, target.id, executorLord, rngP)) // 伯乐本人必中
  if (target.appearanceConditions.recruiterId === null) {
    const [roll, rngR] = randInt(rngP, 0, RECRUIT_ROLL_MAX)
    return roll < intel
      ? recruited(recruit(state, target.id, executorLord, rngR))
      : notRecruited({ ...state, rng: rngR })
  }
  return notRecruited({ ...state, rng: rngP }) // 伯乐是别人 -> 必败
}

/** 招募成功：目标归执行人君主、忠诚 RandInt(70,99)，cityId/troops 不变。 */
function recruit(
  state: GameState,
  targetId: OfficerId,
  lordId: OfficerId | null,
  rng: Rng
): GameState {
  const [loyalty, nextRng] = randInt(rng, RECRUIT_LOYALTY_MIN, RECRUIT_LOYALTY_MAX)
  const target = { ...state.officers[targetId]!, lordId, loyalty }
  return { ...state, rng: nextRng, officers: { ...state.officers, [targetId]: target } }
}

/** 搜到道具：随机选一件未发现候选，伯乐=null 或执行人本人 -> 发现。候选空/别人伯乐 -> 无事。 */
function discoverItem(
  state: GameState,
  officerId: OfficerId,
  cityId: CityId,
  rng: Rng
): WithEvents<GameState> {
  const none = (s: GameState): WithEvents<GameState> =>
    withEvents(s, [{ kind: 'search-none', officerId, cityId }])
  const candidates = undiscoveredItemsInCity(state, cityId)
  if (candidates.length === 0) return none({ ...state, rng })

  const [pick, rngP] = randInt(rng, 0, candidates.length - 1)
  const target = candidates[pick]!
  if (
    target.appearanceConditions.recruiterId === null ||
    target.appearanceConditions.recruiterId === officerId
  ) {
    return withEvents(
      { ...state, rng: rngP, items: { ...state.items, [target.id]: discover(target) } },
      [{ kind: 'search-item', officerId, cityId, itemId: target.id }]
    )
  }
  return none({ ...state, rng: rngP }) // 伯乐是别人 -> 失败
}
