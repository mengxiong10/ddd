import type { FeedbackItem } from '../../store/game-store'
import type {
  Action,
  CityId,
  GameState,
  ItemId,
  OfficerId,
  OutcomeEvent,
  ReasonCode,
} from '../../store/selectors'

/**
 * 反馈 → 中文（`19-store-ui`）：core/store 零中文，本模块是中文运行时文案的**唯一**落点。
 * 多变体台词在此 Math.random 随机挑选（非 core RNG）；可见性过滤亦在此（非玩家相关事件返回 null）。
 * 对照 docs/business-command-rules.md。
 */

/** 失败原因码 → 中文（穷举 Record 保证不漏码）。 */
const REASON_TEXT: Record<ReasonCode, string> = {
  'officer-not-found': '城中无空闲武将',
  'officer-busy': '该将本月已有任务',
  'officer-not-available': '城中无空闲武将',
  'is-captive': '该将为俘虏，无法执行',
  'city-not-found': '城池不存在',
  'gold-insufficient': '无足够金钱',
  'stamina-insufficient': '该将体力不足',
  'food-insufficient': '粮食不足',
  'reserve-troops-insufficient': '后备兵不足',
  'target-city-not-found': '目标城池不存在',
  'target-is-self-city': '我方城池',
  'target-not-friendly-city': '需选择我方城池',
  'target-not-enemy-city': '需选择敌方城池',
  'target-is-friendly-city': '我方城池',
  'target-not-adjacent': '无法到达',
  'invalid-amount': '数量不合法',
  'exceeds-allocatable': '无兵可分配',
  'exceeds-recruitable': '超出可征兵上限',
  'invalid-provisions': '随军粮草不合法',
  'agriculture-capped': '已达农业上限',
  'commerce-capped': '已达商业上限',
  'prevention-capped': '防灾已达上限',
  'invalid-campaign-size': '无可出征武将',
  'duplicate-officers': '出征名单重复',
  'officers-not-same-city': '出征武将须同城',
  'captive-not-found': '城中无俘虏',
  'captive-not-in-city': '城中无俘虏',
  'target-not-captive': '目标非俘虏',
  'item-not-found': '城中无道具',
  'item-not-in-city': '城中无道具',
  'item-undiscovered': '该道具尚未发现',
  'officer-items-full': '该将道具已满',
  'item-not-held-by-officer': '该将无此道具',
  'target-not-found': '目标不存在',
  'target-not-enemy-officer': '需选择敌方武将',
  'target-not-enemy-governor': '需选择敌方太守',
  'target-not-enemy-lord': '需选择敌方君主',
  'cannot-induce-own-lord': '不能劝降我方君主',
  'city-power-insufficient': '实力不足，无法劝降',
  'already-wandering': '该将已在野',
  'cannot-banish-active-lord': '不能流放在任君主',
  'no-pending-succession': '当前无须拥立新君',
  'invalid-successor': '新君人选不合法',
  'no-pending-defense': '当前无须选择守军',
  'duplicate-defenders': '守军名单重复',
  'too-many-defenders': '守军过多',
  'invalid-defenders': '守军不合法',
  'battle-in-progress': '战斗进行中',
  'pending-succession': '请先拥立新君',
  'pending-defense': '请先处理守军来犯',
  'no-active-battle': '当前无进行中的战斗',
  'battle-ended': '战斗已结束',
  'unit-not-found-or-routed': '该单位不存在或已被击溃',
  'not-player-unit': '非我方单位',
  'unit-already-acted': '该单位本日已行动',
  'cannot-act-status': '该单位当前无法行动',
  'move-unreachable': '无法到达该处',
  'attack-out-of-range': '攻击超出射程',
  'no-enemy-at-target': '目标处无敌军',
  'cannot-cast-status': '该单位当前无法施法',
  'skill-not-found': '无此计谋',
  'skill-not-learned': '尚未习得该计谋',
  'mp-insufficient': '技能点不足',
  'weather-terrain-forbidden': '当前天气/地形不可施放',
  'target-required': '需选择目标',
  'skill-out-of-range': '目标超出范围',
  'no-unit-at-target': '目标处无单位',
  'skill-needs-enemy': '该计谋须对敌方施放',
  'skill-needs-ally': '该计谋须对友军施放',
  'weather-terrain-troop-forbidden': '当前天气/地形/兵种不可施放',
}

export function reasonText(reason: ReasonCode): string {
  return REASON_TEXT[reason]
}

const pick = (variants: readonly string[]): string =>
  variants[Math.floor(Math.random() * variants.length)]!

const officerName = (game: GameState, id: OfficerId): string =>
  game.officers[id]?.name ?? String(id)
const cityName = (game: GameState, id: CityId): string => game.cities[id]?.name ?? String(id)
const itemName = (game: GameState, id: ItemId): string => game.items[id]?.name ?? String(id)

const STATUS_TEXT: Record<'famine' | 'drought' | 'flood' | 'riot', string> = {
  famine: '饥荒',
  drought: '旱灾',
  flood: '水灾',
  riot: '暴动',
}

const RECRUIT_LINES = [
  '某愿效死忠。',
  '在下不才，蒙明公不弃，愿效犬马之劳。',
  '某虽不才，愿为主公效劳。',
  '请主公期待我的表现吧。',
]
const SUBORN_FAIL_LINES = [
  '哼！我岂是贪生怕死之徒！',
  '你还是少费唇舌，我是不会背信弃义的！',
  '就凭你要我归降，笑话！',
]
const ENTICE_SUCCESS_LINES = [
  '良禽择木而栖，贤臣择主而仕。',
  '闻君贤名久矣，愿为君牵马坠镫！',
  '赴汤蹈火，在所不辞！',
]
const ENTICE_FAIL_LINES = ['燕雀安知鸿鹄之志哉！', '无能之辈，焉敢如此！', '忠臣不仕二主！']
const INDUCE_SUCCESS_LINES = [
  '事到如今，也只好降了……',
  '此乃天命，请明公善待我的部属和百姓。',
  '我乃竭诚投降，请明公勿疑！',
]
const INDUCE_FAIL_LINES = [
  '此事不必再说，战场上分高低！',
  '笑话，该投降的是你们吧！',
  '大胆！竟敢小看我，滚回去喜好脖子！',
]
// —— 下令成功确认台词（纯 UI，core 不产；多数命令无台词 → null）——
const SEARCH_LORD_LINES = [
  '我去城中访贤，各位费心留守了。',
  '好的人才，要亲自去找才行。',
  '为了今后大业，城中看看也非坏事。',
]
const SEARCH_OFFICER_LINES = [
  '此事便交给我，有利的消息我都会带回来。',
  '属下这就动身，主公就静待佳音吧。',
  '属下会留心各种消息，以期有所得。',
]
const REWARD_LINES = [
  '我决不会辜负主公对我的期望！',
  '请期待我日后的表现！',
  '臣定鞠躬尽瘁，以报答主公之恩！',
]
const CONFISCATE_LINES = [
  '一片忠诚，竟遭此待遇……',
  '长此以往，人心难留……',
  '主公此举自有道理，我却无法理解……',
]
const BEHEAD_LINES = [
  '哈……，来吧，十八年后又是一条好汉！',
  '死，我岂会恐惧？',
  '天命吾身踏黄泉，定起万军夺阴巢！',
]

/** 下令成功的确认台词；无专门台词的命令（开垦/招商/治理/出巡/征兵/交易/分配/侦察/外交等）返回 null。 */
function issuedText(action: Action, game: GameState): string | null {
  switch (action.type) {
    case 'search':
      return action.officerId === game.playerLordId
        ? pick(SEARCH_LORD_LINES)
        : pick(SEARCH_OFFICER_LINES)
    case 'move':
    case 'transport':
      return '马上出发。'
    case 'plunder':
      return '我虽不愿如此，但也是不得已。'
    case 'campaign':
      return '部队已出发。'
    case 'suborn':
      return '凭我的三寸不烂之舌，定让他回心转意。'
    case 'reward':
      return pick(REWARD_LINES)
    case 'confiscate':
      return pick(CONFISCATE_LINES)
    case 'banquet':
      return '主公恩情，永铭于心……'
    case 'behead':
      return pick(BEHEAD_LINES)
    default:
      return null
  }
}

/** 事件是否与玩家相关（决定是否弹 toast）。系统级重大事件恒可见。 */
function isPlayerRelevant(event: OutcomeEvent, game: GameState): boolean {
  const player = game.playerLordId
  const ownedBy = (officerId: OfficerId) => game.officers[officerId]?.lordId === player
  switch (event.kind) {
    case 'develop-done':
    case 'govern-done':
    case 'patrol-done':
    case 'search-none':
    case 'search-recruited':
    case 'search-found-not-recruited':
    case 'search-item':
    case 'search-resource':
    case 'plunder-done':
    case 'transport-delivered':
    case 'transport-robbed':
      return ownedBy(event.officerId)
    case 'suborn-result':
      return ownedBy(event.officerId)
    case 'diplomacy-result':
      return ownedBy(event.officerId) || ownedBy(event.targetOfficerId)
    case 'city-disaster':
      return game.cities[event.cityId]?.lordId === player
    case 'city-recovered':
      return false // 恢复正常本身不独立提示（见 business-rules）
    // 系统级重大事件：恒可见
    case 'lord-surrendered':
    case 'lord-instigated':
    case 'lord-stricken':
    case 'succession-pending':
    case 'lord-succeeded':
    case 'lord-eliminated':
      return true
  }
}

function eventText(event: OutcomeEvent, game: GameState): string {
  switch (event.kind) {
    case 'develop-done': {
      const label = event.attr === 'agriculture' ? '农业' : '商业'
      return `${label}开发度变为 ${event.newValue} (+${event.delta})。`
    }
    case 'govern-done':
      return `城市状态正常，防灾变为 ${event.newPrevention} (+${event.delta})。`
    case 'patrol-done':
      return `民忠变为 ${event.newLoyalty} (+${event.loyaltyDelta})。`
    case 'search-none':
      return '什么也没找到……'
    case 'search-recruited':
      return `城中找到 ${officerName(game, event.targetId)}。${pick(RECRUIT_LINES)}`
    case 'search-found-not-recruited':
      return '听说城中有位贤者，可惜臣未能访到。'
    case 'search-item':
      return `城中找到 ${itemName(game, event.itemId)}。`
    case 'search-resource':
      return event.resource === 'gold'
        ? `城中找到金钱 ${event.amount}。`
        : `城中找到粮食 ${event.amount}。`
    case 'plunder-done':
      return `掠得金钱 ${event.goldGained}；夺得粮食 ${event.foodGained}。`
    case 'transport-delivered':
      return '物资运送完毕。'
    case 'transport-robbed':
      return '途中遇到山贼，所输送物质被抢劫一空！'
    case 'suborn-result':
      return event.success
        ? `${officerName(game, event.captiveId)} 我愿加入，为主公效力！`
        : pick(SUBORN_FAIL_LINES)
    case 'diplomacy-result':
      return diplomacyText(event, game)
    case 'lord-surrendered':
      return `${officerName(game, event.fromLordId)} 势力归降 ${officerName(game, event.toLordId)}。`
    case 'lord-instigated':
      return `${officerName(game, event.officerId)} 被策反成为君主。`
    case 'city-disaster':
      return `${cityName(game, event.cityId)} 出现 ${STATUS_TEXT[event.status]}，须尽快治理。`
    case 'city-recovered':
      return '' // 不展示（isPlayerRelevant 已过滤）
    case 'lord-stricken':
      return `君主 ${officerName(game, event.lordId)} 遭劫。`
    case 'succession-pending':
      return '请拥立新君。'
    case 'lord-succeeded':
      return `${officerName(game, event.newLordId)} 成为君主。`
    case 'lord-eliminated':
      return `${officerName(game, event.lordId)} 势力灭亡。`
  }
}

function diplomacyText(
  event: Extract<OutcomeEvent, { kind: 'diplomacy-result' }>,
  game: GameState
): string {
  const target = officerName(game, event.targetOfficerId)
  switch (event.command) {
    case 'entice':
      return event.success ? `${target} ${pick(ENTICE_SUCCESS_LINES)}` : pick(ENTICE_FAIL_LINES)
    case 'alienate':
      return event.success ? `${target} 离间奏效，忠诚动摇。` : `${target} 离间未能得逞。`
    case 'instigate':
      return event.success ? `${target} 被策反，自立门户。` : `${target} 不为所动。`
    case 'induce':
      return event.success ? pick(INDUCE_SUCCESS_LINES) : pick(INDUCE_FAIL_LINES)
  }
}

/**
 * 反馈项 → toast 文案。失败恒展示（玩家自己的命令）；事件经可见性过滤，非玩家相关返回 null。
 */
export function feedbackText(item: FeedbackItem, game: GameState): string | null {
  if (item.payload.kind === 'failure') return reasonText(item.payload.reason)
  if (item.payload.kind === 'issued') return issuedText(item.payload.action, game)
  if (!isPlayerRelevant(item.payload.event, game)) return null
  return eventText(item.payload.event, game)
}
