import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 分组面板（`21-main-flow-ui` 打磨）：可选标题条（朱砂竖纹 + 标题）+ 内容区。
 * 经营面板/暂停态/概览统一用它分组，建立视觉层级、替代裸 div 堆叠。
 */
export function Panel({
  title,
  trailing,
  children,
  className,
}: {
  readonly title?: ReactNode
  readonly trailing?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <section className={cn('rounded-md border bg-card shadow-[var(--shadow-card)]', className)}>
      {title !== undefined && (
        <div className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-soft">
            <span className="h-3 w-1 rounded-full bg-vermilion" aria-hidden />
            {title}
          </h3>
          {trailing}
        </div>
      )}
      <div className="p-2.5">{children}</div>
    </section>
  )
}
