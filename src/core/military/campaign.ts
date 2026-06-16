import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import { addFood } from '../world/city'
import { resolveSuccession } from '../world/succession'

/**
 * 月末执行出征（供 turn 层按 type 分派）。本切片战斗从简、确定性、不耗 RNG、无兵力损耗：
 * 攻方兵力 = Σ 出征武将兵；守方兵力 = Σ(目标城内归属方武将兵) + 城后备兵（排除俘虏）。
 * 攻方 **严格大于** 守方才胜，否则守方胜（含平局）。
 * 结算：出征武将不论胜负 cityId 都移到目标城（胜=进驻、败=就地成俘虏）；
 * 攻方胜则目标城 lordId 改攻方且城粮 += 随军粮草（败则随军粮草已于下令时损失）。
 * 末了对守/攻两方君主各跑一次 resolveSuccession（未被俘即 no-op）。
 */
export function executeCampaign(
  state: GameState,
  officerIds: readonly OfficerId[],
  targetCityId: CityId,
  provisions: number,
): GameState {
  const sourceCityId = state.officers[officerIds[0]!]!.cityId
  const attackerLord = state.cities[sourceCityId]!.lordId
  const target = state.cities[targetCityId]!
  const defenderLord = target.lordId

  const attackerStrength = officerIds.reduce((sum, id) => sum + state.officers[id]!.troops, 0)
  const defenderStrength = defenderTroops(state, targetCityId)
  const attackerWins = attackerStrength > defenderStrength

  const officers = { ...state.officers }
  for (const id of officerIds) officers[id] = { ...officers[id]!, cityId: targetCityId }

  const cities = { ...state.cities }
  if (attackerWins) {
    cities[targetCityId] = { ...addFood(target, provisions), lordId: attackerLord }
  }

  let next: GameState = { ...state, officers, cities }
  next = resolveSuccession(next, defenderLord)
  next = resolveSuccession(next, attackerLord)
  return next
}

/** 守方兵力：目标城内「归属方」武将兵之和 + 城后备兵（排除城内俘虏）。 */
function defenderTroops(state: GameState, cityId: CityId): number {
  const ownerLord = state.cities[cityId]!.lordId
  const fromOfficers = Object.values(state.officers)
    .filter((o) => o.cityId === cityId && o.lordId === ownerLord)
    .reduce((sum, o) => sum + o.troops, 0)
  return fromOfficers + state.cities[cityId]!.reserveTroops
}
