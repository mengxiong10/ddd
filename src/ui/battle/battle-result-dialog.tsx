import { useEffect } from 'react'
import { useGameStore } from '../../store/game-store'
import type { BattleOutcome } from '../../store/selectors'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Button } from '../components/ui/button'

const RESULT_TTL_MS = 4000

/**
 * 战果 dialog（`21-main-flow-ui`）：outcome 非空时弹出；点击或超时 → dispatch(resumeMonth) 让 core
 * 收尾并续跑月末（可能再次进入战斗/选君，屏幕自动重新派生）。由 BattleScreen 自挂。
 */
export function BattleResultDialog({ outcome }: { readonly outcome: BattleOutcome }) {
  const dispatch = useGameStore((s) => s.dispatch)
  const resume = () => dispatch({ type: 'resumeMonth' })

  useEffect(() => {
    const t = setTimeout(resume, RESULT_TTL_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const win = outcome === 'playerWin'
  return (
    <Dialog open>
      <DialogContent showClose={false} className="w-[min(90vw,20rem)] text-center">
        <DialogHeader>
          <DialogTitle className="text-center text-2xl">
            {win ? '我军大胜！' : '战败……'}
          </DialogTitle>
        </DialogHeader>
        <Button onClick={resume}>继续</Button>
      </DialogContent>
    </Dialog>
  )
}
