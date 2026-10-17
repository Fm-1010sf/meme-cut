import { GIFEncoder, quantize, applyPalette } from 'gifenc'

export type EncodePlan = {
  label: string
  colors: number
  keepEvery: number
  scale: number
}

export type EncodeResult = {
  blob: Blob
  bytes: number
  plan: EncodePlan
  frames: number
  fps: number
  width: number
  height: number
  /** 所有帧间隔之和，用来核对导出速度和原片是否一致 */
  durationMs: number
  attempts: number
  overflow: boolean
}

/**
 * 降级阶梯。顺序是按「对观感的伤害从小到大」排的：
 *   先让颜色（几乎看不出来）→ 再让尺寸（还看得清）→ 最后才让帧率（明显变卡）。
 * 噪点这类极端素材会一路走到兜底，那时如实告知而不是假装成功。
 */
const LADDER: EncodePlan[] = [
  { label: '最高画质', colors: 256, keepEvery: 1, scale: 1 },
  { label: '高', colors: 192, keepEvery: 1, scale: 1 },
  { label: '中', colors: 128, keepEvery: 1, scale: 1 },
  { label: '中 · 缩半', colors: 192, keepEvery: 1, scale: 0.5 },
  { label: '中低', colors: 128, keepEvery: 1, scale: 0.5 },
  { label: '低 · 降帧', colors: 128, keepEvery: 2, scale: 0.5 },
  { label: '小', colors: 96, keepEvery: 2, scale: 0.5 },
  { label: '更小', colors: 96, keepEvery: 2, scale: 0.35 },
  { label: '最小', colors: 64, keepEvery: 3, scale: 0.35 },
  { label: '兜底', colors: 32, keepEvery: 3, scale: 0.35 },
]

function subsampleForPalette(frames: ImageData[], maxPixels = 120000): Uint8ClampedArray {
  const total = frames.length * frames[0].data.length
  if (total <= maxPixels * 4) {
    const merged = new Uint8ClampedArray(total)
    let offset = 0
    for (const f of frames) {
      merged.set(f.data, offset)
      offset += f.data.length
    }
    return merged
  }
  const perFrame = Math.max(1, Math.floor(maxPixels / frames.length))
  const src = frames[0].data.length / 4
  const stride = Math.max(1, Math.floor(src / perFrame))
  const sample = new Uint8ClampedArray(perFrame * frames.length * 4)
  let out = 0
  for (const f of frames) {
    for (let p = 0; p < src; p += stride) {
      const i = p * 4
      sample[out++] = f.data[i]
      sample[out++] = f.data[i + 1]
      sample[out++] = f.data[i + 2]
      sample[out++] = 255
    }
  }
  return sample.slice(0, out)
}

/** 用已经抽好的帧做降采样，不用重新解码视频 */
function scaleFrames(frames: ImageData[], w: number, h: number, scale: number) {
  const nw = Math.max(16, Math.round((w * scale) / 2) * 2)
  const nh = Math.max(16, Math.round((h * scale) / 2) * 2)
  if (nw === w && nh === h) return { frames, w, h }

  const src = document.createElement('canvas')
  src.width = w
  src.height = h
  const sctx = src.getContext('2d')!
  const dst = document.createElement('canvas')
  dst.width = nw
  dst.height = nh
  const dctx = dst.getContext('2d', { willReadFrequently: true })!
  dctx.imageSmoothingEnabled = true
  dctx.imageSmoothingQuality = 'high'

  const out = frames.map((f) => {
    sctx.putImageData(f, 0, 0)
    dctx.clearRect(0, 0, nw, nh)
    dctx.drawImage(src, 0, 0, nw, nh)
    return dctx.getImageData(0, 0, nw, nh)
  })
  return { frames: out, w: nw, h: nh }
}

function encodeWithPlan(
  frames: ImageData[],
  width: number,
  height: number,
  frameMs: number,
  plan: EncodePlan,
): { bytes: Uint8Array; totalCs: number } {
  const picked: ImageData[] = []
  for (let i = 0; i < frames.length; i += plan.keepEvery) picked.push(frames[i])
  if (picked.length === 0) picked.push(frames[0])

  // 全局调色板：所有帧共用一个色表，体积比逐帧小很多，表情这个尺度看不出差别
  const palette = quantize(subsampleForPalette(picked), plan.colors, { format: 'rgb565' })

  const gif = GIFEncoder()

  // GIF 的帧间隔只能是整数厘秒（1/100 秒），单帧 83.3ms 这种除不尽的
  // 直接用 8 厘秒会累积成 4% 的误差，所以把余数攒起来，让总时长对得上。
  const stepMs = frameMs * plan.keepEvery
  let carry = 0
  let totalCs = 0

  for (const f of picked) {
    carry += stepMs
    let cs = Math.floor(carry / 10)
    carry -= cs * 10
    // 低于 2 厘秒浏览器会强制按 10 厘秒播，反而变慢，所以兜到 2
    if (cs < 2) cs = 2
    totalCs += cs

    const indexed = applyPalette(f.data, palette, 'rgb565')
    // 注意：gifenc 的 delay 单位是毫秒，它内部再 /10 转厘秒。
    // 之前误传厘秒，被它又除了一次，导致 8.3 倍速。
    gif.writeFrame(indexed, width, height, { palette, delay: cs * 10 })
  }
  gif.finish()
  return { bytes: gif.bytes(), totalCs }
}

export type EncodeOptions = {
  frames: ImageData[]
  width: number
  height: number
  fps: number
  maxBytes: number
  onAttempt?: (index: number, total: number, plan: EncodePlan) => void
  shouldAbort?: () => boolean
}

export function encodeGif(opts: EncodeOptions): EncodeResult {
  const { frames, width, height, fps, maxBytes, onAttempt, shouldAbort } = opts
  const frameMs = 1000 / Math.max(1, fps)

  let best:
    | { bytes: Uint8Array; plan: EncodePlan; w: number; h: number; totalCs: number }
    | null = null
  const cache = new Map<number, { frames: ImageData[]; w: number; h: number }>()

  for (let i = 0; i < LADDER.length; i++) {
    if (shouldAbort?.()) throw new Error('已取消')
    const plan = LADDER[i]
    onAttempt?.(i, LADDER.length, plan)

    let scaled = cache.get(plan.scale)
    if (!scaled) {
      scaled = scaleFrames(frames, width, height, plan.scale)
      cache.set(plan.scale, scaled)
    }

    const encoded = encodeWithPlan(scaled.frames, scaled.w, scaled.h, frameMs, plan)
    if (!best || encoded.bytes.length < best.bytes.length) {
      best = { ...encoded, plan, w: scaled.w, h: scaled.h }
    }
    if (encoded.bytes.length <= maxBytes) break
  }

  // 用最小的那次作结果
  const picked = best!
  const blob = new Blob([new Uint8Array(picked.bytes)], { type: 'image/gif' })
  return {
    blob,
    bytes: blob.size,
    plan: picked.plan,
    frames: Math.ceil(frames.length / picked.plan.keepEvery),
    fps: fps / picked.plan.keepEvery,
    width: picked.w,
    height: picked.h,
    durationMs: picked.totalCs * 10,
    attempts: LADDER.findIndex((p) => p === picked.plan) + 1,
    overflow: blob.size > maxBytes,
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
