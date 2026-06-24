import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 非模态右侧抽屉（命令收集向导用）：基于 radix dialog 但 modal=false 且不渲染遮罩，
 * 故背景（大地图）仍可点选/滚动——「选目标城」步骤照旧在地图上点。靠右、全高、右滑入。
 * 关闭仅经 X / Esc / 外部受控（onOpenChange），点地图不应关闭（由 onInteractOutside 阻断）。
 */
export function Sheet({
  open,
  onOpenChange,
  children,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {children}
    </DialogPrimitive.Root>
  )
}

export function SheetContent({
  className,
  children,
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { readonly showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Content
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        className={cn(
          'animate-sheet-right fixed inset-y-0 right-0 z-50 flex h-full w-[min(92vw,24rem)] flex-col gap-3 overflow-y-auto border-l bg-card p-4 shadow-[var(--shadow-float)]',
          className
        )}
        style={{ paddingRight: 'max(1rem, env(safe-area-inset-right))' }}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close className="absolute right-3 top-3 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none">
            <X className="h-4 w-4" />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export const SheetTitle = DialogPrimitive.Title
export const SheetClose = DialogPrimitive.Close
