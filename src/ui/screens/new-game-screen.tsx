import { useMemo, useState } from 'react'
import { Crown, Swords, Sparkles, Building2, ArrowLeft, ChevronRight } from 'lucide-react'
import { useGameStore } from '../../store/game-store'
import {
  SCENARIOS,
  lordsForScenario,
  scenarioPreview,
  type ScenarioId,
  type ScenarioPreview,
  type OfficerId,
} from '../../store/selectors'
import { Button } from '../components/ui/button'
import { Screen } from '../components/primitives'
import { factionColor } from '../faction-color'
import { officerPortrait } from '../assets/registry'
import { cn } from '@/lib/utils'
import { ScenarioPreviewMap } from './scenario-preview-map'

type Step = 'cover' | 'scenario' | 'lord'

/** 剧本卡片缩略地图：仅势力色点（无连线/无城名），快速看清割据格局。 */
function MiniMap({ preview }: { readonly preview: ScenarioPreview }) {
  return (
    <svg viewBox="0 0 12 9" preserveAspectRatio="xMidYMid meet" className="h-full w-full">
      {preview.cities.map((c) => (
        <circle
          key={c.id}
          cx={c.x + 0.5}
          cy={c.y + 0.5}
          r={0.32}
          fill={factionColor(c.lordId, -1)}
        />
      ))}
    </svg>
  )
}

/** 君主头像：有立绘则取注册表图片，否则回退「姓名首字 + 势力色块」。 */
function LordAvatar({ id, name }: { readonly id: OfficerId; readonly name: string }) {
  const portrait = officerPortrait(id)
  if (portrait)
    return <img src={portrait} alt={name} className="size-9 shrink-0 rounded-md object-cover" />
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-md font-display text-base font-bold text-primary-foreground"
      style={{ backgroundColor: factionColor(id, id) }}
    >
      {name[0]}
    </span>
  )
}

/**
 * 开局向导（`21-main-flow-ui` 打磨）：①封面（产品名 + 印玺 + 开始）②剧本卡片（缩略图 + 割据数）
 * ③君主卡片（头像 + 武/智/城）+ 右侧预览地图。重玩（canCancel）时跳过封面直接进选剧本。
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
  const [step, setStep] = useState<Step>(canCancel ? 'scenario' : 'cover')
  const firstScenarioId = SCENARIOS[0]?.id ?? null
  const [scenarioId, setScenarioId] = useState<ScenarioId | null>(firstScenarioId)
  const [lordId, setLordId] = useState<OfficerId | null>(() =>
    firstScenarioId !== null ? (lordsForScenario(firstScenarioId)[0]?.id ?? null) : null
  )

  const lords = useMemo(() => (scenarioId ? lordsForScenario(scenarioId) : []), [scenarioId])
  const preview = useMemo(() => (scenarioId ? scenarioPreview(scenarioId) : null), [scenarioId])
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)

  const start = () => {
    if (!scenarioId || lordId === null) return
    newGame({ scenarioId, playerLordId: lordId, seed: Date.now() >>> 0 })
    onStarted()
  }

  if (step === 'cover') {
    return (
      <Screen className="items-center justify-center p-6 text-center">
        <div className="flex flex-col items-center gap-5">
          <div className="flex size-24 items-center justify-center rounded-2xl bg-vermilion text-primary-foreground shadow-[var(--shadow-float)]">
            <span className="font-display text-3xl font-bold leading-tight">
              三<br />国
            </span>
          </div>
          <div>
            <h1 className="font-display text-4xl font-bold tracking-wide">经营统一</h1>
            <p className="mt-2 text-sm text-muted-foreground">运筹城务 · 招贤纳士 · 逐鹿中原</p>
          </div>
          <Button size="lg" className="mt-2 gap-1.5" onClick={() => setStep('scenario')}>
            开始新游戏
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen className="gap-3 p-4">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold">
          {step === 'scenario' ? '择一乱世' : '择一明主'}
        </h1>
        {canCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
        )}
      </header>

      {step === 'scenario' && (
        <>
          <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto p-0.5 sm:grid-cols-4">
            {SCENARIOS.map((s) => {
              const active = s.id === scenarioId
              const factions = lordsForScenario(s.id).length
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setScenarioId(s.id)
                    setLordId(lordsForScenario(s.id)[0]?.id ?? null)
                  }}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border bg-card p-3 text-left shadow-[var(--shadow-card)] transition-all',
                    active ? 'ring-2 ring-vermilion' : 'hover:-translate-y-0.5'
                  )}
                >
                  <div className="aspect-[12/9] overflow-hidden rounded-md bg-secondary/50">
                    <MiniMap preview={scenarioPreview(s.id)} />
                  </div>
                  <div>
                    <div className="font-display text-base font-semibold">{s.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{s.startYear} 年</span>
                      <span className="flex items-center gap-0.5">
                        <Crown className="size-3" />
                        {factions} 家割据
                      </span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
          <footer className="flex justify-end">
            <Button disabled={!scenarioId} className="gap-1.5" onClick={() => setStep('lord')}>
              选君主
              <ChevronRight className="size-4" />
            </Button>
          </footer>
        </>
      )}

      {step === 'lord' && preview && (
        <>
          <div className="text-xs text-muted-foreground">
            {scenario?.name} · {scenario?.startYear} 年
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[15rem_1fr] grid-rows-1 gap-4 overflow-hidden">
            <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto p-0.5 pr-1">
              {lords.map((l) => {
                const active = l.id === lordId
                return (
                  <button
                    key={l.id}
                    onClick={() => setLordId(l.id)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md border bg-card px-2.5 py-2 text-left shadow-[var(--shadow-card)] transition-all',
                      active ? 'ring-2 ring-vermilion' : 'hover:-translate-y-0.5'
                    )}
                  >
                    <LordAvatar id={l.id} name={l.name} />
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-sm font-semibold">{l.name}</div>
                      <div className="mt-0.5 flex items-center gap-2.5 text-[11px] text-muted-foreground tabular-nums">
                        <span className="flex items-center gap-0.5">
                          <Swords className="size-3" />
                          {l.force}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Sparkles className="size-3" />
                          {l.intelligence}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Building2 className="size-3" />
                          {l.cityCount}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="min-h-0 overflow-hidden rounded-lg border bg-card p-2 shadow-[var(--shadow-card)]">
              <ScenarioPreviewMap preview={preview} selectedLordId={lordId} />
            </div>
          </div>
          <footer className="flex justify-between">
            <Button variant="outline" className="gap-1.5" onClick={() => setStep('scenario')}>
              <ArrowLeft className="size-4" />
              返回选剧本
            </Button>
            <Button disabled={lordId === null} onClick={start}>
              开始游戏
            </Button>
          </footer>
        </>
      )}
    </Screen>
  )
}
