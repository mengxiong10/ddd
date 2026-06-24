import { useState, type ReactNode } from 'react'
import { useGameStore } from './store/game-store'
import { ForceLandscape } from './ui/layout/force-landscape'
import { Toaster } from './ui/feedback/toaster'
import { NewGameScreen } from './ui/screens/new-game-screen'
import { WorldScreen } from './ui/screens/world-screen'
import { BattleScreen } from './ui/battle/battle-screen'

/**
 * 组合根（`21-main-flow-ui`）：按 store 状态派生当前屏——无 game→开局向导、activeBattle→战斗屏、
 * 否则→大地图屏。ForceLandscape 包裹当前屏 + 全局 Toaster；暂停态/战果 dialog 由对应屏自带。
 */
export function App() {
  const game = useGameStore((s) => s.game)
  const [choosingNew, setChoosingNew] = useState(false)

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
    if (choosingNew)
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
    if (game.activeBattle) return { key: 'battle', node: <BattleScreen /> }
    return { key: 'world', node: <WorldScreen onNewGame={() => setChoosingNew(true)} /> }
  }

  const { key, node } = screen()

  return (
    <ForceLandscape>
      <div className="h-full w-full">
        <div key={key} className="animate-screen h-full w-full">
          {node}
        </div>
        <Toaster />
      </div>
    </ForceLandscape>
  )
}
