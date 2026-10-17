import { useCallback, useEffect, useRef, useState } from 'react'
import type { Clip } from '../lib/video'

type Props = {
  duration: number
  clip: Clip
  current: number
  minSpan?: number
  onClip: (c: Clip) => void
  onSeek: (t: number) => void
}

function fmt(t: number) {
  const s = Math.max(0, t)
  return `${s.toFixed(2)}s`
}

export function Timeline({ duration, clip, current, minSpan = 0.15, onClip, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'start' | 'end' | 'play' | null>(null)

  const timeAt = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el) return 0
      const r = el.getBoundingClientRect()
      const ratio = (clientX - r.left) / r.width
      return Math.max(0, Math.min(duration, ratio * duration))
    },
    [duration],
  )

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const t = timeAt(e.clientX)
      if (dragging === 'play') {
        onSeek(t)
        return
      }
      if (dragging === 'start') {
        onClip({ start: Math.min(t, clip.end - minSpan), end: clip.end })
      } else {
        onClip({ start: clip.start, end: Math.max(t, clip.start + minSpan) })
      }
    }
    const end = () => setDragging(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging, timeAt, clip, minSpan, onClip, onSeek])

  const pct = (t: number) => `${Math.max(0, Math.min(1, t / duration)) * 100}%`

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-[12px] tabular-nums text-muted">
        <span>
          {fmt(clip.start)} → {fmt(clip.end)}
        </span>
        <span>
          片段 {(clip.end - clip.start).toFixed(2)}s · 全长 {duration.toFixed(2)}s
        </span>
      </div>

      <div
        ref={trackRef}
        className="relative h-11 touch-none select-none rounded-[10px] bg-black/[0.05]"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset.handle) return
          const t = timeAt(e.clientX)
          onSeek(t)
          setDragging('play')
        }}
      >
        {/* 选中区间 */}
        <div
          className="pointer-events-none absolute inset-y-0 rounded-[8px] bg-accent/[0.13] ring-1 ring-inset ring-accent/35"
          style={{ left: pct(clip.start), width: `calc(${pct(clip.end)} - ${pct(clip.start)})` }}
        />

        {/* 播放头 */}
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-ink"
          style={{ left: pct(current) }}
        />

        {/* 起止手柄 */}
        {(['start', 'end'] as const).map((which) => (
          <div
            key={which}
            data-handle={which}
            onPointerDown={(e) => {
              e.stopPropagation()
              ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
              setDragging(which)
            }}
            className="absolute inset-y-0 z-10 -ml-[9px] w-[18px] cursor-ew-resize touch-none rounded-[6px] bg-white shadow-[0_1px_4px_rgb(0_0_0/0.22)] ring-1 ring-ink/15 transition-transform duration-150 hover:scale-y-105"
            style={{ left: pct(which === 'start' ? clip.start : clip.end) }}
          >
            <div className="mx-auto mt-2 h-5 w-[2px] rounded-full bg-ink/35" />
          </div>
        ))}
      </div>
    </div>
  )
}
