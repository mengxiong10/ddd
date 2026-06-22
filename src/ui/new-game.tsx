import { useMemo, useState } from 'react'
import { useGameStore } from '../store/game-store'
import { SCENARIOS, lordsForScenario, type ScenarioId } from '../store/selectors'
import type { OfficerId } from '../store/selectors'

export interface NewGameScreenProps {
  readonly canCancel: boolean
  readonly onCancel: () => void
}

export function NewGameScreen({ canCancel, onCancel }: NewGameScreenProps) {
  const newGame = useGameStore((state) => state.newGame)
  const [scenarioId, setScenarioId] = useState<ScenarioId | ''>('')
  const [lordId, setLordId] = useState<OfficerId | null>(null)
  const lords = useMemo(() => (scenarioId === '' ? [] : lordsForScenario(scenarioId)), [scenarioId])

  const confirm = () => {
    if (scenarioId === '' || lordId === null) return
    newGame({ scenarioId, playerLordId: lordId, seed: Date.now() >>> 0 })
    onCancel()
  }

  return (
    <div className={canCancel ? 'new-game-mask' : 'new-game-page'}>
      <section className="new-game-panel">
        <h1>新游戏</h1>
        <label>
          剧本
          <select
            value={scenarioId}
            onChange={(event) => {
              setScenarioId(event.target.value as ScenarioId | '')
              setLordId(null)
            }}
          >
            <option value="">请选择剧本</option>
            {SCENARIOS.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name}（{scenario.startYear} 年）
              </option>
            ))}
          </select>
        </label>
        <label>
          君主
          <select
            value={lordId ?? ''}
            disabled={scenarioId === ''}
            onChange={(event) =>
              setLordId(event.target.value === '' ? null : Number(event.target.value))
            }
          >
            <option value="">请选择君主</option>
            {lords.map((lord) => (
              <option key={lord.id} value={lord.id}>
                {lord.name}（{lord.cityCount} 城）
              </option>
            ))}
          </select>
        </label>
        <div className="new-game-actions">
          {canCancel && <button onClick={onCancel}>取消</button>}
          <button className="cmd" disabled={scenarioId === '' || lordId === null} onClick={confirm}>
            开始游戏
          </button>
        </div>
      </section>
    </div>
  )
}
