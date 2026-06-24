import { useState, type ReactNode } from 'react'
import {
  Wheat,
  Store,
  Heart,
  ShieldCheck,
  Coins,
  UserRound,
  Swords,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Crown,
} from 'lucide-react'
import { useCurrentGame, useGameStore } from '../../store/game-store'
import type { Action, City, CityId, GameState } from '../../store/selectors'
import {
  officersInCity,
  captivesInCity,
  itemsInCity,
  itemsOfOfficer,
  effectiveOfficer,
  governorOf,
  playerCities,
  recruitMaxTroops,
  allocateMaxTroops,
  buyMaxFood,
} from '../../store/selectors'
import {
  startCommand,
  advanceDraft,
  draftToAction,
  stepBack,
  COMMAND_GROUPS,
  type CommandDraft,
  type CommandKind,
} from './command-draft'
import { COMMAND_LABEL, COMMAND_GROUP_LABEL, STATUS_LABEL } from '../labels'
import { isPlayerFaction } from '../faction-color'
import { reasonText } from '../feedback/messages'
import { OfficerTable } from './officer-table'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Panel, StatRow } from '../components/primitives'
import { Sheet, SheetContent, SheetTitle } from '../components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../components/ui/dropdown-menu'

/**
 * 选中城操作面板（`21-main-flow-ui`）：我方城=信息 + 命令面板；敌/空城=只读信息。
 * 点一条命令即从右侧弹出非模态抽屉逐步收集入参（CollectContent），关闭抽屉=取消命令。
 * 合法性一律走 canDispatch（按钮置灰 + reason 提示）；离散终结选择「选完即派发 + 命令粘住复用」。
 */
export function CityPanel({
  cityId,
  draft,
  onDraft,
  onSelectCity,
}: {
  readonly cityId: CityId
  readonly draft: CommandDraft
  readonly onDraft: (d: CommandDraft) => void
  readonly onSelectCity: (id: CityId) => void
}) {
  const game = useCurrentGame()
  const city = game.cities[cityId]
  if (!city) return null
  const mine = isPlayerFaction(city.lordId, game.playerLordId)
  const gov = governorOf(game, cityId)
  const governorName = gov ? gov.name : '无'

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <CitySwitcher game={game} city={city} mine={mine} onSelectCity={onSelectCity} />

      {mine ? (
        <Tabs defaultValue="stats" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="self-start">
            <TabsTrigger value="stats">城务</TabsTrigger>
            <TabsTrigger value="commands">指令</TabsTrigger>
          </TabsList>
          <TabsContent value="stats" className="min-h-0 flex-1 overflow-y-auto">
            <CityStats city={city} governorName={governorName} />
          </TabsContent>
          <TabsContent value="commands" className="min-h-0 flex-1 overflow-y-auto">
            <CommandPalette onPick={(k) => onDraft(startCommand(k))} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
          <CityStats city={city} governorName={governorName} />
          <Panel title="敌方 / 空城">
            <p className="text-xs leading-relaxed text-muted-foreground">
              仅可见信息。发起「侦察 / 移动 / 输送 / 出征」并到选目标城步骤时，此城可作为目标点选。
            </p>
          </Panel>
        </div>
      )}

      <CommandDrawer cityId={cityId} draft={draft} onDraft={onDraft} />
    </div>
  )
}

/** 顶部己方城切换器：prev/next 翻 + 下拉跳转（按 id 升序）；可从地图点中的敌/空城切回己方城。 */
function CitySwitcher({
  game,
  city,
  mine,
  onSelectCity,
}: {
  readonly game: GameState
  readonly city: City
  readonly mine: boolean
  readonly onSelectCity: (id: CityId) => void
}) {
  const owned = [...playerCities(game)].sort((a, b) => a.id - b.id)
  const badge = (
    <Badge variant={mine ? 'default' : city.lordId === null ? 'secondary' : 'destructive'}>
      {mine ? '我方' : city.lordId === null ? '空城' : '敌方'}
    </Badge>
  )

  // 无己方城：退化为纯城名。
  if (owned.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl font-bold leading-none">{city.name}</h2>
        {badge}
      </div>
    )
  }

  const idx = owned.findIndex((c) => c.id === city.id)
  const step = (delta: number) => {
    // 当前不在己方列表（敌/空城）时，prev/next 落到第一座己方城。
    const base = idx < 0 ? 0 : (idx + delta + owned.length) % owned.length
    onSelectCity(owned[base]!.id)
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => step(-1)}>
        <ChevronLeft className="size-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-secondary">
            <span className="font-display text-xl font-bold leading-none">{city.name}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[7rem]">
          {owned.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onSelect={() => onSelectCity(c.id)}
              className={c.id === city.id ? 'font-semibold text-vermilion' : ''}
            >
              {c.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => step(1)}>
        <ChevronRight className="size-4" />
      </Button>
      <span className="ml-auto">{badge}</span>
    </div>
  )
}

/** 城务单卡：顶部金/粮/兵大字强调 + 下方农/商/民忠/防灾/人口紧凑区。 */
function CityStats({ city, governorName }: { readonly city: City; readonly governorName: string }) {
  const ratio = (n: number, d: number) => (d > 0 ? n / d : 0)
  return (
    <Panel
      title="城务"
      trailing={
        <Badge variant={city.status === 'normal' ? 'secondary' : 'destructive'}>
          {STATUS_LABEL[city.status]}
        </Badge>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-1.5">
          <BigStat icon={<Coins />} label="金钱" value={city.gold} />
          <BigStat icon={<Wheat />} label="粮食" value={city.food} />
          <BigStat icon={<Swords />} label="后备兵" value={city.reserveTroops} />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-2">
          <StatRow
            icon={<Wheat />}
            label="农业"
            value={`${city.agriculture}/${city.agricultureCap}`}
            ratio={ratio(city.agriculture, city.agricultureCap)}
          />
          <StatRow
            icon={<Store />}
            label="商业"
            value={`${city.commerce}/${city.commerceCap}`}
            ratio={ratio(city.commerce, city.commerceCap)}
            barClassName="bg-gold"
          />
          <StatRow
            icon={<Heart />}
            label="民忠"
            value={city.loyalty}
            ratio={ratio(city.loyalty, 100)}
            barClassName="bg-vermilion"
          />
          <StatRow
            icon={<ShieldCheck />}
            label="防灾"
            value={city.disasterPrevention}
            ratio={ratio(city.disasterPrevention, 100)}
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-2 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground [&_svg]:size-3.5">
            <Crown />
            太守
            <span className="font-medium text-foreground">{governorName}</span>
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground [&_svg]:size-3.5">
            <UserRound />
            人口
            <span className="font-medium tabular-nums text-foreground">
              {city.population.toLocaleString()}
            </span>
          </span>
        </div>
      </div>
    </Panel>
  )
}

/** 重点指标大字块（金/粮/兵）。 */
function BigStat({
  icon,
  label,
  value,
}: {
  readonly icon: ReactNode
  readonly label: string
  readonly value: number
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-md bg-secondary/40 py-1">
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground [&_svg]:size-3">
        {icon}
        {label}
      </span>
      <span className="font-display text-lg font-bold leading-none tabular-nums">
        {value.toLocaleString()}
      </span>
    </div>
  )
}

/** 命令面板（指令 tab）：每类一区——组名 + 该类全部命令平铺成整齐网格，点一条即收集入参。 */
function CommandPalette({ onPick }: { readonly onPick: (k: CommandKind) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {(Object.keys(COMMAND_GROUPS) as (keyof typeof COMMAND_GROUPS)[]).map((group) => (
        <div key={group} className="flex flex-col gap-1">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
            {COMMAND_GROUP_LABEL[group]}
          </span>
          <div className="grid grid-cols-4 gap-1">
            {COMMAND_GROUPS[group].map((k) => (
              <Button
                key={k}
                size="sm"
                variant="outline"
                className="px-1"
                onClick={() => onPick(k)}
              >
                {COMMAND_LABEL[k]}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** 收集态步骤指示：命令名 + 已收集/待收集进度点。 */
function StepIndicator({ done, current }: { readonly done: number; readonly current: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {Array.from({ length: done }).map((_, i) => (
        <span key={i} className="size-1.5 rounded-full bg-bamboo" aria-hidden />
      ))}
      <span className="size-1.5 animate-pulse rounded-full bg-vermilion" aria-hidden />
      <span className="ml-0.5">{current}</span>
    </div>
  )
}

/** 当前收集槽的中文步骤名（驱动步骤指示）。 */
const SLOT_HINT: Record<string, string> = {
  executor: '选执行武将',
  amount: '填数量',
  'trade-args': '选买卖与数量',
  item: '选道具',
  captive: '选俘虏',
  'target-officer': '选目标武将',
  'target-city': '选目标城',
  'campaign-members': '选出征名单',
  provisions: '填随军粮草',
}

/** 命令收集抽屉：仅收集态弹出（非模态、不遮地图）；关闭即取消命令。 */
function CommandDrawer({
  cityId,
  draft,
  onDraft,
}: {
  readonly cityId: CityId
  readonly draft: CommandDraft
  readonly onDraft: (d: CommandDraft) => void
}) {
  return (
    <Sheet
      open={draft.kind === 'collect'}
      onOpenChange={(o) => {
        if (!o) onDraft({ kind: 'pick-command' })
      }}
    >
      {draft.kind === 'collect' && (
        <SheetContent>
          <CollectContent cityId={cityId} draft={draft} onDraft={onDraft} />
        </SheetContent>
      )}
    </Sheet>
  )
}

/** 收集态正文（抽屉内）：按 awaiting 渲染对应选择/输入；终结离散选择即派发 + 命令粘住复用。 */
function CollectContent({
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
  const city = game.cities[cityId]!

  /** 派发 + 粘住复用同一命令。 */
  const fire = (action: Action) => {
    dispatch(action)
    onDraft(startCommand(draft.command))
  }

  const done = [
    draft.officerId,
    draft.targetCityId,
    draft.officerIds,
    draft.itemId,
    draft.captiveId,
    draft.targetOfficerId,
    draft.amount,
    draft.tradeMode,
    draft.provisions,
  ].filter((v) => v !== undefined).length

  const amountMax =
    draft.command === 'recruit'
      ? recruitMaxTroops(city)
      : draft.officerId !== undefined
        ? allocateMaxTroops(effectiveOfficer(game, draft.officerId), city)
        : 0
  const amountMin = draft.command === 'recruit' ? 1 : 0

  return (
    <>
      <div className="flex items-center gap-2 pr-6">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-0.5 px-1.5"
          onClick={() => onDraft(stepBack(draft))}
        >
          <ChevronLeft className="size-4" />
          上一步
        </Button>
        <SheetTitle className="font-display text-base font-semibold">
          {COMMAND_LABEL[draft.command]}
        </SheetTitle>
        <StepIndicator done={done} current={SLOT_HINT[draft.awaiting] ?? '补全参数'} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
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
            <TransportInputs
              draft={draft}
              fire={fire}
              foodMax={city.food}
              goldMax={city.gold}
              troopsMax={city.reserveTroops}
            />
          ) : (
            <AmountInput draft={draft} fire={fire} max={amountMax} min={amountMin} />
          ))}
        {draft.awaiting === 'trade-args' && (
          <TradeInputs
            draft={draft}
            fire={fire}
            buyMax={buyMaxFood(city.gold)}
            sellMax={city.food}
          />
        )}
        {draft.awaiting === 'provisions' && (
          <ProvisionsInput draft={draft} fire={fire} max={city.food} />
        )}
      </div>
    </>
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
  return (
    <OfficerTable
      mode="single"
      game={game}
      officers={officers}
      emptyText="城中无可用武将。"
      checkFor={(id) => {
        const probe = draftToAction(advanceDraft(draft, { slot: 'executor', officerId: id }))
        return probe ? canDispatch(probe) : { ok: true as const }
      }}
      onSelect={(id) => {
        const d = advanceDraft(draft, { slot: 'executor', officerId: id })
        const action = draftToAction(d)
        if (action) fire(action)
        else onDraft(d)
      }}
    />
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
  return (
    <OfficerTable
      mode="single"
      game={game}
      officers={captives}
      emptyText="城中无俘虏。"
      onSelect={(id) => {
        const action = draftToAction(advanceDraft(draft, { slot: 'captive', captiveId: id }))
        if (action) fire(action)
      }}
    />
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
  return (
    <OfficerTable
      mode="single"
      game={game}
      officers={enemies}
      emptyText="无敌方武将。"
      checkFor={(id) => {
        const action = draftToAction(
          advanceDraft(draft, { slot: 'target-officer', targetOfficerId: id })
        )
        return action ? canDispatch(action) : { ok: false as const }
      }}
      onSelect={(id) => {
        const action = draftToAction(
          advanceDraft(draft, { slot: 'target-officer', targetOfficerId: id })
        )
        if (action) fire(action)
      }}
    />
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
  const [picked, setPicked] = useState<readonly number[]>(draft.officerIds ?? [])
  const officers = officersInCity(game, cityId, { onlyAvailable: true })
  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <OfficerTable
          mode="multi"
          game={game}
          officers={officers}
          emptyText="城中无可用武将。"
          selectedIds={picked}
          onToggle={toggle}
        />
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

/** 单数值终结槽（征兵/分配）：带可用上限、默认填满、超界钳制/禁用。 */
function AmountInput({
  draft,
  fire,
  max,
  min,
}: {
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly fire: (a: Action) => void
  readonly max: number
  readonly min: number
}) {
  const [n, setN] = useState(String(max))
  const clamped = Math.max(min, Math.min(max, Math.floor(Number(n) || 0)))
  const submit = () => {
    const action = draftToAction(advanceDraft(draft, { slot: 'amount', amount: clamped }))
    if (action) fire(action)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">
        可用上限 <span className="font-medium text-foreground tabular-nums">{max}</span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={min}
          max={max}
          value={n}
          onChange={(e) => setN(e.target.value)}
          className="w-32"
        />
        <Button size="sm" disabled={max < min} onClick={submit}>
          执行（{clamped}）
        </Button>
      </div>
    </div>
  )
}

/** 交易（买/卖 + 数量）：上限随买卖切换重算，默认填满。 */
function TradeInputs({
  draft,
  fire,
  buyMax,
  sellMax,
}: {
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly fire: (a: Action) => void
  readonly buyMax: number
  readonly sellMax: number
}) {
  const [mode, setMode] = useState<'buy' | 'sell'>('buy')
  const [n, setN] = useState('0')
  const max = mode === 'buy' ? buyMax : sellMax
  const clamped = Math.max(0, Math.min(max, Math.floor(Number(n) || 0)))
  const pick = (m: 'buy' | 'sell') => setMode(m)
  const submit = () => {
    const action = draftToAction(advanceDraft(draft, { slot: 'trade-args', mode, amount: clamped }))
    if (action) fire(action)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        <Button
          size="sm"
          variant={mode === 'buy' ? 'default' : 'outline'}
          onClick={() => pick('buy')}
        >
          买入
        </Button>
        <Button
          size="sm"
          variant={mode === 'sell' ? 'default' : 'outline'}
          onClick={() => pick('sell')}
        >
          卖出
        </Button>
      </div>
      <div className="text-xs text-muted-foreground">
        可{mode === 'buy' ? '买' : '卖'}上限{' '}
        <span className="font-medium text-foreground tabular-nums">{max}</span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={max}
          value={n}
          onChange={(e) => setN(e.target.value)}
          className="w-28"
        />
        <Button size="sm" onClick={submit}>
          执行（{clamped}）
        </Button>
      </div>
    </div>
  )
}

/** 出征随军粮草：上限 = 本城城粮，默认填满。 */
function ProvisionsInput({
  draft,
  fire,
  max,
}: {
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly fire: (a: Action) => void
  readonly max: number
}) {
  const [n, setN] = useState(String(max))
  const clamped = Math.max(1, Math.min(max, Math.floor(Number(n) || 0)))
  const submit = () => {
    const action = draftToAction(advanceDraft(draft, { slot: 'provisions', provisions: clamped }))
    if (action) fire(action)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">
        随军粮草上限 <span className="font-medium text-foreground tabular-nums">{max}</span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={max}
          value={n}
          onChange={(e) => setN(e.target.value)}
          className="w-32"
        />
        <Button size="sm" disabled={max < 1} onClick={submit}>
          出征（{clamped}）
        </Button>
      </div>
    </div>
  )
}

/** 输送三数（粮/金/兵）：各栏带上限、默认填满；面板直接组装 transport action。 */
function TransportInputs({
  draft,
  fire,
  foodMax,
  goldMax,
  troopsMax,
}: {
  readonly draft: Extract<CommandDraft, { kind: 'collect' }>
  readonly fire: (a: Action) => void
  readonly foodMax: number
  readonly goldMax: number
  readonly troopsMax: number
}) {
  const [food, setFood] = useState('0')
  const [gold, setGold] = useState('0')
  const [troops, setTroops] = useState('0')
  const clamp = (v: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)))
  const submit = () => {
    if (draft.officerId === undefined || draft.targetCityId === undefined) return
    fire({
      type: 'transport',
      officerId: draft.officerId,
      targetCityId: draft.targetCityId,
      food: clamp(food, foodMax),
      gold: clamp(gold, goldMax),
      troops: clamp(troops, troopsMax),
    })
  }
  return (
    <div className="flex flex-col gap-2">
      <NumberRow label="粮" value={food} max={foodMax} onChange={setFood} />
      <NumberRow label="金" value={gold} max={goldMax} onChange={setGold} />
      <NumberRow label="兵" value={troops} max={troopsMax} onChange={setTroops} />
      <Button size="sm" onClick={submit}>
        输送
      </Button>
    </div>
  )
}

function NumberRow({
  label,
  value,
  max,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly max: number
  readonly onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-4">{label}</span>
      <Input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-28"
      />
      <span className="text-xs text-muted-foreground">/ {max}</span>
    </label>
  )
}
