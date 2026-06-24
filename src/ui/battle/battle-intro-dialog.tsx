import { useEffect } from 'react'
import { Swords } from 'lucide-react'
import { useCurrentGame } from '../../store/game-store'

/** 入场提示存活时长（ms）：到时或点击任意处即进入战场。 */
const INTRO_TTL_MS = 2600

/**
 * 战前入场提示（暂停过渡）：activeBattle 已就位、月末非战斗 toast 已排空后弹出，
 * 报出对阵——我方出征显示「我军进攻<城>」，敌方来犯显示「<敌君>进攻<城>」。
 * 点击任意处或超时 → onEnter（进入战斗屏），避免无过渡直接出现地图。
 */
export function BattleIntroDialog({ onEnter }: { readonly onEnter: () => void }) {
  const game = useCurrentGame()
  const battle = game.activeBattle

  useEffect(() => {
    const t = setTimeout(onEnter, INTRO_TTL_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!battle) return null
  const isPlayerAttack = battle.mode === 'attack'
  const attackerLordId = game.officers[battle.attackerCommanderId]?.lordId ?? null
  const attackerName = isPlayerAttack
    ? '我军'
    : attackerLordId !== null
      ? (game.officers[attackerLordId]?.name ?? '敌军')
      : '敌军'
  const cityName = game.cities[battle.targetCityId]?.name ?? String(battle.targetCityId)
  const attackerCommander = game.officers[battle.attackerCommanderId]?.name
  const defenderCommander = game.officers[battle.defenderCommanderId]?.name

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEnter}
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/70 animate-in fade-in"
    >
      <div className="flex w-[min(90vw,24rem)] flex-col items-center gap-3 rounded-lg border bg-card px-6 py-7 text-center shadow-[var(--shadow-float)]">
        <Swords className="size-9 text-destructive" />
        <h2 className="font-display text-2xl font-semibold">
          {attackerName}进攻{cityName}
        </h2>
        <p className="text-sm text-muted-foreground tabular-nums">
          {attackerCommander ?? '—'} <span className="text-destructive">⚔</span>{' '}
          {defenderCommander ?? '—'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">点击任意处进入战场</p>
      </div>
    </div>
  )
}
