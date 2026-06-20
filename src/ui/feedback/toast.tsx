import { useEffect } from 'react'
import { useGameStore } from '../../store/game-store'
import type { FeedbackItem } from '../../store/game-store'
import type { GameState } from '../../store/selectors'
import { feedbackText } from './messages'

const TOAST_TTL_MS = 3500

/** 单条 toast：挂载即排定出队；文案为 null（非玩家相关事件）则即时出队、不渲染。 */
function ToastView({
  item,
  game,
  dismiss,
}: {
  item: FeedbackItem
  game: GameState
  dismiss: (id: number) => void
}) {
  const text = feedbackText(item, game)
  const failed = item.payload.kind === 'failure'

  useEffect(() => {
    if (text === null) {
      dismiss(item.id)
      return
    }
    const t = setTimeout(() => dismiss(item.id), TOAST_TTL_MS)
    return () => clearTimeout(t)
    // 仅挂载时排程；text/dismiss 在生命周期内稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (text === null) return null
  return (
    <div className={`toast ${failed ? 'toast-fail' : 'toast-ok'}`} onClick={() => dismiss(item.id)}>
      {text}
    </div>
  )
}

/** 反馈队列渲染区：订阅 store.feedback，逐条渲染 + 自动出队。 */
export function ToastHost() {
  const feedback = useGameStore((s) => s.feedback)
  const game = useGameStore((s) => s.game)
  const dismiss = useGameStore((s) => s.dismiss)
  return (
    <div className="toast-host">
      {feedback.map((item) => (
        <ToastView key={item.id} item={item} game={game} dismiss={dismiss} />
      ))}
    </div>
  )
}
