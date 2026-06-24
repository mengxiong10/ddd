import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 数据行（`21-main-flow-ui` 打磨）：图标 + 标签 + 值（右对齐、等宽数字），可选占比进度条。
 * 取代经营面板裸 `农业 50/100` 文字堆叠，统一扫读层级与图标语言。
 */
export function StatRow({
  icon,
  label,
  value,
  ratio,
  barClassName,
  className,
}: {
  readonly icon?: ReactNode
  readonly label: ReactNode
  readonly value: ReactNode
  /** 0..1，给出则在行下渲染细进度条。 */
  readonly ratio?: number
  readonly barClassName?: string
  readonly className?: string
}) {
  const pct = ratio === undefined ? null : Math.max(0, Math.min(1, ratio)) * 100
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-1.5 text-xs">
        {icon && <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
        <span className="text-muted-foreground">{label}</span>
        <span className="ml-auto whitespace-nowrap font-medium tabular-nums text-foreground">
          {value}
        </span>
      </div>
      {pct !== null && (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full bg-bamboo', barClassName)}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}
