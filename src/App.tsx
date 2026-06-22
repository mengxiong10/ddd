import { useState } from 'react'
import { useGameStore } from './store/game-store'
import { GameScreen } from './ui/app-shell'
import { ToastHost } from './ui/feedback/toast'
import { NewGameScreen } from './ui/new-game'
import { PauseDialogs } from './ui/pause-dialogs'

export function App() {
  const game = useGameStore((state) => state.game)
  const [choosing, setChoosing] = useState(false)

  if (!game) {
    return (
      <main className="app">
        <NewGameScreen canCancel={false} onCancel={() => undefined} />
      </main>
    )
  }

  return (
    <main className="app">
      <GameScreen onNewGame={() => setChoosing(true)} />
      <PauseDialogs />
      <ToastHost />
      {choosing && <NewGameScreen canCancel onCancel={() => setChoosing(false)} />}
    </main>
  )
}
