import type { GameState } from '../game-state'
import type { CityId } from '../shared/ids'
import { pickRandomCityWithRng } from './placement'

/** 月末登场：先武将、后独立道具，各按数字 id 升序。 */
export function runDebuts(state: GameState): GameState {
  let rng = state.rng
  let changed = false
  const officers = { ...state.officers }
  const items = { ...state.items }

  for (const officer of Object.values(state.officers).sort((a, b) => a.id - b.id)) {
    if (officer.cityId !== null || state.year < officer.appearanceConditions.birth + 16) continue
    let cityId: CityId
    if (officer.appearanceConditions.cityId !== null) {
      cityId = officer.appearanceConditions.cityId
    } else {
      const [picked, next] = pickRandomCityWithRng(state, rng)
      cityId = picked
      rng = next
    }
    officers[officer.id] = { ...officer, cityId }
    changed = true
  }

  for (const item of Object.values(state.items).sort((a, b) => a.id - b.id)) {
    if (item.holder !== null || state.year < item.appearanceConditions.birth) continue
    let cityId: CityId
    if (item.appearanceConditions.cityId !== null) {
      cityId = item.appearanceConditions.cityId
    } else {
      const [picked, next] = pickRandomCityWithRng(state, rng)
      cityId = picked
      rng = next
    }
    items[item.id] = { ...item, holder: { kind: 'city', cityId } }
    changed = true
  }

  return changed ? { ...state, rng, officers, items } : state
}
