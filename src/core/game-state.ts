import type { Rng } from './shared/rng'
import type { CityId, OfficerId } from './shared/ids'
import type { City } from './world/city'
import type { Officer } from './world/officer'

/**
 * 效果延到月末执行的指令项；月末由 turn 层按 type 分派（与 game.apply 同构）。
 * 后续新增「月末执行类」指令在此并集追加一个分支。
 * 掠夺目标 = 执行人本城（officer.cityId，本切片武将不跨城），故只存 officerId、不另存 cityId。
 */
export type PendingCommand = { readonly type: 'plunder'; readonly officerId: OfficerId }

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
  /**
   * 本月待月末执行的指令，按下令顺序入队；月末 runPendingCommands 执行后清空。
   * 仅「效果延后」指令入队（本切片仅掠夺）；占人本身仍由 Officer.busy 表达。
   */
  readonly pendingCommands: readonly PendingCommand[]
}
