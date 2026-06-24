import { useState } from 'react'
import { Coins, Wheat, Crown, CalendarDays, RotateCw } from 'lucide-react'
import { useCurrentGame, useGameStore } from '../../store/game-store'
import { playerCities, type CityId } from '../../store/selectors'
import { isPlayerFaction } from '../faction-color'
import { WorldMap } from '../world/world-map'
import { CityPanel } from '../world/city-panel'
import {
  advanceDraft,
  draftToAction,
  isAwaitingTargetCity,
  startCommand,
  type CommandDraft,
} from '../world/command-draft'
import { PauseDialogs } from '../pause-dialogs'
import { Button } from '../components/ui/button'
import { Screen, TopBar } from '../components/primitives'
import { reasonText } from '../feedback/messages'

/**
 * 经营大地图屏（`21-main-flow-ui`）：顶栏（纪年/君主/月末/新游戏）+ 大地图 + 右侧选中城面板 +
 * 暂停态对话框。本地状态仅「选中城」「命令草稿」；命令优先收集，目标城由地图点选回填。
 */
export function WorldScreen({ onNewGame }: { readonly onNewGame: () => void }) {
  const game = useCurrentGame()
  const dispatch = useGameStore((s) => s.dispatch)
  const canDispatch = useGameStore((s) => s.canDispatch)
  const cities = playerCities(game)

  const [selectedCityId, setSelectedCityId] = useState<CityId | null>(() => cities[0]?.id ?? null)
  const [draft, setDraft] = useState<CommandDraft>({ kind: 'pick-command' })

  const selectCityForView = (id: CityId) => {
    setSelectedCityId(id)
    const mine = isPlayerFaction(game.cities[id]?.lordId ?? null, game.playerLordId)
    setDraft(mine ? { kind: 'pick-command' } : { kind: 'idle' })
  }

  const onSelectCity = (id: CityId) => {
    if (draft.kind === 'collect' && isAwaitingTargetCity(draft)) {
      const d = advanceDraft(draft, { slot: 'target-city', targetCityId: id })
      const action = draftToAction(d)
      if (action) {
        dispatch(action)
        setDraft(startCommand(draft.command)) // 粘住复用（scout/move）
      } else {
        setDraft(d) // transport/campaign：继续收集
      }
      return
    }
    selectCityForView(id)
  }

  const lord = game.officers[game.playerLordId]
  const totalGold = cities.reduce((s, c) => s + c.gold, 0)
  const totalFood = cities.reduce((s, c) => s + c.food, 0)
  const endMonthCheck = canDispatch({ type: 'endMonth' })
  const highlight =
    draft.kind === 'collect' && isAwaitingTargetCity(draft) && selectedCityId !== null
      ? (game.adjacency[selectedCityId] ?? [])
      : undefined

  return (
    <Screen>
      <TopBar
        actions={
          <>
            <Button
              size="sm"
              disabled={!endMonthCheck.ok}
              title={
                !endMonthCheck.ok && endMonthCheck.reason ? reasonText(endMonthCheck.reason) : ''
              }
              onClick={() => dispatch({ type: 'endMonth' })}
            >
              结束策略
            </Button>
            <Button size="sm" variant="ghost" className="px-2" title="新游戏" onClick={onNewGame}>
              <RotateCw className="size-4" />
            </Button>
          </>
        }
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="font-display">
            {game.year} 年 {game.month} 月
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-sm">
          <Crown className="size-4 text-gold" />
          {lord?.name}
        </span>
        <span className="ml-auto flex items-center gap-1 text-sm tabular-nums" title="全境金钱">
          <Coins className="size-4 text-gold" />
          {totalGold.toLocaleString()}
        </span>
        <span className="flex items-center gap-1 text-sm tabular-nums" title="全境粮食">
          <Wheat className="size-4 text-bamboo" />
          {totalFood.toLocaleString()}
        </span>
      </TopBar>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 p-2">
          <WorldMap
            game={game}
            selectedCityId={selectedCityId}
            {...(highlight ? { highlightCityIds: highlight } : {})}
            onSelectCity={onSelectCity}
          />
        </div>

        <aside className="w-72 shrink-0 overflow-y-auto border-l bg-secondary/30 p-2.5">
          {selectedCityId !== null ? (
            <CityPanel
              cityId={selectedCityId}
              draft={draft}
              onDraft={setDraft}
              onSelectCity={selectCityForView}
            />
          ) : (
            <p className="text-sm text-muted-foreground">点选一座城查看详情。</p>
          )}
        </aside>
      </div>

      <PauseDialogs />
    </Screen>
  )
}
