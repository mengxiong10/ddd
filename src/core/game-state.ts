import type { Rng } from './shared/rng'
import type { CityId, ItemId, OfficerId } from './shared/ids'
import type { City } from './world/city'
import type { Officer } from './world/officer'
import type { Item } from './world/item'
import type { Adjacency } from './world/adjacency'

/**
 * 效果延到月末执行的指令项；月末由 turn 层按 type 分派（与 game.apply 同构）。
 * 后续新增「月末执行类」指令在此并集追加一个分支。
 * - plunder：目标 = 执行人本城（officer.cityId，掠夺不跨城），故只存 officerId。
 * - campaign：出征——出发城 = 武将共同所在城（执行时仍在本城），故存武将集合 + 目标城 + 随军粮草
 *   （粮已于下令时扣，胜利并入被占城时需要）。
 * - move：移动——月末把武将落到目标己方城（占人例外，不回出发城），存 officerId + 目标城。
 * - transport：输送——资源已于下令时从出发城扣除，月末按概率送达目标城，存 officerId + 目标城 + 粮/金/兵。
 */
export type PendingCommand =
  | { readonly type: 'plunder'; readonly officerId: OfficerId }
  | {
      readonly type: 'campaign'
      readonly officerIds: readonly OfficerId[]
      readonly targetCityId: CityId
      readonly provisions: number
    }
  | { readonly type: 'move'; readonly officerId: OfficerId; readonly targetCityId: CityId }
  | {
      readonly type: 'transport'
      readonly officerId: OfficerId
      readonly targetCityId: CityId
      readonly food: number
      readonly gold: number
      readonly troops: number
    }
  // search：目标 = 执行人本城（officer.cityId，搜寻不跨城），故只存 officerId。
  | { readonly type: 'search'; readonly officerId: OfficerId }

/**
 * 待登场池条目（判别式）：未登场武将/道具的承载，登场前不进 officers/items。
 * 除「落城才能定」的字段外存全量——officer 用 Omit<…,'cityId'>（lordId 已为 null）、
 * item 用 Omit<…,'holder'>（discovered 已为 false）；登场时由 world/debut 补全落城字段。
 * debutYear/targetCityId 为调度元数据（targetCityId=null 表示随机落城）。
 */
export type DebutEntry =
  | {
      readonly type: 'officer'
      readonly debutYear: number
      readonly targetCityId: CityId | null
      readonly officer: Omit<Officer, 'cityId'>
    }
  | {
      readonly type: 'item'
      readonly debutYear: number
      readonly targetCityId: CityId | null
      readonly item: Omit<Item, 'holder'>
    }

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
  /** 全部道具，按 id 索引；归属（城/将）存于各道具的 holder（单一真相源）。 */
  readonly items: Readonly<Record<ItemId, Item>>
  /** 随机源状态，随每次消费推进。 */
  readonly rng: Rng
  /** 城邻接拓扑（静态，fixture 播种）；出征「可达=相邻」据此校验。 */
  readonly adjacency: Adjacency
  /**
   * 本月待月末执行的指令，按下令顺序入队；月末 runPendingCommands 执行后清空。
   * 仅「效果延后」指令入队（本切片仅掠夺）；占人本身仍由 Officer.busy 表达。
   */
  readonly pendingCommands: readonly PendingCommand[]
  /**
   * 未登场武将/道具池（独立于 officers/items）；月末「月份+1」后到达登场年者登场并出池。
   * 见 world/debut.runDebuts。
   */
  readonly pendingDebuts: readonly DebutEntry[]
}
