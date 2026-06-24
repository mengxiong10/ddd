import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 统一顶栏（`21-main-flow-ui` 打磨）：卡片底 + 下边框 + 顶部安全区内边距。左侧 children 为标题/信息，
 * 右侧 actions 为按钮区。大地图/战斗屏共用，避免各自手搓 header 不一致。
 */
export function TopBar({
  children,
  actions,
  className,
}: {
  readonly children: ReactNode
  readonly actions?: ReactNode
  readonly className?: string
}) {
  return (
    <header
      className={cn(
        'flex shrink-0 items-center gap-3 border-b bg-card px-3 py-2 shadow-[var(--shadow-card)]',
        className
      )}
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
