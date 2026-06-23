import { useState } from 'react'
import { useCurrentGame, useGameStore } from '../store/game-store'
import {
  successionCandidates,
  effectiveOfficer,
  defendingOfficers,
  governorOf,
  type CityId,
  type OfficerId,
} from '../store/selectors'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './components/ui/dialog'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'

const MAX_DEFENDERS = 10

/** 玩家君主遭劫 → 拥立新君（强制模态、必选其一、无取消）。 */
function SuccessionDialog({ lordId }: { readonly lordId: OfficerId }) {
  const game = useCurrentGame()
  const dispatch = useGameStore((s) => s.dispatch)
  const candidates = successionCandidates(game, lordId)
  return (
    <Dialog open>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>请拥立新君</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          君主 {game.officers[lordId]?.name ?? lordId} 遭劫，择一继位：
        </p>
        <div className="flex flex-col gap-1.5">
          {candidates.map((o) => (
            <Button
              key={o.id}
              variant="outline"
              className="justify-between"
              onClick={() => dispatch({ type: 'chooseSuccessor', officerId: o.id })}
            >
              <span>{o.name}</span>
              <span className="text-xs text-muted-foreground">
                智 {effectiveOfficer(game, o.id).intelligence}
                {governorOf(game, o.cityId ?? -1)?.id === o.id ? ' · 太守' : ''}
              </span>
            </Button>
          ))}
          {candidates.length === 0 && <p className="text-sm">已无可立之人，势力将灭亡。</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 推荐守军：太守领衔 + 其余兵力降序，限 10。 */
function recommendedDefenders(
  game: ReturnType<typeof useCurrentGame>,
  cityId: CityId
): readonly OfficerId[] {
  const pool = defendingOfficers(game, cityId)
  const gov = governorOf(game, cityId)
  const lead = gov && pool.some((o) => o.id === gov.id) ? [gov.id] : []
  const rest = pool
    .filter((o) => o.id !== gov?.id)
    .sort((a, b) => b.troops - a.troops || a.id - b.id)
    .map((o) => o.id)
  return [...lead, ...rest].slice(0, MAX_DEFENDERS)
}

/** AI 进攻我方城 → 选守军（默认勾选推荐守军，可增删；出战 / 弃守）。 */
function DefenseDialog({ targetCityId }: { readonly targetCityId: CityId }) {
  const game = useCurrentGame()
  const dispatch = useGameStore((s) => s.dispatch)
  const candidates = defendingOfficers(game, targetCityId)
  const gov = governorOf(game, targetCityId)
  const [picked, setPicked] = useState<readonly OfficerId[]>(() =>
    recommendedDefenders(game, targetCityId)
  )
  const toggle = (id: OfficerId) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <Dialog open>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>敌军来犯 · {game.cities[targetCityId]?.name ?? targetCityId}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          选择出战守军（最多 {MAX_DEFENDERS}）已选 {picked.length}/{MAX_DEFENDERS}
        </p>
        <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
          {candidates.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-secondary"
            >
              <Checkbox
                checked={picked.includes(o.id)}
                disabled={!picked.includes(o.id) && picked.length >= MAX_DEFENDERS}
                onCheckedChange={() => toggle(o.id)}
              />
              <span className="text-sm">
                {o.name} 兵{o.troops}
                {gov?.id === o.id ? ' · 太守' : ''}
              </span>
            </label>
          ))}
          {candidates.length === 0 && <p className="text-sm">城中无可战守军。</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => dispatch({ type: 'chooseDefenders', officerIds: [] })}
          >
            弃守（直接占城）
          </Button>
          <Button
            disabled={picked.length === 0}
            onClick={() => dispatch({ type: 'chooseDefenders', officerIds: picked })}
          >
            出战
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 暂停态总入口：按 store 暴露的暂停态择一渲染（强制模态，叠在大地图屏上）。 */
export function PauseDialogs() {
  const game = useCurrentGame()
  if (game.pendingSuccession) return <SuccessionDialog lordId={game.pendingSuccession.lordId} />
  if (game.pendingDefense) return <DefenseDialog targetCityId={game.pendingDefense.targetCityId} />
  return null
}
