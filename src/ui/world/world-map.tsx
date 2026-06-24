import type { CityId, GameState } from '../../store/selectors'
import { factionColor, factionColorDark, isPlayerFaction } from '../faction-color'
import { cn } from '@/lib/utils'

const COLS = 12
const ROWS = 9

/**
 * 经营大地图（`21-main-flow-ui` 打磨）：SVG 只画邻接连线（弱化为底层、选中城的邻接高亮），
 * 城池节点改为绝对定位的 HTML 芯片（势力色点 + 城名），文字按真实字号渲染、小屏清晰可点。
 * 我方城金边、空城灰、选中城朱砂环；highlightCityIds（待选目标城）金色脉冲。
 * 容器保持 12:9 比例居中铺满，避免连线被拉伸变形。
 */
export function WorldMap({
  game,
  selectedCityId,
  highlightCityIds,
  onSelectCity,
}: {
  readonly game: GameState
  readonly selectedCityId: CityId | null
  readonly highlightCityIds?: readonly CityId[]
  readonly onSelectCity: (id: CityId) => void
}) {
  const cities = Object.values(game.cities)
  const highlight = new Set(highlightCityIds ?? [])
  const selectedNeighbors = new Set(
    selectedCityId !== null ? (game.adjacency[selectedCityId] ?? []) : []
  )
  const left = (x: number) => `${((x + 0.5) / COLS) * 100}%`
  const top = (y: number) => `${((y + 0.5) / ROWS) * 100}%`

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="relative aspect-[12/9] h-full max-w-full">
        <svg
          viewBox={`0 0 ${COLS} ${ROWS}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
          {Object.entries(game.adjacency).flatMap(([a, neighbors]) =>
            neighbors.map((b) => {
              const ai = Number(a)
              if (ai >= b) return null
              const ca = game.cities[ai]
              const cb = game.cities[b]
              if (!ca || !cb) return null
              const active =
                selectedCityId !== null &&
                (ai === selectedCityId ||
                  b === selectedCityId ||
                  (selectedNeighbors.has(ai) && selectedNeighbors.has(b)))
              const onSel = ai === selectedCityId || b === selectedCityId
              return (
                <line
                  key={`${ai}-${b}`}
                  x1={ca.x + 0.5}
                  y1={ca.y + 0.5}
                  x2={cb.x + 0.5}
                  y2={cb.y + 0.5}
                  stroke={onSel ? 'hsl(38 68% 46%)' : 'hsl(30 16% 56%)'}
                  strokeOpacity={active ? 0.9 : 0.28}
                  strokeWidth={onSel ? 0.07 : 0.04}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })
          )}
        </svg>

        {cities.map((c) => {
          const selected = c.id === selectedCityId
          const mine = isPlayerFaction(c.lordId, game.playerLordId)
          const pulse = highlight.has(c.id)
          return (
            <button
              key={c.id}
              onClick={() => onSelectCity(c.id)}
              aria-label={c.name}
              className={cn(
                'absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-md border bg-card/95 px-1.5 py-0.5 text-[11px] font-medium leading-none shadow-[var(--shadow-card)] transition-transform active:scale-95',
                selected && 'z-20 ring-2 ring-vermilion',
                mine && !selected && 'border-gold',
                pulse && 'z-20 animate-pulse ring-2 ring-gold'
              )}
              style={{ left: left(c.x), top: top(c.y) }}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: factionColor(c.lordId, game.playerLordId),
                  boxShadow: `0 0 0 1px ${factionColorDark(c.lordId)}`,
                }}
                aria-hidden
              />
              <span className="whitespace-nowrap">{c.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
