import { useLayoutEffect, useRef, useState } from 'react'
import type { GameState, OfficerId, Position } from '../../store/selectors'
import { GRID_SIZE, terrainAt, aliveUnits } from '../../store/selectors'
import type { BattleState } from '../../store/selectors'
import { troopCapacity } from '../../store/selectors'
import { TERRAIN_FILL, TERRAIN_STROKE, HIGHLIGHT, UNIT_COLOR } from './terrain-color'

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

const MIN_CELL_PX = 40 // 最小格边长：保证可点击
const MAX_SCALE = 8

/** 容器短边推导的最小缩放：每格至少 MIN_CELL_PX（短边 ≥ GRID_SIZE*MIN_CELL_PX 时为 1）。 */
const minScaleFor = (minDim: number) =>
  minDim > 0 ? Math.max(1, (MIN_CELL_PX * GRID_SIZE) / minDim) : 1

/**
 * 战斗地图（`21-main-flow-ui`）：32×32 地形格 + 单位色块 + 高亮分层（可达蓝/可击红/技能紫，选中金）。
 * 自持视口（拖动平移 + 滚轮缩放）；点格语义由 BattleScreen 据 draft 阶段解释。
 */
export function BattleMap({
  game,
  battle,
  selectedOfficerId,
  moveTo,
  reach,
  attack,
  skill,
  onPickTile,
}: {
  readonly game: GameState
  readonly battle: BattleState
  readonly selectedOfficerId: OfficerId | null
  readonly moveTo: Position | null
  readonly reach: readonly Position[]
  readonly attack: readonly Position[]
  readonly skill: readonly Position[]
  readonly onPickTile: (p: Position, screen: { x: number; y: number }) => void
}) {
  const map = game.battleMaps[battle.mapId]!
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const [minScale, setMinScale] = useState(1)
  const inited = useRef(false)
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)

  // 测量容器短边 → 推导最小缩放（每格 ≥ 40px）；首次居中到该缩放，随尺寸变化夹紧。
  useLayoutEffect(() => {
    const el = svgRef.current
    if (!el) return
    const apply = () => {
      const rect = el.getBoundingClientRect()
      const ms = minScaleFor(Math.min(rect.width, rect.height))
      setMinScale(ms)
      if (!inited.current) {
        inited.current = true
        setView({ scale: ms, tx: (GRID_SIZE * (1 - ms)) / 2, ty: (GRID_SIZE * (1 - ms)) / 2 })
      } else {
        setView((v) => (v.scale < ms ? { ...v, scale: ms } : v))
      }
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
    setView((v) => ({
      ...v,
      scale: clamp(v.scale * (e.deltaY < 0 ? 1.1 : 0.9), minScale, MAX_SCALE),
    }))
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
              stroke={TERRAIN_STROKE}
              strokeWidth={0.03}
            />
          )
        })}
        {overlay(reach, HIGHLIGHT.reach, 'r')}
        {overlay(attack, HIGHLIGHT.attack, 'a')}
        {overlay(skill, HIGHLIGHT.skill, 's')}
        {aliveUnits(battle).map((u) => {
          const mine = u.side === 'player'
          const selected = u.officerId === selectedOfficerId
          const officer = game.officers[u.officerId]
          const cap = officer ? troopCapacity(officer) : 0
          const ratio = cap > 0 ? Math.max(0, Math.min(1, u.troops / cap)) : 0
          // 已选落点时把选中单位画到落点处（移动预览），原位留虚影 + 连线指示去向。
          const rp = selected && moveTo ? moveTo : u.pos
          const moved = selected && moveTo && (moveTo.x !== u.pos.x || moveTo.y !== u.pos.y)
          return (
            <g key={u.officerId} className="pointer-events-none">
              {moved && (
                <>
                  <line
                    x1={u.pos.x + 0.5}
                    y1={u.pos.y + 0.5}
                    x2={rp.x + 0.5}
                    y2={rp.y + 0.5}
                    stroke={HIGHLIGHT.selected}
                    strokeWidth={0.08}
                    strokeDasharray="0.18 0.12"
                  />
                  <circle
                    cx={u.pos.x + 0.5}
                    cy={u.pos.y + 0.5}
                    r={0.42}
                    fill="none"
                    stroke={UNIT_COLOR.stroke}
                    strokeWidth={0.06}
                    strokeDasharray="0.14 0.1"
                    opacity={0.6}
                  />
                </>
              )}
              <circle
                cx={rp.x + 0.5}
                cy={rp.y + 0.5}
                r={0.42}
                fill={mine ? UNIT_COLOR.player : UNIT_COLOR.opponent}
                stroke={selected ? HIGHLIGHT.selected : UNIT_COLOR.stroke}
                strokeWidth={selected ? 0.18 : 0.08}
                opacity={u.acted ? 0.5 : 1}
              />
              <text
                x={rp.x + 0.5}
                y={rp.y + 0.46}
                fontSize={0.32}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
              >
                {officer?.name?.[0] ?? ''}
              </text>
              {/* 兵力条：单位下沿一道细条，按 troops/带兵量 派生宽度。 */}
              <rect
                x={rp.x + 0.12}
                y={rp.y + 0.82}
                width={0.76}
                height={0.1}
                rx={0.05}
                fill="hsl(28 28% 16% / 0.35)"
              />
              <rect
                x={rp.x + 0.12}
                y={rp.y + 0.82}
                width={0.76 * ratio}
                height={0.1}
                rx={0.05}
                fill={mine ? 'hsl(140 50% 55%)' : 'hsl(38 80% 55%)'}
              />
            </g>
          )
        })}
      </g>
    </svg>
  )
}
