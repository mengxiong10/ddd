import type { OfficerId } from '../store/selectors'

/** 空城（无归属）展示色。 */
const EMPTY_CITY_COLOR = 'hsl(0 0% 72%)'

/**
 * 势力色（纯 UI 派生，零规则）：空城灰；其余按 lordId 用黄金角散布稳定 HSL，
 * 我方略提饱和/亮度以更醒目（金边等高亮语义另由调用方据 isPlayerFaction 加 ring）。
 */
export function factionColor(lordId: OfficerId | null, playerLordId: OfficerId): string {
  if (lordId === null) return EMPTY_CITY_COLOR
  const hue = (lordId * 137) % 360
  const isPlayer = lordId === playerLordId
  return `hsl(${hue} ${isPlayer ? 85 : 60}% ${isPlayer ? 48 : 56}%)`
}

/** 是否我方势力（调用方据此加高亮边框/底色）。 */
export function isPlayerFaction(lordId: OfficerId | null, playerLordId: OfficerId): boolean {
  return lordId !== null && lordId === playerLordId
}
