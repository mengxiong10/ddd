import type { GameState } from '../game-state'
import type { OfficerId } from '../shared/ids'
import type { GameConfig } from '../shared/config'
import type { CommandCheck } from '../shared/command'
import { addFood, addGold, ravage } from '../world/city'
import { setBusy, spendStamina } from '../world/officer'

/**
 * 掠夺收益转化率（规则身份，内联常量，不入 config）：
 * power = 执行人智力 + 武力；粮 += power × PLUNDER_FOOD_PER_POWER、金 += power × PLUNDER_GOLD_PER_POWER。
 * 破坏（农业/商业/民忠减半）是城级降级，见 city.ravage。
 */
const PLUNDER_FOOD_PER_POWER = 5
const PLUNDER_GOLD_PER_POWER = 2

/**
 * 校验掠夺前置条件（不修改状态），供 UI 置灰/提示与 plunder 内部守卫复用。
 * 武将存在且未占用 → 体力 ≥ plunderStaminaCost。掠夺目标恒为本城（officer.cityId）。
 */
export function canPlunder(
  state: GameState,
  officerId: OfficerId,
  config: GameConfig,
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: '武将不存在' }
  if (officer.busy) return { ok: false, reason: '武将本月已被占用' }
  if (officer.stamina < config.plunderStaminaCost) return { ok: false, reason: '体力不足' }
  return { ok: true }
}

/**
 * 下令掠夺：效果延到月末（见 executePlunder）。下令当下仅扣体力、占用武将、入队，不改城、不动 RNG。
 * 前置条件不满足时为 no-op，原样返回 state。
 */
export function plunder(
  state: GameState,
  officerId: OfficerId,
  config: GameConfig,
): GameState {
  if (!canPlunder(state, officerId, config).ok) return state

  const officer = state.officers[officerId]!
  const nextOfficer = setBusy(spendStamina(officer, config.plunderStaminaCost), true)

  return {
    ...state,
    officers: { ...state.officers, [officerId]: nextOfficer },
    pendingCommands: [...state.pendingCommands, { type: 'plunder', officerId }],
  }
}

/**
 * 月末执行单条掠夺（供 turn 层按 type 分派）：本城 = 执行人所在城。
 * 破坏本城（ravage）+ 收益本城（粮 += power×5、金 += power×2）。
 */
export function executePlunder(state: GameState, officerId: OfficerId): GameState {
  const officer = state.officers[officerId]!
  const cityId = officer.cityId
  const power = officer.intelligence + officer.force
  const ravaged = ravage(state.cities[cityId]!)
  const nextCity = addGold(addFood(ravaged, power * PLUNDER_FOOD_PER_POWER), power * PLUNDER_GOLD_PER_POWER)

  return { ...state, cities: { ...state.cities, [cityId]: nextCity } }
}
