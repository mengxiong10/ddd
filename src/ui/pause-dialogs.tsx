import { useGameStore } from '../store/game-store'
import { successionCandidates, effectiveOfficer } from '../store/selectors'

/** 玩家君主遭劫 → 拥立新君（最小选人弹窗）。 */
function SuccessionDialog({ lordId }: { lordId: string }) {
  const game = useGameStore((s) => s.game)
  const dispatch = useGameStore((s) => s.dispatch)
  const candidates = successionCandidates(game, lordId)
  return (
    <div className="dialog-mask">
      <div className="dialog">
        <h3>请拥立新君</h3>
        <p>君主 {game.officers[lordId]?.name ?? lordId} 遭劫，请从麾下择一人继位：</p>
        <div className="dialog-options">
          {candidates.map((o) => (
            <button
              key={o.id}
              className="cmd"
              onClick={() => dispatch({ type: 'chooseSuccessor', officerId: o.id })}
            >
              {o.name}（智力 {effectiveOfficer(game, o.id).intelligence}）
            </button>
          ))}
          {candidates.length === 0 && <em>已无可立之人。</em>}
        </div>
      </div>
    </div>
  )
}

/** AI 进攻我方城 → 选守军（本切片仅「弃守」；交互式防守战留后续切片）。 */
function DefenseDialog({ targetCityId }: { targetCityId: string }) {
  const game = useGameStore((s) => s.game)
  const dispatch = useGameStore((s) => s.dispatch)
  return (
    <div className="dialog-mask">
      <div className="dialog">
        <h3>敌军来犯</h3>
        <p>{game.cities[targetCityId]?.name ?? targetCityId} 遭敌进攻。</p>
        <p className="hint">（交互式防守战将在后续切片接入，本切片暂仅支持弃守。）</p>
        <div className="dialog-options">
          <button
            className="cmd"
            onClick={() => dispatch({ type: 'chooseDefenders', officerIds: [] })}
          >
            弃守
          </button>
        </div>
      </div>
    </div>
  )
}

/** 暂停态弹窗总入口：按 store 暴露的暂停态择一渲染。 */
export function PauseDialogs() {
  const pendingSuccession = useGameStore((s) => s.game.pendingSuccession)
  const pendingDefense = useGameStore((s) => s.game.pendingDefense)
  if (pendingSuccession) return <SuccessionDialog lordId={pendingSuccession.lordId} />
  if (pendingDefense) return <DefenseDialog targetCityId={pendingDefense.targetCityId} />
  return null
}
