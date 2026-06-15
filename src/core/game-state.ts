import type { Rng } from './shared/rng'
import type { CityId, OfficerId } from './shared/ids'
import type { City } from './world/city'
import type { Officer } from './world/officer'

/**
 * 对局根状态：唯一的可变态容器，由 apply 纯函数推进。
 * 不含配置（在 GameConfig），含 RNG seed 以保证可复现。
 */
export interface GameState {
  /** 当前年份。 */
  readonly year: number
  /** 当前月份，取值 1..12。 */
  readonly month: number
  /** 哪位君主是玩家（替代独立的势力实体 + isPlayer 标记）。 */
  readonly playerLordId: OfficerId
  /** 全部城池，按 id 索引。 */
  readonly cities: Readonly<Record<CityId, City>>
  /** 全部武将（含各君主本人），按 id 索引。 */
  readonly officers: Readonly<Record<OfficerId, Officer>>
  /** 随机源状态，随每次消费推进。 */
  readonly rng: Rng
}
