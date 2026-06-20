import type { GameState } from '../game-state'
import { withEvents, type WithEvents, type OutcomeEvent } from '../shared/outcome'
import type { Rng } from '../shared/rng'
import { randInt } from '../shared/rng'
import type { City } from './city'
import { applyDisasterDamage, setStatus } from './city'

/**
 * 灾害掷骰量纲（规则身份，内联）：生成/恢复的过筛与灾种判定均在 [0, 99]，灾种值在 [0, 4]。
 */
const ROLL_MIN = 0
const ROLL_MAX = 99
const KIND_MIN = 0
const KIND_MAX = 4

/**
 * 正常城灾害生成（消费 RNG）：
 * R=randInt(0,99)；R ≤ 防灾值 → 无灾；否则灾种=randInt(0,4)：
 *   0 旱灾 / 1 水灾 / 2 再 randInt(0,99)>民忠 → 暴动否则无事 / 3、4 无事。
 */
function generate(city: City, rng: Rng): readonly [City, Rng] {
  const [r, rng1] = randInt(rng, ROLL_MIN, ROLL_MAX)
  if (r <= city.disasterPrevention) return [city, rng1]
  const [kind, rng2] = randInt(rng1, KIND_MIN, KIND_MAX)
  switch (kind) {
    case 0:
      return [setStatus(city, 'drought'), rng2]
    case 1:
      return [setStatus(city, 'flood'), rng2]
    case 2: {
      const [r2, rng3] = randInt(rng2, ROLL_MIN, ROLL_MAX)
      return [r2 > city.loyalty ? setStatus(city, 'riot') : city, rng3]
    }
    default:
      return [city, rng2] // 灾种 3、4：无事
  }
}

/**
 * 异常城（已破坏后）恢复判定：
 *   饥荒 → 粮食>0 即 normal（不耗 RNG）；
 *   旱灾/水灾 → randInt(0,99) < 防灾值 → normal；
 *   暴动 → randInt(0,99) < 民忠（破坏后值）→ normal。
 */
function recover(city: City, rng: Rng): readonly [City, Rng] {
  switch (city.status) {
    case 'famine':
      return [city.food > 0 ? setStatus(city, 'normal') : city, rng]
    case 'drought':
    case 'flood': {
      const [r, next] = randInt(rng, ROLL_MIN, ROLL_MAX)
      return [r < city.disasterPrevention ? setStatus(city, 'normal') : city, next]
    }
    case 'riot': {
      const [r, next] = randInt(rng, ROLL_MIN, ROLL_MAX)
      return [r < city.loyalty ? setStatus(city, 'normal') : city, next]
    }
    default:
      return [city, rng]
  }
}

/**
 * 月末灾害生命周期（turn/end-month 在登场后调用，月末最后一步）。
 * 按城 id 升序单趟遍历、线程化 rng（同 runDebuts 手法，保确定性）：
 *  - 异常城：applyDisasterDamage（破坏，不耗 RNG）→ recover（先破坏后判恢复，用破坏后值）。
 *  - 正常城：generate（判生成）。
 * 含 AI 城；无归属空城跳过（当前模型城恒有归属）。纯函数、可注入 RNG。
 */
export function runDisasters(state: GameState): WithEvents<GameState> {
  const ids = Object.keys(state.cities).sort()
  let rng = state.rng
  const cities: Record<string, City> = { ...state.cities }
  const events: OutcomeEvent[] = []
  for (const id of ids) {
    const city = cities[id]!
    if (city.status === 'normal') {
      const [next, r] = generate(city, rng)
      rng = r
      cities[id] = next
      // 正常→异常：新发灾害事件（status 取四灾之一）。
      if (next.status !== 'normal')
        events.push({ kind: 'city-disaster', cityId: id, status: next.status })
    } else {
      const damaged = applyDisasterDamage(city, city.status)
      const [next, r] = recover(damaged, rng)
      rng = r
      cities[id] = next
      // 异常→正常：灾情缓解事件。
      if (next.status === 'normal') events.push({ kind: 'city-recovered', cityId: id })
    }
  }
  return withEvents({ ...state, rng, cities }, events)
}
