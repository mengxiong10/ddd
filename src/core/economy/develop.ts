import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { DevelopKind, GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import { commandOk, commandFail, type WithCheck } from '../shared/outcome'
import { randInt } from '../shared/rng'
import { attributeCap, raiseAttribute, spendGold } from '../world/city'
import { spendStamina } from '../world/officer'
import { effectiveOfficer, isBusy } from '../world/queries'

/**
 * 开垦/招商增量公式系数（规则身份，内联常量，不入 config）：
 * 增量 = floor(智力 / DEVELOP_INTEL_DIVISOR) + RandInt(0, DEVELOP_RAND_MAX)。
 * 平衡通过城属性/上限、成本等其它参数调，而非改公式本身。
 */
const DEVELOP_INTEL_DIVISOR = 5
const DEVELOP_RAND_MAX = 30

/**
 * 校验开垦/招商前置条件（不修改状态），供 UI 置灰/提示与 develop 内部守卫复用。
 * 作用城 = 武将所在城（officer.cityId!，单一真相源）。与君主无关，AI 后续也可复用同一校验。
 */
export function canDevelop(
  state: GameState,
  officerId: OfficerId,
  kind: DevelopKind,
  config: GameConfig
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isBusy(state, officerId)) return { ok: false, reason: 'officer-busy' }
  const city = state.cities[officer.cityId!]
  if (!city) return { ok: false, reason: 'city-not-found' }

  const attr = kind === 'agriculture' ? city.agriculture : city.commerce
  if (attr >= attributeCap(city, kind)) {
    return { ok: false, reason: kind === 'agriculture' ? 'agriculture-capped' : 'commerce-capped' }
  }
  if (city.gold < config.commandGoldCost) return { ok: false, reason: 'gold-insufficient' }
  if (officer.stamina < config.commandStaminaCost)
    return { ok: false, reason: 'stamina-insufficient' }
  return { ok: true }
}

/**
 * 执行开垦/招商：效果在下令当下立即结算（属性增长 + 扣金扣体力 + 推进 RNG）。
 * 占用武将由入队 develop 命令派生（queries.isBusy），出队即释放；月末分支无效果。
 * 前置条件不满足时为 no-op，原样返回 state。
 */
export function develop(
  state: GameState,
  officerId: OfficerId,
  kind: DevelopKind,
  config: GameConfig
): WithCheck<GameState> {
  const check = canDevelop(state, officerId, kind, config)
  if (!check.ok) return commandFail(check, state)

  const officer = state.officers[officerId]!
  const city = state.cities[officer.cityId!]!
  const before = kind === 'agriculture' ? city.agriculture : city.commerce
  // 增量 = floor(有效智力 / 除数) + RandInt(0, 随机上限)；有效智力含道具加成
  const [rand, nextRng] = randInt(state.rng, 0, DEVELOP_RAND_MAX)
  const delta =
    Math.floor(effectiveOfficer(state, officerId).intelligence / DEVELOP_INTEL_DIVISOR) + rand

  const nextCity = spendGold(raiseAttribute(city, kind, delta), config.commandGoldCost)
  const newValue = kind === 'agriculture' ? nextCity.agriculture : nextCity.commerce
  const nextOfficer = spendStamina(officer, config.commandStaminaCost)

  const next: GameState = {
    ...state,
    rng: nextRng,
    cities: { ...state.cities, [officer.cityId!]: nextCity },
    officers: { ...state.officers, [officerId]: nextOfficer },
    pendingCommands: [
      ...state.pendingCommands,
      { type: kind === 'agriculture' ? 'reclaim' : 'commerce', officerId },
    ],
  }
  // 事件 delta 取实际应用值（封顶后 newValue-before），如实反映"变为 X (+Y)"。
  return commandOk(next, [
    {
      kind: 'develop-done',
      officerId,
      cityId: officer.cityId!,
      attr: kind,
      newValue,
      delta: newValue - before,
    },
  ])
}
