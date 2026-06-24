import type { BattleAction, GameState } from '../../store/selectors'
import type { BattleState } from '../../store/selectors'
import { availableSkills, SKILL_DEFS, effectiveTroopType } from '../../store/selectors'
import {
  toAttack,
  toPickSkill,
  toCast,
  setMove,
  restAction,
  actToBattleAction,
  type ActDraft,
} from './act-draft'
import { Button } from '../components/ui/button'

type ActAction = Extract<BattleAction, { type: 'act' }>

/**
 * 浮动动作菜单（`21-main-flow-ui`）：锚定选中单位旁。kind==='unit' 显攻击/施法/休息/取消；
 * kind==='cast-pick-skill' 显可用技能子菜单（名/MP），self 技能直接施放、其余切到待点目标态。
 */
export function UnitActionMenu({
  game,
  battle,
  draft,
  anchor,
  onChoose,
  onAct,
}: {
  readonly game: GameState
  readonly battle: BattleState
  readonly draft: ActDraft
  readonly anchor: { x: number; y: number }
  readonly onChoose: (next: ActDraft) => void
  readonly onAct: (action: ActAction) => void
}) {
  if (draft.kind !== 'unit' && draft.kind !== 'cast-pick-skill') return null

  const vw = typeof window !== 'undefined' ? window.innerWidth : 9999
  const vh = typeof window !== 'undefined' ? window.innerHeight : 9999
  const MENU_W = 144
  const MENU_H = 220
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.max(8, Math.min(anchor.x + 8, vw - MENU_W - 8)),
    top: Math.max(8, Math.min(anchor.y + 8, vh - MENU_H - 8)),
    zIndex: 40,
  }

  return (
    <div
      style={style}
      className="flex w-36 flex-col gap-0.5 rounded-md border bg-card p-1 shadow-[var(--shadow-float)]"
    >
      {draft.kind === 'unit' && (
        <>
          <Button size="sm" variant="ghost" onClick={() => onChoose(toAttack(draft))}>
            攻击
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChoose(toPickSkill(draft))}>
            施法 ▸
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const a = restAction(draft)
              if (a) onAct(a)
            }}
          >
            休息
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChoose({ kind: 'idle' })}>
            取消
          </Button>
        </>
      )}

      {draft.kind === 'cast-pick-skill' && (
        <SkillList game={game} battle={battle} draft={draft} onChoose={onChoose} onAct={onAct} />
      )}
    </div>
  )
}

function SkillList({
  game,
  battle,
  draft,
  onChoose,
  onAct,
}: {
  readonly game: GameState
  readonly battle: BattleState
  readonly draft: Extract<ActDraft, { kind: 'cast-pick-skill' }>
  readonly onChoose: (next: ActDraft) => void
  readonly onAct: (action: ActAction) => void
}) {
  const unit = battle.units[draft.officerId]
  const officer = game.officers[draft.officerId]
  if (!unit || !officer) return null
  const isLord = officer.lordId === officer.id
  const skillIds = [
    ...availableSkills(
      effectiveTroopType(game, draft.officerId),
      unit.level,
      officer.personalSkills,
      isLord
    ),
  ]
  return (
    <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
      {skillIds.length === 0 && (
        <span className="px-2 text-xs text-muted-foreground">无可用计谋</span>
      )}
      {skillIds.map((id) => {
        const def = SKILL_DEFS[id]
        if (!def) return null
        const affordable = unit.mp >= def.mp
        return (
          <Button
            key={id}
            size="sm"
            variant="ghost"
            disabled={!affordable}
            className="justify-between"
            onClick={() => {
              if (def.target === 'self') {
                const a = actToBattleAction(toCast(draft, id))
                if (a) onAct(a)
              } else {
                onChoose(toCast(draft, id))
              }
            }}
          >
            <span>{def.name}</span>
            <span className="text-xs opacity-70">{def.mp}MP</span>
          </Button>
        )
      })}
      <Button size="sm" variant="ghost" onClick={() => onChoose(setMove(draft, draft.moveTo))}>
        ← 返回
      </Button>
    </div>
  )
}
