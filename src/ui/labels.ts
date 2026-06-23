import type {
  TroopType,
  CityStatus,
  Terrain,
  Weather,
  BattleStatus,
  Officer,
  Personality,
} from '../store/selectors'
import type { CommandKind, CommandGroup } from './world/command-draft'

/** UI 中文标签集中地（与 feedback/messages.ts 同属「中文只在 UI」；core/store 仍零中文）。 */

export const TROOP_LABEL: Record<TroopType, string> = {
  cavalry: '骑兵',
  infantry: '步兵',
  archer: '弓兵',
  navy: '水军',
  elite: '极兵',
  mystic: '玄兵',
}

export const STATUS_LABEL: Record<CityStatus, string> = {
  normal: '正常',
  famine: '饥荒',
  drought: '旱灾',
  flood: '水灾',
  riot: '暴动',
}

export const TERRAIN_LABEL: Record<Terrain, string> = {
  grass: '草地',
  plain: '平原',
  mountain: '山地',
  forest: '森林',
  village: '村庄',
  city: '城池',
  camp: '营寨',
  river: '河流',
}

export const WEATHER_LABEL: Record<Weather, string> = {
  clear: '晴',
  overcast: '阴',
  wind: '风',
  rain: '雨',
  hail: '雹',
}

export const BATTLE_STATUS_LABEL: Record<BattleStatus, string> = {
  normal: '正常',
  confused: '混乱',
  sealed: '禁咒',
  rooted: '定身',
  qimen: '奇门',
  stone: '石阵',
  dead: '溃败',
}

const LORD_PERSONALITY = ['和平', '大义', '奸诈', '狂人', '冒进']
const OFFICER_PERSONALITY = ['忠义', '大志', '贪财', '怕死', '卤莽']

/** 性格标签：君主表/武将表按 lordId===id 切换（沿用 19 的解读）。 */
export function personalityLabel(o: Officer): string {
  const table = o.lordId === o.id ? LORD_PERSONALITY : OFFICER_PERSONALITY
  return table[o.personality as Personality]!
}

export const COMMAND_LABEL: Record<CommandKind, string> = {
  reclaim: '开垦',
  commerce: '招商',
  patrol: '出巡',
  govern: '治理',
  banquet: '宴请',
  search: '搜寻',
  plunder: '掠夺',
  recruit: '征兵',
  allocate: '分配',
  trade: '交易',
  reward: '赏赐',
  confiscate: '没收',
  suborn: '招降',
  behead: '处斩',
  banish: '流放',
  entice: '招揽',
  alienate: '离间',
  instigate: '策反',
  induce: '劝降',
  scout: '侦察',
  move: '移动',
  transport: '输送',
  campaign: '出征',
}

export const COMMAND_GROUP_LABEL: Record<CommandGroup, string> = {
  develop: '内政',
  personnel: '人事',
  military: '军事',
  diplomacy: '外交',
}
