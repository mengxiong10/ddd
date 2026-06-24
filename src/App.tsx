import { useState, type ReactNode } from 'react'
import { useGameStore } from './store/game-store'
import { ForceLandscape } from './ui/layout/force-landscape'
import { Toaster } from './ui/feedback/toaster'
import { NewGameScreen } from './ui/screens/new-game-screen'
import { WorldScreen } from './ui/screens/world-screen'
import { BattleScreen } from './ui/battle/battle-screen'
import { BattleIntroDialog } from './ui/battle/battle-intro-dialog'

/**
 * 组合根（`21-main-flow-ui`）：按 store 状态派生当前屏——无 game→开局向导、activeBattle→战斗屏、
 * 否则→大地图屏。ForceLandscape 包裹当前屏 + 全局 Toaster；暂停态/战果 dialog 由对应屏自带。
 *
 * 战斗入场闸门：activeBattle 就位后并不立刻切到战斗屏，而是先把大地图当作背景、暂停推进——
 * 让月末非战斗 toast 逐条排空（暂停态），排空后弹「入场提示」报出对阵，点击/超时才进入战斗屏，
 * 避免战场地图无过渡突现。enteredSig 记录已入场的战斗签名（含年月），与当前战斗签名不符即重新提示。
 */
export function App() {
  const game = useGameStore((s) => s.game)
  const feedback = useGameStore((s) => s.feedback)
  const dismiss = useGameStore((s) => s.dismiss)
  const [choosingNew, setChoosingNew] = useState(false)
  const [enteredSig, setEnteredSig] = useState<string | null>(null)

  const battle = game?.activeBattle ?? null
  // 战斗签名（目标城+攻方主将+年月）整场不变，可区分同月连续的不同战斗与跨月再战；无须离场重置。
  const battleSig =
    battle && game
      ? `${battle.targetCityId}:${battle.attackerCommanderId}:${game.year}:${game.month}`
      : null
  const feedbackPending = feedback.length > 0
  const needIntro = battle !== null && enteredSig !== battleSig
  // 闸门期：战斗已排队，但非战斗 toast 未排空 / 入场提示未确认——仍停留在大地图背景。
  const inBattleGate = battle !== null && (feedbackPending || needIntro)

  const dismissHead = () => {
    const head = feedback[0]
    if (head) dismiss(head.id)
  }

  const screen = (): { key: string; node: ReactNode } => {
    if (!game)
      return {
        key: 'new-game',
        node: (
          <NewGameScreen
            onStarted={() => setChoosingNew(false)}
            canCancel={false}
            onCancel={() => undefined}
          />
        ),
      }
    if (choosingNew && !battle)
      return {
        key: 'new-game',
        node: (
          <NewGameScreen
            onStarted={() => setChoosingNew(false)}
            canCancel
            onCancel={() => setChoosingNew(false)}
          />
        ),
      }
    if (battle && !inBattleGate) return { key: 'battle', node: <BattleScreen /> }
    return { key: 'world', node: <WorldScreen onNewGame={() => setChoosingNew(true)} /> }
  }

  const { key, node } = screen()

  return (
    <ForceLandscape>
      <div className="h-full w-full">
        <div key={key} className="animate-screen h-full w-full">
          {node}
        </div>
        {/* 闸门排空期：透明遮罩暂停大地图交互，点击任意处推进（消费）下一条 toast。 */}
        {battle && feedbackPending && (
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation()
              dismissHead()
            }}
          />
        )}
        {battle && !feedbackPending && needIntro && battleSig !== null && (
          <BattleIntroDialog onEnter={() => setEnteredSig(battleSig)} />
        )}
        <Toaster />
      </div>
    </ForceLandscape>
  )
}
