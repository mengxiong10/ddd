import type { Terrain } from '../../store/selectors'

/**
 * 战斗地图调色板（单一真相源，`21-main-flow-ui` 打磨）：地形语义色 + 高亮层 + 双方单位色，
 * 全部偏暖/降饱和以贴合国风宣纸底。占位语义不变（草地浅绿/平原淡黄/山地棕褐/…）。
 */
export const TERRAIN_FILL: Record<Terrain, string> = {
  grass: 'hsl(95 30% 64%)',
  plain: 'hsl(70 34% 74%)',
  mountain: 'hsl(28 28% 54%)',
  forest: 'hsl(140 30% 40%)',
  village: 'hsl(40 50% 70%)',
  city: 'hsl(40 72% 58%)',
  camp: 'hsl(18 44% 54%)',
  river: 'hsl(202 48% 64%)',
}

/** 地形格描边（极淡墨线）。 */
export const TERRAIN_STROKE = 'hsl(28 28% 16% / 0.08)'

/** 高亮层（可达/可击/技能/选中）。 */
export const HIGHLIGHT = {
  reach: 'hsl(205 70% 50% / 0.38)',
  attack: 'hsl(8 70% 50% / 0.4)',
  skill: 'hsl(280 56% 56% / 0.4)',
  selected: 'hsl(38 80% 50%)',
} as const

/** 双方单位色（我方竹青蓝/敌方朱砂红）。 */
export const UNIT_COLOR = {
  player: 'hsl(205 64% 44%)',
  opponent: 'hsl(8 64% 48%)',
  stroke: 'hsl(40 33% 97%)',
} as const
