import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { WithEvents } from '../shared/outcome'
import { randInt } from '../shared/rng'
import { resolveCampaignOutcome } from './aftermath'

/**
 * 进攻方速算胜率(%)，规则身份内联（`16-ai-campaign`）。A/D=攻/守总兵力，FA/FD=攻/守粮草：
 * A===0 → 0；D===0 → 100；A≥2D → 70；A>D → 粮多 60 / 粮不占优 40；
 * 2A<D（不到一半）→ 2；其余（A≤D，含相等）→ 粮多 30 / 否则 10。
 * 不看地形/技能/兵种/操作。
 */
export function attackerWinPercent(a: number, d: number, fa: number, fd: number): number {
  if (a === 0) return 0
  if (d === 0) return 100
  if (a >= 2 * d) return 70
  if (a > d) return fa > fd ? 60 : 40
  if (2 * a < d) return 2
  return fa > fd ? 30 : 10
}

/**
 * 速算一条 campaign（无地图战），组装 CampaignOutcome 交 resolveCampaignOutcome 走完整战后处理。
 * A=Σ攻方现兵；D=Σ守方现兵 + 目标城后备兵；FA=随军粮草、FD=目标城粮。
 * defenderIds 为空 → 无守军直接占城（attackerWins=true、不掷骰、不耗 RNG）；
 * 否则掷 RandInt(0,99) < attackerWinPercent 定胜负（消耗 state.rng）。
 * mergedFood=随军粮草+目标城粮（覆盖式合并，同 14-campaign-aftermath）。
 */
export function quickResolveCampaign(
  state: GameState,
  attackerIds: readonly OfficerId[],
  defenderIds: readonly OfficerId[],
  targetCityId: CityId,
  provisions: number
): WithEvents<GameState> {
  const target = state.cities[targetCityId]!
  const sumTroops = (ids: readonly OfficerId[]): number =>
    ids.reduce((s, id) => s + (state.officers[id]?.troops ?? 0), 0)

  let next = state
  let attackerWins = true
  if (defenderIds.length > 0) {
    const a = sumTroops(attackerIds)
    const d = sumTroops(defenderIds) + target.reserveTroops
    const [roll, rng] = randInt(state.rng, 0, 99)
    next = { ...state, rng }
    attackerWins = roll < attackerWinPercent(a, d, provisions, target.food)
  }

  return resolveCampaignOutcome(next, {
    attackerWins,
    attackerLord: next.officers[attackerIds[0]!]!.lordId!,
    targetCityId,
    attackerIds,
    defenderIds,
    mergedFood: provisions + target.food,
  })
}
