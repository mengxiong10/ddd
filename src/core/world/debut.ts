import type { DebutEntry, GameState } from '../game-state'
import type { CityId } from '../shared/ids'
import { pickRandomCityWithRng } from './placement'

/**
 * 月末登场（由 turn/end-month 在「月份+1」之后调用，用新年份判定）：
 * 凡 pendingDebuts 中 state.year ≥ debutYear 者登场——
 * 落城 = targetCityId（指定）或在全部城中随机选一（targetCityId=null，消费 RNG）；
 * 武将物化进 officers（补 cityId，lordId 仍为 null=在野、troops=0），道具物化进 items（补 holder=城、discovered=false），
 * 并移出池。按池数组序处理（随机落城逐条消费 RNG，保确定性）；未到年者留池。
 */
export function runDebuts(state: GameState): GameState {
  if (state.pendingDebuts.length === 0) return state

  let rng = state.rng
  const officers = { ...state.officers }
  const items = { ...state.items }
  const remaining: DebutEntry[] = []

  for (const entry of state.pendingDebuts) {
    if (state.year < entry.debutYear) {
      remaining.push(entry)
      continue
    }
    let cityId: CityId
    if (entry.targetCityId !== null) {
      cityId = entry.targetCityId
    } else {
      const [picked, next] = pickRandomCityWithRng(state, rng)
      rng = next
      cityId = picked
    }
    if (entry.type === 'officer') {
      officers[entry.officer.id] = { ...entry.officer, cityId }
    } else {
      items[entry.item.id] = { ...entry.item, holder: { kind: 'city', cityId } }
    }
  }

  return { ...state, rng, officers, items, pendingDebuts: remaining }
}
