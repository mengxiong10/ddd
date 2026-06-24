import type { OfficerId } from '../store/selectors'

/** 空城（无归属）展示色——与宣纸底拉开、偏冷灰。 */
const EMPTY_CITY_COLOR = 'hsl(35 8% 62%)'

/**
 * 势力色板（纯 UI 派生，零规则）：一组手挑的、相互间距足够、在宣纸底上对比清晰的色相，
 * 按 lordId 稳定取模分配——取代旧「黄金角散布」（偶发撞色/低对比）。我方另由调用方据
 * isPlayerFaction 加金边高亮，不在颜色上区分（保证地图整体可读）。
 */
const FACTION_HUES = [8, 28, 48, 140, 175, 205, 250, 280, 320, 95, 18, 220] as const

/** 势力主题色（HSL 字符串）：空城灰；其余按 id 取板内稳定色相。 */
export function factionColor(lordId: OfficerId | null, _playerLordId: OfficerId): string {
  if (lordId === null) return EMPTY_CITY_COLOR
  const hue = FACTION_HUES[lordId % FACTION_HUES.length]!
  return `hsl(${hue} 52% 50%)`
}

/** 势力深色（描边/名牌底用）。 */
export function factionColorDark(lordId: OfficerId | null): string {
  if (lordId === null) return 'hsl(35 8% 42%)'
  const hue = FACTION_HUES[lordId % FACTION_HUES.length]!
  return `hsl(${hue} 48% 32%)`
}

/** 是否我方势力（调用方据此加高亮边框/底色）。 */
export function isPlayerFaction(lordId: OfficerId | null, playerLordId: OfficerId): boolean {
  return lordId !== null && lordId === playerLordId
}
