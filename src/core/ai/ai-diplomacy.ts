import type { GameState, PendingCommand } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { Rng } from '../shared/rng'
import { randInt, pickRandom } from '../shared/rng'
import { captivesInCity, isCaptive } from '../world/queries'
import { isEnemyServingNonLord, isInstigateTarget } from '../economy/diplomacy'
import { behead } from '../economy/captive'
import { aiServingOfficers, busyEnqueue, byId } from './ai-shared'

const DIPLO_ROLL_MAX = 7
type EnqueueDiploType = 'entice' | 'alienate' | 'instigate' | 'induce'

/**
 * 外交模块（5.5.3）：对在任武将（id 升序）逐人 RandInt(0,7) 分派。
 * 0 招降 / 1 处斩为**即时**俘虏处置（不入队、不占人）；2/7 跳过；
 * 3 离间 / 4 招揽 / 5 策反 / 6 劝降为入队命令（池非空才入队，复用月末 executeX）。
 */
export function runAiDiplomacy(state: GameState, cityId: CityId): GameState {
  const serving = aiServingOfficers(state, cityId)
  const lordId = state.cities[cityId]!.lordId
  let next = state
  let rng = next.rng
  for (const o of serving) {
    const [roll, r1] = randInt(rng, 0, DIPLO_ROLL_MAX)
    rng = r1
    const step = ((): readonly [GameState, Rng] => {
      switch (roll) {
        case 0:
          return suborn(next, cityId, lordId, rng)
        case 1:
          return behave(next, cityId, rng)
        case 3:
          return enqueuePool(next, o.id, rng, enemyServing(next, lordId), 'alienate')
        case 4:
          return enqueuePool(next, o.id, rng, enemyServing(next, lordId), 'entice')
        case 5:
          return enqueuePool(next, o.id, rng, instigateTargets(next, lordId), 'instigate')
        case 6:
          return enqueuePool(next, o.id, rng, enemyLords(next, lordId), 'induce')
        default:
          return [next, rng] // 2/7：跳过
      }
    })()
    next = step[0]
    rng = step[1]
  }
  return { ...next, rng }
}

/** 即时招降：随机选本城俘虏，归属改本势力（派生不再是俘虏）。无俘虏跳过。 */
function suborn(
  state: GameState,
  cityId: CityId,
  lordId: OfficerId,
  rng: Rng
): readonly [GameState, Rng] {
  const captives = captivesInCity(state, cityId)
  if (captives.length === 0) return [state, rng]
  const [cap, next] = pickRandom(rng, captives)
  const officer = { ...state.officers[cap.id]!, lordId }
  return [{ ...state, officers: { ...state.officers, [cap.id]: officer } }, next]
}

/** 即时处斩：随机选本城俘虏并删除（复用 behead，道具退城）。无俘虏跳过。 */
function behave(state: GameState, cityId: CityId, rng: Rng): readonly [GameState, Rng] {
  const captives = captivesInCity(state, cityId)
  if (captives.length === 0) return [state, rng]
  const [cap, next] = pickRandom(rng, captives)
  return [behead(state, cap.id).state, next]
}

/** 池非空则随机选目标入队对应外交命令（置 busy）；池空跳过。 */
function enqueuePool(
  state: GameState,
  officerId: OfficerId,
  rng: Rng,
  pool: readonly OfficerId[],
  type: EnqueueDiploType
): readonly [GameState, Rng] {
  if (pool.length === 0) return [state, rng]
  const [target, next] = pickRandom(rng, pool)
  const cmd = { type, officerId, targetOfficerId: target } as PendingCommand
  return [busyEnqueue(state, officerId, cmd), next]
}

/** 敌方在任非君主武将池（招揽/离间），id 升序。 */
function enemyServing(state: GameState, lordId: OfficerId): OfficerId[] {
  return Object.values(state.officers)
    .filter((o) => isEnemyServingNonLord(state, lordId, o.id))
    .sort(byId)
    .map((o) => o.id)
}

/** 敌方太守（非君主）池（策反），id 升序。 */
function instigateTargets(state: GameState, lordId: OfficerId): OfficerId[] {
  return Object.values(state.officers)
    .filter((o) => isInstigateTarget(state, lordId, o.id))
    .sort(byId)
    .map((o) => o.id)
}

/** 敌方君主池（劝降）：非己方、非俘虏、lordId===自身，id 升序。 */
function enemyLords(state: GameState, lordId: OfficerId): OfficerId[] {
  return Object.values(state.officers)
    .filter((o) => o.lordId === o.id && o.id !== lordId && !isCaptive(state, o.id))
    .sort(byId)
    .map((o) => o.id)
}
