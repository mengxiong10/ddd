import type { CityId, GameState } from '../../store/selectors'
import { factionColor, isPlayerFaction } from '../faction-color'

const S = 10
const PAD = 8

/**
 * 经营大地图（`21-main-flow-ui`）：从 live 局面渲染邻接连线 + 城池节点（势力色、我方高亮、空城灰、
 * 选中描边、highlightCityIds 脉冲）+ 选城事件。本切片占位渲染、接口按完整地图设计（后期美化）。
 * 与选君主预览 ScenarioPreviewMap 解耦、各自演进。
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
  const cx = (x: number) => x * S + S / 2
  const cy = (y: number) => y * S + S / 2
  const width = 12 * S
  const height = 9 * S
  const highlight = new Set(highlightCityIds ?? [])

  return (
    <svg
      viewBox={`${-PAD} ${-PAD} ${width + 2 * PAD} ${height + 2 * PAD}`}
      className="h-full w-full touch-none select-none"
      role="img"
      aria-label="经营大地图"
    >
      <g stroke="hsl(220 13% 65%)" strokeWidth={0.4}>
        {Object.entries(game.adjacency).flatMap(([a, neighbors]) =>
          neighbors.map((b) => {
            const ai = Number(a)
            if (ai >= b) return null
            const ca = game.cities[ai]
            const cb = game.cities[b]
            if (!ca || !cb) return null
            return (
              <line key={`${ai}-${b}`} x1={cx(ca.x)} y1={cy(ca.y)} x2={cx(cb.x)} y2={cy(cb.y)} />
            )
          })
        )}
      </g>
      {cities.map((c) => {
        const selected = c.id === selectedCityId
        const mine = isPlayerFaction(c.lordId, game.playerLordId)
        const size = 7
        const x = cx(c.x) - size / 2
        const y = cy(c.y) - size / 2
        return (
          <g
            key={c.id}
            className="cursor-pointer"
            onClick={() => onSelectCity(c.id)}
            role="button"
            aria-label={c.name}
          >
            {highlight.has(c.id) && (
              <rect
                x={x - 2}
                y={y - 2}
                width={size + 4}
                height={size + 4}
                rx={1.5}
                fill="none"
                stroke="hsl(43 96% 50%)"
                strokeWidth={1.2}
                className="animate-pulse"
              />
            )}
            <rect
              x={x}
              y={y}
              width={size}
              height={size}
              rx={1.5}
              fill={factionColor(c.lordId, game.playerLordId)}
              stroke={
                selected ? 'hsl(43 96% 45%)' : mine ? 'hsl(222 47% 11%)' : 'hsl(222 47% 11% / 0.4)'
              }
              strokeWidth={selected ? 1.4 : mine ? 0.8 : 0.3}
            />
            <text
              x={cx(c.x)}
              y={cy(c.y) + size + 0.5}
              fontSize={2.8}
              textAnchor="middle"
              fill="hsl(222 47% 18%)"
              className="pointer-events-none"
            >
              {c.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
