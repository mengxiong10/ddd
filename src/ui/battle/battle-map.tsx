import { useRef, useState } from 'react'
import type { GameState, OfficerId, Position, Terrain } from '../../store/selectors'
import { GRID_SIZE, terrainAt, aliveUnits } from '../../store/selectors'
import type { BattleState } from '../../store/selectors'

const TERRAIN_FILL: Record<Terrain, string> = {
  grass: 'hsl(95 38% 66%)',
  plain: 'hsl(80 32% 76%)',
  mountain: 'hsl(28 26% 56%)',
  forest: 'hsl(140 34% 42%)',
  village: 'hsl(40 52% 72%)',
  city: 'hsl(45 85% 58%)',
  camp: 'hsl(18 42% 56%)',
  river: 'hsl(205 60% 66%)',
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/**
 * 战斗地图（`21-main-flow-ui`）：32×32 地形格 + 单位色块 + 高亮分层（可达蓝/可击红/技能紫，选中金）。
 * 自持视口（拖动平移 + 滚轮缩放）；点格语义由 BattleScreen 据 draft 阶段解释。
 */
export function BattleMap({
  game,
  battle,
  selectedOfficerId,
  reach,
  attack,
  skill,
  onPickTile,
}: {
  readonly game: GameState
  readonly battle: BattleState
  readonly selectedOfficerId: OfficerId | null
  readonly reach: readonly Position[]
  readonly attack: readonly Position[]
  readonly skill: readonly Position[]
  readonly onPickTile: (p: Position, screen: { x: number; y: number }) => void
}) {
  const map = game.battleMaps[battle.mapId]!
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)

  const clientToCell = (clientX: number, clientY: number): Position | null => {
    const ctm = gRef.current?.getScreenCTM()
    if (!ctm) return null
    const local = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    const x = Math.floor(local.x)
    const y = Math.floor(local.y)
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return null
    return { x, y }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true
    const rect = svgRef.current!.getBoundingClientRect()
    setView((v) => ({
      ...v,
      tx: d.tx + (dx * GRID_SIZE) / rect.width,
      ty: d.ty + (dy * GRID_SIZE) / rect.height,
    }))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const cell = clientToCell(e.clientX, e.clientY)
    if (cell) onPickTile(cell, { x: e.clientX, y: e.clientY })
  }
  const onWheel = (e: React.WheelEvent) => {
    setView((v) => ({ ...v, scale: clamp(v.scale * (e.deltaY < 0 ? 1.1 : 0.9), 0.5, 4) }))
  }

  const overlay = (cells: readonly Position[], fill: string, key: string) =>
    cells.map((p) => (
      <rect key={`${key}-${p.x}-${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={fill} />
    ))

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full touch-none select-none bg-black/10"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      <g ref={gRef} transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
        {map.tiles.map((_, i) => {
          const x = i % map.width
          const y = Math.floor(i / map.width)
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={TERRAIN_FILL[terrainAt(map, { x, y })]}
              stroke="hsl(0 0% 0% / 0.06)"
              strokeWidth={0.03}
            />
          )
        })}
        {overlay(reach, 'hsl(210 90% 55% / 0.4)', 'r')}
        {overlay(attack, 'hsl(0 80% 55% / 0.4)', 'a')}
        {overlay(skill, 'hsl(280 70% 60% / 0.4)', 's')}
        {aliveUnits(battle).map((u) => {
          const mine = u.side === 'player'
          const selected = u.officerId === selectedOfficerId
          return (
            <g key={u.officerId} className="pointer-events-none">
              <circle
                cx={u.pos.x + 0.5}
                cy={u.pos.y + 0.5}
                r={0.42}
                fill={mine ? 'hsl(210 90% 50%)' : 'hsl(0 75% 50%)'}
                stroke={selected ? 'hsl(43 96% 50%)' : 'hsl(0 0% 100%)'}
                strokeWidth={selected ? 0.18 : 0.08}
                opacity={u.acted ? 0.55 : 1}
              />
              <text
                x={u.pos.x + 0.5}
                y={u.pos.y + 0.5}
                fontSize={0.3}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
              >
                {game.officers[u.officerId]?.name?.[0] ?? ''}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}
