import type { GameState } from '../game-state'
import type { GameConfig } from '../shared/config'
import type { CityId } from '../shared/ids'
import { randInt } from '../shared/rng'
import { setStatus, raisePrevention } from '../world/city'
import { levelUp, type Personality } from '../world/officer'
import { isCaptive } from '../world/queries'
import { byId } from './ai-shared'
import { runAiInternal } from './ai-internal'
import { runAiDiplomacy } from './ai-diplomacy'
import { runAiMilitary } from './ai-military'

/**
 * AI 兜底/经营规则身份（内联常量，不入 config——皆为固定量/阈值）：
 * 兜底每月对每座 AI 城：状态归一、防灾 +1、粮草下限补给；自动升级掷骰量纲。
 */
const AI_PREVENTION_GAIN = 1
const AI_FOOD_FLOOR = 100
const AI_FOOD_REFILL = 500
const ROLL_MAX = 99

/** 君主性格（0..4 = 和平/大义/奸诈/狂人/冒进）→ 策略阈值（5.2）。 */
const AI_INTERNAL_THRESHOLD: readonly number[] = [50, 40, 30, 20, 10]
const AI_DIPLO_THRESHOLD: readonly number[] = [80, 70, 70, 40, 20]

export type AiStrategy = 'internal' | 'diplomacy' | 'military'

/**
 * 5.2 选策略：R < 内政阈值 → 内政；否则 R < 外交阈值 → 外交；否则军备。
 * 纯函数（不耗 RNG，掷骰在调用方）便于单测阈值边界。
 */
export function pickStrategy(personality: Personality, roll: number): AiStrategy {
  if (roll < AI_INTERNAL_THRESHOLD[personality]!) return 'internal'
  if (roll < AI_DIPLO_THRESHOLD[personality]!) return 'diplomacy'
  return 'military'
}

/**
 * 推进 AI 月度经营（月末 endMonth 最前调用）：
 * 兜底（5.3）→ 自动升级（5.4）→ 逐 AI 城（id 升序）按君主性格选路径并跑对应模块（5.2/5.5）。
 */
export function aiTakeTurn(state: GameState, config: GameConfig): GameState {
  let next = runAiLevelUp(runAiBottomLine(state), config)
  const aiCities = Object.values(next.cities)
    .filter((c) => c.lordId !== null && c.lordId !== next.playerLordId)
    .sort(byId)
  for (const c of aiCities) next = runCityStrategy(next, c.id)
  return next
}

/** 单座 AI 城：掷一次骰按君主性格选路径，委派对应叶模块。 */
function runCityStrategy(state: GameState, cityId: CityId): GameState {
  const lordId = state.cities[cityId]!.lordId
  if (lordId === null) return state
  const lord = state.officers[lordId]
  if (!lord) return state
  const [roll, rng] = randInt(state.rng, 0, ROLL_MAX)
  const seeded = { ...state, rng }
  switch (pickStrategy(lord.personality, roll)) {
    case 'internal':
      return runAiInternal(seeded, cityId)
    case 'diplomacy':
      return runAiDiplomacy(seeded, cityId)
    case 'military':
      return runAiMilitary(seeded, cityId)
  }
}

/**
 * 5.3 兜底：对每座非玩家城——状态强制 normal（等于 AI 城免疫一切灾害）、
 * 防灾 +1 封顶、粮 < 100 直接补到 500（无中生有）。不消耗 RNG。
 */
export function runAiBottomLine(state: GameState): GameState {
  const cities = { ...state.cities }
  for (const c of Object.values(state.cities)) {
    if (c.lordId === null || c.lordId === state.playerLordId) continue
    const normalized = raisePrevention(setStatus(c, 'normal'), AI_PREVENTION_GAIN)
    cities[c.id] =
      normalized.food < AI_FOOD_FLOOR ? { ...normalized, food: AI_FOOD_REFILL } : normalized
  }
  return { ...state, cities }
}

/**
 * 5.4 自动升级：rate=0 整体跳过且不动 RNG；rate>0 时按 id 升序对每名
 * 非玩家（lordId≠playerLordId）、非在野（lordId≠null）、非俘虏武将
 * RandInt(0,99) < rate → levelUp。玩家武将永不受影响。
 */
export function runAiLevelUp(state: GameState, config: GameConfig): GameState {
  if (config.aiLevelUpRate <= 0) return state
  const officers = { ...state.officers }
  let rng = state.rng
  const sorted = Object.values(state.officers).sort(byId)
  for (const o of sorted) {
    if (o.lordId === null || o.lordId === state.playerLordId) continue
    if (isCaptive(state, o.id)) continue
    const [roll, next] = randInt(rng, 0, ROLL_MAX)
    rng = next
    if (roll < config.aiLevelUpRate) officers[o.id] = levelUp(officers[o.id]!)
  }
  return { ...state, officers, rng }
}
