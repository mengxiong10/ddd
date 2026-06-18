import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import { randInt, pickRandom } from '../shared/rng'
import { levelUp, setTroops, troopCapacity } from '../world/officer'
import { effectiveOfficer } from '../world/queries'
import { aiServingOfficers } from './ai-shared'

const MILITARY_ROLL_MAX = 8
/** 军备每 3 个月给强化对象升一次级（month % 3 === 0）。 */
const MILITARY_LEVELUP_PERIOD = 3

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
    // 0/6/8 跳过；
    // TODO(15-ai-economy 后续「AI 军事」切片): roll===7 生成 AI 出征命令——
    //   仅本模块第 1 次遍历尝试、本城周围有相邻敌城、50% 概率继续、目标取最弱相邻敌城
    //   （守军兵力合计最低）、可出征武将 ≥4 且最高兵力 ≥1000、最多带 10 人留 1 守城、粮草填满。
  }
  return { ...next, rng }
}

/** 把强化对象兵力补满至有效带兵量上限（吃有效武力/智力）；不扣金、不动后备兵。 */
function refill(state: GameState, targetId: OfficerId): GameState {
  const cap = troopCapacity(effectiveOfficer(state, targetId))
  return {
    ...state,
    officers: { ...state.officers, [targetId]: setTroops(state.officers[targetId]!, cap) },
  }
}
