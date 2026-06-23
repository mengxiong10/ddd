import type { Rng } from './shared/rng'
import type { CityId, ItemId, OfficerId } from './shared/ids'
import type { City } from './world/city'
import type { Officer } from './world/officer'
import type { Item } from './world/item'
import type { Adjacency } from './world/adjacency'
import type { BattleState } from './military/battle'
import type { BattleMapCatalog } from './military/battle-map'

/**
 * 效果延到月末执行的指令项；月末由 turn 层经 economy/registry 的 economyMonthRun 表按 type 分派
 * （与 game.apply 经同表的 can/call 分派同构——命令三阶段 can/call/run 同处注册）。
 * 后续新增「月末执行类」指令在 registry 追加一条（含 run），并在此并集追加对应分支。
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
  // suborn：招降——执行人 + 被招降的本城俘虏；月末四关判定（见 economy/suborn.executeSuborn）。
  | { readonly type: 'suborn'; readonly officerId: OfficerId; readonly captiveId: OfficerId }
  // 外交（10-diplomacy）：执行人 + 敌方目标武将（武将/太守/君主）；月末判定见 economy/diplomacy。
  | { readonly type: 'entice'; readonly officerId: OfficerId; readonly targetOfficerId: OfficerId }
  | {
      readonly type: 'alienate'
      readonly officerId: OfficerId
      readonly targetOfficerId: OfficerId
    }
  | {
      readonly type: 'instigate'
      readonly officerId: OfficerId
      readonly targetOfficerId: OfficerId
    }
  | { readonly type: 'induce'; readonly officerId: OfficerId; readonly targetOfficerId: OfficerId }
  // 即时生效的占人指令（效果已于下令时结算）。月末无效果、仅作占用标记
  // （占用中 = 被某条 pending command 引用，见 queries.isBusy）；按各自 type 区分以如实反映占人在做什么。
  // 开垦/招商拆为 reclaim/commerce 两个 type，与各自 action type 一一对应。
  | { readonly type: 'reclaim'; readonly officerId: OfficerId }
  | { readonly type: 'commerce'; readonly officerId: OfficerId }
  | { readonly type: 'patrol'; readonly officerId: OfficerId }
  | { readonly type: 'govern'; readonly officerId: OfficerId }
  | { readonly type: 'trade'; readonly officerId: OfficerId }
  | { readonly type: 'scout'; readonly officerId: OfficerId }
  | { readonly type: 'recruit'; readonly officerId: OfficerId }

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
  /** data 层注入的战斗地图目录；core 不加载具体地图数据。 */
  readonly battleMaps: BattleMapCatalog
  /**
   * 本月待月末执行的指令，按下令顺序入队；月末由 turn 层处理后清空。
   * 非 campaign 项经 runNonCampaignPending（查 economy/registry 的 economyMonthRun 表）执行；
   * campaign 项由 end-month 逐条结算/挂起战斗。
   * 所有占人指令均入队；占用中 = 被某条 pending command 引用（queries.isBusy 派生），不存 Officer.busy。
   * 即时生效指令的月末分支为空操作（仅作占用标记，出队即释放）。
   */
  readonly pendingCommands: readonly PendingCommand[]
  /**
   * 进行中的战斗（交互式子对局）；非 null 表示月末挂起在战斗中、经 BattleAction 推进。
   * 分胜负后由 turn.resumeMonth 写回并清空、续跑月末。普通态恒为 null。
   */
  readonly activeBattle: BattleState | null
  /**
   * 待玩家选新君（`14-campaign-aftermath`）：非空=月末挂起在「玩家君主遭劫、等手动立新君」，
   * 经 chooseSuccessor action 兑现后续跑月末。仅玩家势力触发（AI 立即自动立新君）。普通态恒为 null。
   */
  readonly pendingSuccession: { readonly lordId: OfficerId } | null
  /**
   * 待玩家选守军（`16-ai-campaign`）：非空=月末挂起在「AI 进攻玩家城、等玩家挑选出战守军」，
   * 经 chooseDefenders action 兑现（开战或弃守占城）后清空。仅玩家防守触发。普通态恒为 null。
   * 类比 pendingSuccession：窄态、攻方/粮草从待执行队列首个 campaign 派生。
   */
  readonly pendingDefense: { readonly targetCityId: CityId } | null
}
