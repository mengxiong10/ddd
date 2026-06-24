import { useState } from 'react'
import { useCurrentGame, useGameStore } from '../../store/game-store'
import type { BattleAction, OfficerId, Position } from '../../store/selectors'
import {
  reachableTiles,
  attackableTiles,
  skillTargetTiles,
  effectiveTroopType,
  unitAt,
} from '../../store/selectors'
import { WEATHER_LABEL } from '../labels'
import { Button } from '../components/ui/button'
import { BattleMap } from './battle-map'
import { UnitActionMenu } from './unit-action-menu'
import { DetailDialog } from './detail-dialog'
import { BattleOverviewDialog } from './battle-overview-dialog'
import { BattleResultDialog } from './battle-result-dialog'
import {
  selectUnit,
  setMove,
  actToBattleAction,
  type ActDraft,
  type BattleInspect,
} from './act-draft'

type ActAction = Extract<BattleAction, { type: 'act' }>
const samePos = (a: Position, b: Position) => a.x === b.x && a.y === b.y

/**
 * 全屏战斗编排（`21-main-flow-ui`）：薄顶栏 + 最大化地图 + 浮动动作菜单 + 详情/概览/战果 dialog。
 * 本地 state：ActDraft（选将/落点/动作）、inspect（顶栏点击弹详情）、菜单锚点、概览开关。
 */
export function BattleScreen() {
  const game = useCurrentGame()
  const dispatch = useGameStore((s) => s.dispatch)
  const battle = game.activeBattle
  const [draft, setDraft] = useState<ActDraft>({ kind: 'idle' })
  const [inspect, setInspect] = useState<BattleInspect | null>(null)
  const [anchor, setAnchor] = useState({ x: 120, y: 120 })
  const [overviewOpen, setOverviewOpen] = useState(false)
  if (!battle) return null
  const map = game.battleMaps[battle.mapId]!

  const selectedOfficerId: OfficerId | null = draft.kind === 'idle' ? null : draft.officerId
  const selectedUnit = selectedOfficerId !== null ? battle.units[selectedOfficerId] : undefined
  const from: Position | null =
    draft.kind === 'idle' || !selectedUnit ? null : (draft.moveTo ?? selectedUnit.pos)

  const reach = draft.kind === 'unit' ? reachableTiles(game, battle, draft.officerId) : []
  const attack =
    draft.kind === 'attack' && from
      ? attackableTiles(map, from, effectiveTroopType(game, draft.officerId))
      : []
  const skill = draft.kind === 'cast' && from ? skillTargetTiles(map, from, draft.skillId) : []

  const battleAct = (action: ActAction) => {
    dispatch({ type: 'battle', action })
    setDraft({ kind: 'idle' })
  }

  const onPickTile = (p: Position, screen: { x: number; y: number }) => {
    setAnchor(screen)
    const u = unitAt(battle, p)
    const inspectAt = () =>
      u
        ? setInspect({ kind: 'unit', officerId: u.officerId })
        : setInspect({ kind: 'tile', pos: p })
    switch (draft.kind) {
      case 'idle':
        if (u && u.side === 'player' && !u.acted) setDraft(selectUnit(u.officerId))
        else inspectAt()
        break
      case 'unit':
        if (reach.some((r) => samePos(r, p))) setDraft(setMove(draft, p))
        else if (u && u.side === 'player' && !u.acted) setDraft(selectUnit(u.officerId))
        else inspectAt()
        break
      case 'attack':
        if (attack.some((a) => samePos(a, p))) {
          const action = actToBattleAction(draft, p)
          if (action) battleAct(action)
        } else inspectAt()
        break
      case 'cast':
        if (skill.some((s) => samePos(s, p))) {
          const action = actToBattleAction(draft, p)
          if (action) battleAct(action)
        } else inspectAt()
        break
      case 'cast-pick-skill':
        inspectAt()
        break
    }
  }

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex items-center gap-2 border-b bg-card px-3 py-1.5 text-sm">
        <span>
          第 {battle.day} 天 · {WEATHER_LABEL[battle.weather]} · 我粮 {battle.playerProvisions} 敌粮{' '}
          {battle.intelRevealDay === battle.day ? battle.opponentProvisions : '???'}
        </span>
        {selectedOfficerId !== null && (
          <button
            className="rounded bg-secondary px-2 py-0.5"
            onClick={() => setInspect({ kind: 'unit', officerId: selectedOfficerId })}
          >
            选中：{game.officers[selectedOfficerId]?.name} ▸详情
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setOverviewOpen(true)}>
            概览
          </Button>
          <Button
            size="sm"
            onClick={() => {
              dispatch({ type: 'battle', action: { type: 'endDay' } })
              setDraft({ kind: 'idle' })
            }}
          >
            结束当日
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => dispatch({ type: 'battle', action: { type: 'retreat' } })}
          >
            撤退
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <BattleMap
          game={game}
          battle={battle}
          selectedOfficerId={selectedOfficerId}
          reach={reach}
          attack={attack}
          skill={skill}
          onPickTile={onPickTile}
        />
      </div>

      {!battle.outcome && (
        <UnitActionMenu
          game={game}
          battle={battle}
          draft={draft}
          anchor={anchor}
          onChoose={setDraft}
          onAct={battleAct}
        />
      )}

      {inspect && <DetailDialog inspect={inspect} onClose={() => setInspect(null)} />}
      {overviewOpen && <BattleOverviewDialog onClose={() => setOverviewOpen(false)} />}
      {battle.outcome && <BattleResultDialog outcome={battle.outcome} />}
    </div>
  )
}
