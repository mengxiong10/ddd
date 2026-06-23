import { useState } from 'react'
import { useCurrentGame, useGameStore } from '../../store/game-store'
import type { Action, CityId, GameState, OfficerId } from '../../store/selectors'
import {
  officersInCity,
  captivesInCity,
  itemsInCity,
  itemsOfOfficer,
  governorOf,
} from '../../store/selectors'
import {
  startCommand,
  advanceDraft,
  draftToAction,
  COMMAND_GROUPS,
  type CommandDraft,
  type CommandKind,
} from './command-draft'
import { COMMAND_LABEL, COMMAND_GROUP_LABEL, STATUS_LABEL } from '../labels'
import { isPlayerFaction } from '../faction-color'
import { reasonText } from '../feedback/messages'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Checkbox } from '../components/ui/checkbox'

/**
 * 选中城操作面板（`21-main-flow-ui`）：我方城=信息 + 命令优先逐步收集；敌/空城=只读信息。
 * 合法性一律走 canDispatch（按钮置灰 + reason 提示）；离散终结选择「选完即派发 + 命令粘住复用」。
 */
export function CityPanel({
  cityId,
  draft,
  onDraft,
}: {
  readonly cityId: CityId
  readonly draft: CommandDraft
  readonly onDraft: (d: CommandDraft) => void
}) {
  const game = useCurrentGame()
  const city = game.cities[cityId]
  if (!city) return null
  const mine = isPlayerFaction(city.lordId, game.playerLordId)
  const gov = governorOf(game, cityId)

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{city.name}</h2>
          <Badge variant={mine ? 'default' : city.lordId === null ? 'secondary' : 'destructive'}>
            {mine ? '我方' : city.lordId === null ? '空城' : '敌方'}
          </Badge>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>状态：{STATUS_LABEL[city.status]}</span>
          <span>太守：{gov ? gov.name : '无'}</span>
          <span>
            农业 {city.agriculture}/{city.agricultureCap}
          </span>
          <span>
            商业 {city.commerce}/{city.commerceCap}
          </span>
          <span>民忠 {city.loyalty}</span>
          <span>防灾 {city.disasterPrevention}</span>
          <span>金钱 {city.gold}</span>
          <span>粮食 {city.food}</span>
          <span>人口 {city.population}</span>
          <span>后备兵 {city.reserveTroops}</span>
        </div>
      </div>

      {mine ? (
        draft.kind === 'collect' ? (
          <CollectPanel cityId={cityId} draft={draft} onDraft={onDraft} />
        ) : (
          <CommandPalette onPick={(k) => onDraft(startCommand(k))} />
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          敌方/空城只读信息。可在某条「侦察/移动/输送/出征」收集目标城时作为目标候选。
        </p>
      )}
    </div>
  )
}

/** 命令面板：按分组列出指令；点一条进入收集态。 */
function CommandPalette({ onPick }: { readonly onPick: (k: CommandKind) => void }) {
  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      {(Object.keys(COMMAND_GROUPS) as (keyof typeof COMMAND_GROUPS)[]).map((group) => (
        <div key={group}>
          <div className="mb-1 text-xs font-semibold text-muted-foreground">
            {COMMAND_GROUP_LABEL[group]}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COMMAND_GROUPS[group].map((k) => (
              <Button key={k} size="sm" variant="secondary" onClick={() => onPick(k)}>
                {COMMAND_LABEL[k]}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** 收集态：按 awaiting 渲染对应选择/输入；终结离散选择即派发 + 命令粘住复用。 */
function CollectPanel({
  cityId,
  draft,
  onDraft,
}: {
  readonly cityId: CityId
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly onDraft: (d: CommandDraft) => void
}) {
  const game = useCurrentGame()
  const dispatch = useGameStore((s) => s.dispatch)

  /** 派发 + 粘住复用同一命令。 */
  const fire = (action: Action) => {
    dispatch(action)
    onDraft(startCommand(draft.command))
  }

  const cancel = () => onDraft({ kind: 'pick-command' })

  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{COMMAND_LABEL[draft.command]}</span>
        <Button size="sm" variant="ghost" onClick={cancel}>
          返回
        </Button>
      </div>

      {draft.awaiting === 'executor' && (
        <ExecutorList game={game} cityId={cityId} draft={draft} onDraft={onDraft} fire={fire} />
      )}
      {draft.awaiting === 'item' && (
        <ItemList game={game} cityId={cityId} draft={draft} fire={fire} />
      )}
      {draft.awaiting === 'captive' && (
        <CaptiveList game={game} cityId={cityId} draft={draft} fire={fire} />
      )}
      {draft.awaiting === 'target-officer' && (
        <TargetOfficerList game={game} draft={draft} fire={fire} />
      )}
      {draft.awaiting === 'campaign-members' && (
        <CampaignMembers game={game} cityId={cityId} draft={draft} onDraft={onDraft} />
      )}
      {draft.awaiting === 'target-city' && (
        <p className="text-sm text-muted-foreground">请在地图上点选目标城（高亮闪烁处）。</p>
      )}
      {draft.awaiting === 'amount' &&
        (draft.command === 'transport' ? (
          <TransportInputs draft={draft} fire={fire} />
        ) : (
          <AmountInput draft={draft} fire={fire} />
        ))}
      {draft.awaiting === 'trade-args' && <TradeInputs draft={draft} fire={fire} />}
      {draft.awaiting === 'provisions' && <ProvisionsInput draft={draft} fire={fire} />}
    </div>
  )
}

/** 可用武将列表（onlyAvailable，已天然排除占用/俘虏/非己方）。 */
function ExecutorList({
  game,
  cityId,
  draft,
  onDraft,
  fire,
}: {
  readonly game: GameState
  readonly cityId: CityId
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly onDraft: (d: CommandDraft) => void
  readonly fire: (a: Action) => void
}) {
  const canDispatch = useGameStore((s) => s.canDispatch)
  const officers = officersInCity(game, cityId, { onlyAvailable: true })
  if (officers.length === 0)
    return <p className="text-sm text-muted-foreground">城中无可用武将。</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {officers.map((o) => {
        const probe = draftToAction(advanceDraft(draft, { slot: 'executor', officerId: o.id }))
        const check = probe ? canDispatch(probe) : { ok: true as const }
        return (
          <Button
            key={o.id}
            size="sm"
            variant="outline"
            disabled={!check.ok}
            title={!check.ok && check.reason ? reasonText(check.reason) : ''}
            onClick={() => {
              const d = advanceDraft(draft, { slot: 'executor', officerId: o.id })
              const action = draftToAction(d)
              if (action) fire(action)
              else onDraft(d)
            }}
          >
            {o.name}
            <span className="ml-1 text-xs opacity-70">兵{o.troops}</span>
          </Button>
        )
      })}
    </div>
  )
}

/** 道具选择：赏赐=城中已发现道具；没收=执行人持有道具。 */
function ItemList({
  game,
  cityId,
  draft,
  fire,
}: {
  readonly game: GameState
  readonly cityId: CityId
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly fire: (a: Action) => void
}) {
  const canDispatch = useGameStore((s) => s.canDispatch)
  const items =
    draft.command === 'confiscate' && draft.officerId !== undefined
      ? itemsOfOfficer(game, draft.officerId)
      : itemsInCity(game, cityId).filter((i) => i.discovered)
  if (items.length === 0) return <p className="text-sm text-muted-foreground">无可选道具。</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => {
        const action = draftToAction(advanceDraft(draft, { slot: 'item', itemId: i.id }))
        const check = action ? canDispatch(action) : { ok: false as const }
        return (
          <Button
            key={i.id}
            size="sm"
            variant="outline"
            disabled={!check.ok}
            title={!check.ok && check.reason ? reasonText(check.reason) : ''}
            onClick={() => action && fire(action)}
          >
            {i.name}
          </Button>
        )
      })}
    </div>
  )
}

/** 俘虏选择（招降/处斩）。 */
function CaptiveList({
  game,
  cityId,
  draft,
  fire,
}: {
  readonly game: GameState
  readonly cityId: CityId
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly fire: (a: Action) => void
}) {
  const captives = captivesInCity(game, cityId)
  if (captives.length === 0) return <p className="text-sm text-muted-foreground">城中无俘虏。</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {captives.map((c) => {
        const action = draftToAction(advanceDraft(draft, { slot: 'captive', captiveId: c.id }))
        return (
          <Button key={c.id} size="sm" variant="outline" onClick={() => action && fire(action)}>
            {c.name}
          </Button>
        )
      })}
    </div>
  )
}

/** 敌方目标武将选择（招揽/离间/策反/劝降）。合法性走 canDispatch 兜底。 */
function TargetOfficerList({
  game,
  draft,
  fire,
}: {
  readonly game: GameState
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly fire: (a: Action) => void
}) {
  const canDispatch = useGameStore((s) => s.canDispatch)
  const enemies = Object.values(game.officers).filter(
    (o) => o.lordId !== null && o.lordId !== game.playerLordId && o.cityId !== null
  )
  if (enemies.length === 0) return <p className="text-sm text-muted-foreground">无敌方武将。</p>
  return (
    <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
      {enemies.map((o) => {
        const action = draftToAction(
          advanceDraft(draft, { slot: 'target-officer', targetOfficerId: o.id })
        )
        const check = action ? canDispatch(action) : { ok: false as const }
        return (
          <Button
            key={o.id}
            size="sm"
            variant="outline"
            disabled={!check.ok}
            title={!check.ok && check.reason ? reasonText(check.reason) : ''}
            onClick={() => action && fire(action)}
          >
            {o.name}
            <span className="ml-1 text-xs opacity-70">
              {o.cityId !== null ? game.cities[o.cityId]?.name : ''}
            </span>
          </Button>
        )
      })}
    </div>
  )
}

/** 出征名单多选（同城可用武将）。 */
function CampaignMembers({
  game,
  cityId,
  draft,
  onDraft,
}: {
  readonly game: GameState
  readonly cityId: CityId
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly onDraft: (d: CommandDraft) => void
}) {
  const [picked, setPicked] = useState<readonly OfficerId[]>(draft.officerIds ?? [])
  const officers = officersInCity(game, cityId, { onlyAvailable: true })
  const toggle = (id: OfficerId) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {officers.map((o) => (
          <label
            key={o.id}
            className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-secondary"
          >
            <Checkbox checked={picked.includes(o.id)} onCheckedChange={() => toggle(o.id)} />
            <span className="text-sm">
              {o.name} <span className="text-xs opacity-70">兵{o.troops}</span>
            </span>
          </label>
        ))}
        {officers.length === 0 && <p className="text-sm text-muted-foreground">城中无可用武将。</p>}
      </div>
      <Button
        size="sm"
        disabled={picked.length === 0}
        onClick={() =>
          onDraft(advanceDraft(draft, { slot: 'campaign-members', officerIds: picked }))
        }
      >
        确定名单（{picked.length}）
      </Button>
    </div>
  )
}

/** 单数值终结槽（征兵/分配）。 */
function AmountInput({
  draft,
  fire,
}: {
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly fire: (a: Action) => void
}) {
  const [n, setN] = useState('100')
  const submit = () => {
    const action = draftToAction(advanceDraft(draft, { slot: 'amount', amount: Number(n) || 0 }))
    if (action) fire(action)
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0}
        value={n}
        onChange={(e) => setN(e.target.value)}
        className="w-28"
      />
      <Button size="sm" onClick={submit}>
        执行
      </Button>
    </div>
  )
}

/** 交易（买/卖 + 数量）。 */
function TradeInputs({
  draft,
  fire,
}: {
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly fire: (a: Action) => void
}) {
  const [mode, setMode] = useState<'buy' | 'sell'>('buy')
  const [n, setN] = useState('10')
  const submit = () => {
    const action = draftToAction(
      advanceDraft(draft, { slot: 'trade-args', mode, amount: Number(n) || 0 })
    )
    if (action) fire(action)
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        <Button
          size="sm"
          variant={mode === 'buy' ? 'default' : 'outline'}
          onClick={() => setMode('buy')}
        >
          买入
        </Button>
        <Button
          size="sm"
          variant={mode === 'sell' ? 'default' : 'outline'}
          onClick={() => setMode('sell')}
        >
          卖出
        </Button>
      </div>
      <Input
        type="number"
        min={0}
        value={n}
        onChange={(e) => setN(e.target.value)}
        className="w-24"
      />
      <Button size="sm" onClick={submit}>
        执行
      </Button>
    </div>
  )
}

/** 出征随军粮草。 */
function ProvisionsInput({
  draft,
  fire,
}: {
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly fire: (a: Action) => void
}) {
  const [n, setN] = useState('1000')
  const submit = () => {
    const action = draftToAction(
      advanceDraft(draft, { slot: 'provisions', provisions: Number(n) || 0 })
    )
    if (action) fire(action)
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm">随军粮草</span>
      <Input
        type="number"
        min={0}
        value={n}
        onChange={(e) => setN(e.target.value)}
        className="w-28"
      />
      <Button size="sm" onClick={submit}>
        出征
      </Button>
    </div>
  )
}

/** 输送三数（粮/金/兵）：面板直接组装 transport action。 */
function TransportInputs({
  draft,
  fire,
}: {
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly fire: (a: Action) => void
}) {
  const [food, setFood] = useState('0')
  const [gold, setGold] = useState('0')
  const [troops, setTroops] = useState('0')
  const submit = () => {
    if (draft.officerId === undefined || draft.targetCityId === undefined) return
    fire({
      type: 'transport',
      officerId: draft.officerId,
      targetCityId: draft.targetCityId,
      food: Number(food) || 0,
      gold: Number(gold) || 0,
      troops: Number(troops) || 0,
    })
  }
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm">
        粮{' '}
        <Input
          type="number"
          min={0}
          value={food}
          onChange={(e) => setFood(e.target.value)}
          className="w-24"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        金{' '}
        <Input
          type="number"
          min={0}
          value={gold}
          onChange={(e) => setGold(e.target.value)}
          className="w-24"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        兵{' '}
        <Input
          type="number"
          min={0}
          value={troops}
          onChange={(e) => setTroops(e.target.value)}
          className="w-24"
        />
      </label>
      <Button size="sm" onClick={submit}>
        输送
      </Button>
    </div>
  )
}
