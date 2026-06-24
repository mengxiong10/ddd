import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 统一屏壳（`21-main-flow-ui` 打磨）：竖向 flex 占满高度 + 左右安全区内边距（刘海/灵动岛）。
 * 移动端横屏基准画布 ~820×390；四屏（开局/大地图/战斗/暂停）一律包在 Screen 内，保证一致。
 */
export function Screen({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <div
      className="h-full min-h-0"
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div className={cn('flex h-full min-h-0 flex-col', className)}>{children}</div>
    </div>
  )
}
