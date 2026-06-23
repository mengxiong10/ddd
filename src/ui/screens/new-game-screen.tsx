import { useMemo, useState } from 'react'
import { useGameStore } from '../../store/game-store'
import {
  SCENARIOS,
  lordsForScenario,
  scenarioPreview,
  type ScenarioId,
  type OfficerId,
} from '../../store/selectors'
import { Button } from '../components/ui/button'
import { cn } from '@/lib/utils'
import { ScenarioPreviewMap } from './scenario-preview-map'

/** 步骤指示条。 */
function Steps({ step }: { readonly step: 'scenario' | 'lord' }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className={cn(step === 'scenario' && 'font-semibold text-foreground')}>① 选剧本</span>
      <span className="opacity-40">─────</span>
      <span className={cn(step === 'lord' && 'font-semibold text-foreground')}>② 选君主</span>
    </div>
  )
}

/**
 * 开局两步向导（`21-main-flow-ui`）：①剧本卡片 →②左君主列表 + 右预览地图 → newGame。
 */
export function NewGameScreen({
  onStarted,
  canCancel,
  onCancel,
}: {
  readonly onStarted: () => void
  readonly canCancel: boolean
  readonly onCancel: () => void
}) {
  const newGame = useGameStore((s) => s.newGame)
  const [step, setStep] = useState<'scenario' | 'lord'>('scenario')
  const [scenarioId, setScenarioId] = useState<ScenarioId | null>(null)
  const [lordId, setLordId] = useState<OfficerId | null>(null)

  const lords = useMemo(() => (scenarioId ? lordsForScenario(scenarioId) : []), [scenarioId])
  const preview = useMemo(() => (scenarioId ? scenarioPreview(scenarioId) : null), [scenarioId])
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)

  const start = () => {
    if (!scenarioId || lordId === null) return
    newGame({ scenarioId, playerLordId: lordId, seed: Date.now() >>> 0 })
    onStarted()
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">三国 · 新的征程</h1>
        {canCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
        )}
      </header>
      <Steps step={step} />

      {step === 'scenario' && (
        <>
          <div className="grid flex-1 grid-cols-2 content-start gap-3 overflow-y-auto sm:grid-cols-4">
            {SCENARIOS.map((s) => {
              const active = s.id === scenarioId
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setScenarioId(s.id)
                    setLordId(null)
                  }}
                  className={cn(
                    'flex h-32 flex-col items-center justify-center gap-2 rounded-lg border bg-card p-3 text-center transition-shadow',
                    active ? 'ring-2 ring-accent shadow-md' : 'hover:shadow-sm'
                  )}
                >
                  <span className="text-base font-semibold">{s.name}</span>
                  <span className="text-sm text-muted-foreground">{s.startYear} 年</span>
                </button>
              )
            })}
          </div>
          <footer className="flex justify-end">
            <Button disabled={!scenarioId} onClick={() => setStep('lord')}>
              下一步：选君主
            </Button>
          </footer>
        </>
      )}

      {step === 'lord' && preview && (
        <>
          <div className="text-sm text-muted-foreground">
            {scenario?.name} · {scenario?.startYear} 年
          </div>
          <div className="grid flex-1 grid-cols-[14rem_1fr] gap-4 overflow-hidden">
            <div className="flex flex-col gap-1.5 overflow-y-auto pr-1">
              {lords.map((l) => {
                const active = l.id === lordId
                return (
                  <button
                    key={l.id}
                    onClick={() => setLordId(l.id)}
                    className={cn(
                      'flex items-center justify-between rounded-md border bg-card px-3 py-2 text-left text-sm transition-shadow',
                      active ? 'ring-2 ring-accent' : 'hover:shadow-sm'
                    )}
                  >
                    <span className="font-medium">{l.name}</span>
                    <span className="text-muted-foreground">×{l.cityCount}</span>
                  </button>
                )
              })}
            </div>
            <div className="rounded-lg border bg-card p-2">
              <ScenarioPreviewMap preview={preview} selectedLordId={lordId} />
            </div>
          </div>
          <footer className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('scenario')}>
              ← 返回选剧本
            </Button>
            <Button disabled={lordId === null} onClick={start}>
              开始游戏
            </Button>
          </footer>
        </>
      )}
    </div>
  )
}
