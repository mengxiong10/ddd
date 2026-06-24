import type { CommandCheck, GameState, Officer, OfficerId } from '../../store/selectors'
import {
  effectiveOfficer,
  effectiveTroopType,
  officerLoyalty,
  itemsOfOfficer,
} from '../../store/selectors'
import { isPlayerFaction } from '../faction-color'
import { TROOP_LABEL } from '../labels'
import { reasonText } from '../feedback/messages'
import { Checkbox } from '../components/ui/checkbox'
import { cn } from '@/lib/utils'

/**
 * 共享武将表（命令收集向导内所有武将列表复用）：可横向滚动的真表格，列含
 * 武将 / 归属 / 城市 / 武 / 智 / 体力 / 兵种 / 忠诚 / 物品1 / 物品2 / 兵（武/智取道具加成后的有效值）。
 * 单选模式（执行武将/俘虏/敌方目标将）：整行可点，非法行经 check 置灰 + reason 提示；
 * 多选模式（出征名单）：首列复选框、整行可点切换。仅渲染，推进逻辑留给调用方。
 */
type Common = {
  readonly game: GameState
  readonly officers: readonly Officer[]
  readonly emptyText?: string
}

type SingleProps = Common & {
  readonly mode: 'single'
  readonly onSelect: (id: OfficerId) => void
  readonly checkFor?: (id: OfficerId) => CommandCheck
}

type MultiProps = Common & {
  readonly mode: 'multi'
  readonly selectedIds: readonly OfficerId[]
  readonly onToggle: (id: OfficerId) => void
}

export type OfficerTableProps = SingleProps | MultiProps

function ownerLabel(game: GameState, o: Officer): string {
  if (o.lordId === null) return '在野'
  if (isPlayerFaction(o.lordId, game.playerLordId)) return '我方'
  return game.officers[o.lordId]?.name ?? '—'
}

const COLS = [
  '武将',
  '归属',
  '城市',
  '武',
  '智',
  '体力',
  '兵种',
  '忠诚',
  '物品1',
  '物品2',
  '兵',
] as const

/** 一名武将的各列值（与选择模式无关）。 */
function rowCells(game: GameState, o: Officer): readonly (string | number)[] {
  const eff = effectiveOfficer(game, o.id)
  const items = itemsOfOfficer(game, o.id)
  return [
    o.name,
    ownerLabel(game, o),
    o.cityId !== null ? (game.cities[o.cityId]?.name ?? '—') : '—',
    eff.force,
    eff.intelligence,
    o.stamina,
    TROOP_LABEL[effectiveTroopType(game, o.id)],
    officerLoyalty(game, o.id),
    items[0]?.name ?? '—',
    items[1]?.name ?? '—',
    o.troops,
  ]
}

export function OfficerTable(props: OfficerTableProps) {
  const { game, officers, emptyText } = props
  if (officers.length === 0)
    return <p className="text-sm text-muted-foreground">{emptyText ?? '无可选武将。'}</p>

  const multi = props.mode === 'multi'
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="min-w-[42rem] border-collapse text-left text-[11px] tabular-nums">
        <thead>
          <tr className="border-b bg-secondary/60 text-muted-foreground">
            {COLS.map((c, i) => (
              <th
                key={c}
                className={cn(
                  'whitespace-nowrap px-2 py-1.5 font-medium',
                  i === 0 && 'sticky left-0 z-20 bg-secondary'
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {officers.map((o) => {
            const [name, ...rest] = rowCells(game, o)
            const checked = props.mode === 'multi' && props.selectedIds.includes(o.id)
            const check =
              props.mode === 'single' ? (props.checkFor?.(o.id) ?? { ok: true as const }) : null
            const disabled = check !== null && !check.ok
            return (
              <tr
                key={o.id}
                onClick={() => {
                  if (props.mode === 'multi') props.onToggle(o.id)
                  else if (!disabled) props.onSelect(o.id)
                }}
                title={check && !check.ok && check.reason ? reasonText(check.reason) : ''}
                className={cn(
                  'border-b last:border-0',
                  disabled
                    ? 'cursor-not-allowed opacity-50'
                    : cn('cursor-pointer', checked ? 'bg-vermilion/10' : 'hover:bg-secondary/40')
                )}
              >
                <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-2 py-1.5">
                  <span className="flex items-center gap-1.5">
                    {multi && (
                      <Checkbox checked={checked} className="pointer-events-none" tabIndex={-1} />
                    )}
                    <span className="font-medium text-foreground">{name}</span>
                  </span>
                </td>
                {rest.map((v, i) => (
                  <td key={i} className="whitespace-nowrap px-2 py-1.5">
                    {v}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
