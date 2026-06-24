import { useState } from 'react'
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
  const endMonthCheck = canDispatch({ type: 'endMonth' })
  const highlight =
    draft.kind === 'collect' && isAwaitingTargetCity(draft) && selectedCityId !== null
      ? (game.adjacency[selectedCityId] ?? [])
      : undefined

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b bg-card px-3 py-2">
        <span className="text-sm font-semibold">
          公元 {game.year} 年 {game.month} 月 · 君主：{lord?.name}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            disabled={!endMonthCheck.ok}
            title={
              !endMonthCheck.ok && endMonthCheck.reason ? reasonText(endMonthCheck.reason) : ''
            }
            onClick={() => dispatch({ type: 'endMonth' })}
          >
            结束策略（月末）
          </Button>
          <Button size="sm" variant="outline" onClick={onNewGame}>
            新游戏
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 p-2">
            <WorldMap
              game={game}
              selectedCityId={selectedCityId}
              {...(highlight ? { highlightCityIds: highlight } : {})}
              onSelectCity={onSelectCity}
            />
          </div>
        </div>

        <aside className="w-72 shrink-0 border-l bg-card p-3">
          {selectedCityId !== null ? (
            <CityPanel cityId={selectedCityId} draft={draft} onDraft={setDraft} />
          ) : (
            <p className="text-sm text-muted-foreground">点选一座城查看详情。</p>
          )}
        </aside>
      </div>

      <PauseDialogs />
    </div>
  )
}
