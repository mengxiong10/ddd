import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { DevelopKind, GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import { randInt } from '../shared/rng'
import { attributeCap, raiseAttribute, spendGold } from '../world/city'
import { setBusy, spendStamina } from '../world/officer'

/**
 * 开垦/招商增量公式系数（规则身份，内联常量，不入 config）：
 * 增量 = floor(智力 / DEVELOP_INTEL_DIVISOR) + RandInt(0, DEVELOP_RAND_MAX)。
 * 平衡通过城属性/上限、成本等其它参数调，而非改公式本身。
 */
const DEVELOP_INTEL_DIVISOR = 5
const DEVELOP_RAND_MAX = 30

/**
 * 校验开垦/招商前置条件（不修改状态），供 UI 置灰/提示与 develop 内部守卫复用。
 * 与君主无关，AI 后续也可复用同一校验。
 */
export function canDevelop(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  kind: DevelopKind,
  config: GameConfig,
): CommandCheck {
  const city = state.cities[cityId]
  if (!city) return { ok: false, reason: '城不存在' }
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: '武将不存在' }
  if (officer.cityId !== cityId) return { ok: false, reason: '武将不在该城' }
  if (officer.busy) return { ok: false, reason: '武将本月已被占用' }

  const attr = kind === 'agriculture' ? city.agriculture : city.commerce
  if (attr >= attributeCap(city, kind)) {
    return { ok: false, reason: kind === 'agriculture' ? '农业已达上限' : '商业已达上限' }
  }
  if (city.gold < config.commandGoldCost) return { ok: false, reason: '城金不足' }
  if (officer.stamina < config.commandStaminaCost) return { ok: false, reason: '体力不足' }
  return { ok: true }
}

/**
 * 执行开垦/招商：效果在下令当下立即结算（属性增长 + 扣金扣体力 + 占用武将 + 推进 RNG）。
 * 前置条件不满足时为 no-op，原样返回 state。
 */
export function develop(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  kind: DevelopKind,
  config: GameConfig,
): GameState {
  if (!canDevelop(state, cityId, officerId, kind, config).ok) return state

  const city = state.cities[cityId]!
  const officer = state.officers[officerId]!
  // 增量 = floor(智力 / 除数) + RandInt(0, 随机上限)
  const [rand, nextRng] = randInt(state.rng, 0, DEVELOP_RAND_MAX)
  const delta = Math.floor(officer.intelligence / DEVELOP_INTEL_DIVISOR) + rand

  const nextCity = spendGold(raiseAttribute(city, kind, delta), config.commandGoldCost)
  const nextOfficer = setBusy(spendStamina(officer, config.commandStaminaCost), true)

  return {
    ...state,
    rng: nextRng,
    cities: { ...state.cities, [cityId]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
  }
}
