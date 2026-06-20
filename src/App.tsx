import { GameScreen } from './ui/app-shell'
import { ToastHost } from './ui/feedback/toast'
import { PauseDialogs } from './ui/pause-dialogs'

export function App() {
  return (
    <main className="app">
      <GameScreen />
      <PauseDialogs />
      <ToastHost />
    </main>
  )
}
