import { useEffect, useState, type ReactNode } from 'react'

const isPortrait = (): boolean =>
  typeof window !== 'undefined' && window.innerHeight > window.innerWidth

/**
 * 强制横屏包裹层（`21-main-flow-ui`）：横屏直接渲染 children；竖屏时把整个 app 用 CSS
 * `rotate(90deg)` + 宽高互换旋转成横屏呈现（取代「请旋转」遮罩，因 screen.orientation.lock 在
 * iOS Safari/普通网页不可用）。指针/触控事件随 transform 一并旋转、坐标自洽，无需手动反算。
 */
export function ForceLandscape({ children }: { readonly children: ReactNode }) {
  const [portrait, setPortrait] = useState<boolean>(isPortrait)

  useEffect(() => {
    const onResize = () => setPortrait(isPortrait())
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  if (!portrait) return <>{children}</>

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '100%',
          width: '100vh',
          height: '100vw',
          transformOrigin: '0 0',
          transform: 'rotate(90deg)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
