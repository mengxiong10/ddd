import type { CityId, OfficerId, Terrain } from '../../store/selectors'

/**
 * 素材注册表（`21-main-flow-ui` 打磨）：UI 取「真实美术」的**唯一入口**，与色块占位解耦。
 *
 * 现状：三张表为空 → 所有 getter 返回 null → 组件一律回退到现有语义色块/首字头像。
 * 接入美术时：把生成并后处理过的图放进 `public/art/<category>/<id>.webp`，在对应表登记
 *   `[id]: '/art/officers/139.webp'`，组件零改动即自动改用图片。分批补图、平滑过渡、不阻塞。
 *
 * 一致性：所有图片须遵循 `docs/art-bible.md` 的风格前缀与调色板（与 src/index.css 令牌同源）。
 */

const OFFICER_PORTRAITS: Partial<Record<OfficerId, string>> = {}
const CITY_ICONS: Partial<Record<CityId, string>> = {}
const TERRAIN_TILES: Partial<Record<Terrain, string>> = {}

/** 武将立绘/头像；缺图返回 null（调用方回退首字头像）。 */
export function officerPortrait(id: OfficerId): string | null {
  return OFFICER_PORTRAITS[id] ?? null
}

/** 城邑图标；缺图返回 null（调用方回退势力色点）。 */
export function cityIcon(id: CityId): string | null {
  return CITY_ICONS[id] ?? null
}

/** 地形贴图；缺图返回 null（调用方回退 terrain-color 语义色）。 */
export function terrainTile(terrain: Terrain): string | null {
  return TERRAIN_TILES[terrain] ?? null
}
