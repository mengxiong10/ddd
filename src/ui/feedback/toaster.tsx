import { useEffect, useRef } from 'react'
import { Toaster as SonnerToaster, toast } from 'sonner'
import { useGameStore } from '../../store/game-store'
import { feedbackText } from './messages'

/** toast 默认存活时长（ms）；到时或被点击即出队、自动推下一条。 */
const TOAST_TTL_MS = 3500

/**
 * Sonner 宿主 + 串行单条驱动（`21-main-flow-ui`）：把 store.feedback 当严格队列，一次只显队首一条。
 * 队首 feedbackText 为 null（非玩家相关事件）即时 dismiss 跳过、不占显示；否则 toast 队首，
 * 点击或超时回调 store.dismiss(id) → 队首前移 → effect 自动推下一条。月末多条事件由此逐条出现。
 */
export function Toaster() {
  const feedback = useGameStore((s) => s.feedback)
  const game = useGameStore((s) => s.game)
  const dismiss = useGameStore((s) => s.dismiss)
  const showingId = useRef<number | null>(null)

  useEffect(() => {
    const head = feedback[0]
    if (!head) {
      showingId.current = null
      return
    }
    if (showingId.current === head.id) return // 队首已在展示，等其消失
    if (!game) {
      dismiss(head.id)
      return
    }
    const text = feedbackText(head, game)
    if (text === null) {
      dismiss(head.id) // 非玩家相关事件：即时跳过、不占显示
      return
    }
    showingId.current = head.id
    const failed = head.payload.kind === 'failure'
    const close = () => dismiss(head.id)
    toast.custom(
      () => (
        <div
          role="status"
          onClick={() => toast.dismiss(head.id)}
          className={`pointer-events-auto min-w-[16rem] max-w-[80vw] cursor-pointer rounded-md border px-4 py-2.5 text-sm shadow-lg ${
            failed
              ? 'border-destructive/40 bg-destructive text-destructive-foreground'
              : 'border-border bg-card text-card-foreground'
          }`}
        >
          {text}
        </div>
      ),
      { id: head.id, duration: TOAST_TTL_MS, onAutoClose: close, onDismiss: close }
    )
  }, [feedback, game, dismiss])

  return <SonnerToaster position="top-center" gap={8} visibleToasts={1} />
}
