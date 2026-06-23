import type { OfficerId, ScenarioPreview } from '../../store/selectors'
import { factionColor } from '../faction-color'

const S = 10 // 网格单元像素（viewBox 用户单位）
const PAD = 8

/**
 * 选君主预览地图（`21-main-flow-ui`）：极简只读 SVG——城池 <rect> 正方形 + 邻接 <line>，
 * 唯一目的=看清势力范围。与经营大地图不共用、刻意简单。选中君主辖城脉冲高亮。
 */
export function ScenarioPreviewMap({
  preview,
  selectedLordId,
}: {
  readonly preview: ScenarioPreview
  readonly selectedLordId: OfficerId | null
}) {
  const cx = (x: number) => x * S + S / 2
  const cy = (y: number) => y * S + S / 2
  const byId = new Map(preview.cities.map((c) => [c.id, c]))
  const width = 12 * S
  const height = 9 * S
  const base = selectedLordId ?? -1

  return (
    <svg
      viewBox={`${-PAD} ${-PAD} ${width + 2 * PAD} ${height + 2 * PAD}`}
      className="h-full w-full"
      role="img"
      aria-label="势力分布预览"
    >
      <g stroke="hsl(220 13% 70%)" strokeWidth={0.4}>
        {preview.adjacency.map(([a, b]) => {
          const ca = byId.get(a)
          const cb = byId.get(b)
          if (!ca || !cb || a >= b) return null
          return <line key={`${a}-${b}`} x1={cx(ca.x)} y1={cy(ca.y)} x2={cx(cb.x)} y2={cy(cb.y)} />
        })}
      </g>
      {preview.cities.map((c) => {
        const selected = c.lordId !== null && c.lordId === selectedLordId
        const size = 6
        const x = cx(c.x) - size / 2
        const y = cy(c.y) - size / 2
        return (
          <g key={c.id}>
            {selected && (
              <rect
                x={x - 1.5}
                y={y - 1.5}
                width={size + 3}
                height={size + 3}
                fill="none"
                stroke="hsl(43 96% 50%)"
                strokeWidth={1}
                className="animate-pulse"
                rx={1}
              />
            )}
            <rect
              x={x}
              y={y}
              width={size}
              height={size}
              rx={1}
              fill={factionColor(c.lordId, base)}
              stroke="hsl(222 47% 11% / 0.4)"
              strokeWidth={0.3}
            />
            <text
              x={cx(c.x)}
              y={cy(c.y) + size}
              fontSize={2.6}
              textAnchor="middle"
              fill="hsl(222 47% 20%)"
            >
              {c.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
