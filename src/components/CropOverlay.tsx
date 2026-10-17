import { useCallback, useEffect, useRef, useState } from 'react'
import type { Rect } from '../lib/video'

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

type Props = {
  natW: number
  natH: number
  boxW: number
  boxH: number
  value: Rect
  square: boolean
  onChange: (r: Rect) => void
}

const MIN = 48

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * 裁剪框在「视频原始像素」坐标系里工作，
 * 显示时再按 boxW/natW 缩放，避免来回换算累积误差。
 */
export function CropOverlay({ natW, natH, boxW, boxH, value, square, onChange }: Props) {
  const scale = boxW / natW
  const drag = useRef<{
    mode: Handle
    startX: number
    startY: number
    origin: Rect
  } | null>(null)
  const [active, setActive] = useState<Handle | null>(null)

  const begin = useCallback(
    (mode: Handle) => (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      drag.current = { mode, startX: e.clientX, startY: e.clientY, origin: { ...value } }
      setActive(mode)
    },
    [value],
  )

  useEffect(() => {
    if (!active) return

    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const dx = (e.clientX - d.startX) / scale
      const dy = (e.clientY - d.startY) / scale
      const o = d.origin
      let { x, y, w, h } = o

      if (d.mode === 'move') {
        x = clamp(o.x + dx, 0, natW - o.w)
        y = clamp(o.y + dy, 0, natH - o.h)
        onChange({ x: Math.round(x), y: Math.round(y), w: Math.round(o.w), h: Math.round(o.h) })
        return
      }

      const west = d.mode === 'nw' || d.mode === 'sw'
      const north = d.mode === 'nw' || d.mode === 'ne'

      if (square) {
        // 正方形：把两轴的位移各自换算成「对边长的贡献」，
        // 取贡献更大的那个轴决定边长，四角的方向语义才不会互相打架。
        const base = Math.max(o.w, o.h)
        // 东边往右是放大 西边往右是缩小 竖直方向同理
        const contribution =
          Math.abs(dx) > Math.abs(dy) ? dx * (west ? -1 : 1) : dy * (north ? -1 : 1)
        const size = clamp(base + contribution, MIN, Math.min(natW, natH))

        let nx = west ? o.x + (o.w - size) : o.x
        let ny = north ? o.y + (o.h - size) : o.y
        nx = clamp(nx, 0, natW - size)
        ny = clamp(ny, 0, natH - size)
        onChange({ x: Math.round(nx), y: Math.round(ny), w: Math.round(size), h: Math.round(size) })
        return
      }

      if (west) {
        const nx = clamp(o.x + dx, 0, o.x + o.w - MIN)
        w = o.x + o.w - nx
        x = nx
      } else {
        w = clamp(o.w + dx, MIN, natW - o.x)
      }
      if (north) {
        const ny = clamp(o.y + dy, 0, o.y + o.h - MIN)
        h = o.y + o.h - ny
        y = ny
      } else {
        h = clamp(o.h + dy, MIN, natH - o.y)
      }
      onChange({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })
    }

    const end = () => {
      drag.current = null
      setActive(null)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [active, scale, natW, natH, square, onChange])

  const left = value.x * scale
  const top = value.y * scale
  const w = value.w * scale
  const h = value.h * scale

  const handleCls =
    'absolute h-5 w-5 rounded-full border-[2.5px] border-white bg-accent shadow-[0_1px_5px_rgb(0_0_0/0.35)] transition-transform duration-150'

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ width: boxW, height: boxH }}>
      <div
        className="pointer-events-auto absolute transition-shadow duration-200"
        style={{
          left,
          top,
          width: w,
          height: h,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          cursor: active === 'move' ? 'grabbing' : 'grab',
        }}
        onPointerDown={begin('move')}
      >
        <div className="pointer-events-none absolute inset-0 rounded-[6px] ring-1 ring-white/90" />
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-35">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="border border-white/60" />
          ))}
        </div>

        <div
          className={`${handleCls} pointer-events-auto`}
          style={{ left: -10, top: -10, cursor: 'nwse-resize' }}
          onPointerDown={begin('nw')}
        />
        <div
          className={`${handleCls} pointer-events-auto`}
          style={{ right: -10, top: -10, cursor: 'nesw-resize' }}
          onPointerDown={begin('ne')}
        />
        <div
          className={`${handleCls} pointer-events-auto`}
          style={{ left: -10, bottom: -10, cursor: 'nesw-resize' }}
          onPointerDown={begin('sw')}
        />
        <div
          className={`${handleCls} pointer-events-auto`}
          style={{ right: -10, bottom: -10, cursor: 'nwse-resize' }}
          onPointerDown={begin('se')}
        />
      </div>
    </div>
  )
}
