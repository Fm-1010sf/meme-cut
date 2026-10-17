export type Rect = { x: number; y: number; w: number; h: number }

export type Clip = { start: number; end: number }

export type VideoInfo = {
  url: string
  el: HTMLVideoElement
  duration: number
  width: number
  height: number
}

/** 把 MediaError 翻译成用户能照做的建议，而不是一句「加载失败」 */
function describeMediaError(el: HTMLVideoElement): string {
  const err = el.error
  if (!err) return '浏览器没给出原因'
  switch (err.code) {
    case 1:
      return '读取被中断'
    case 2:
      return '读取文件出错 可能是文件太大或存储有问题'
    case 3:
      return '解码失败 文件可能已经损坏'
    case 4:
      return '这个视频的编码手机浏览器解不了 建议转成 H.264 的 MP4'
    default:
      return `未知错误 ${err.code}`
  }
}

/**
 * 注意：不要再给 video 做「隐形挂载」。
 * iOS Safari 对 1px / opacity 0.01 / 脱离文档的媒体节点经常直接不加载，
 * 而且不报错，只是事件永远不来。
 */

export function disposeVideo(el: HTMLVideoElement) {
  try {
    el.pause()
    el.removeAttribute('src')
    el.load()
  } catch {
    /* 已经脱离了，忽略 */
  }
}

export const LOAD_TIMEOUT_MS = 20000

/** 浏览器压根没开始加载。这个错误单独一类，因为它需要用户点一下才能救。 */
export class NotStartedError extends Error {
  blockedByActivation: boolean
  constructor(blockedByActivation: boolean) {
    super(blockedByActivation ? '需要你点一下才能开始' : '浏览器没有开始加载这个文件')
    this.name = 'NotStartedError'
    this.blockedByActivation = blockedByActivation
  }
}

/** 失败时把浏览器的内部状态摊开，方便远程定位（用户只需截图这句话） */
function diagnose(el: HTMLVideoElement, file: File, mode: string): string {
  const dur = Number.isFinite(el.duration) ? el.duration.toFixed(2) : String(el.duration)
  return [
    `就绪${el.readyState}`,
    `网络${el.networkState}`,
    `画面${el.videoWidth || 0}×${el.videoHeight || 0}`,
    `时长${dur}`,
    `源${el.getAttribute('src') ? '有' : '无'}`,
    `策略${mode}`,
    `文件${(file.size / 1048576).toFixed(1)}MB`,
    file.type || '无类型',
  ].join(' ')
}

export type LoadOptions = {
  /** 容忍「网络状态为 0」多久。用户点按触发的重试可以给得更宽。 */
  graceMs?: number
  /** object 模式用 srcObject = File，绕开 src 属性这条路 */
  mode?: 'src' | 'object'
}

/**
 * 载入视频。元素必须由调用方提供，且必须已经插入文档、参与布局。
 *
 * iOS 上的三道坎都在这儿处理：
 *   1. 元素不参与渲染 → 根本不加载（所以由 React 常驻渲染，不给藏）
 *   2. preload 阶段不建解码器 → 用 play/pause 推一把
 *   3. 没有用户激活时 play() 被拒 → 加载被无限推迟，且不报错
 *      这种情况只能把控制权交回用户，让他点一下（NotStartedError）
 */
export async function loadVideoInto(
  file: File,
  el: HTMLVideoElement,
  opts: LoadOptions = {},
): Promise<Omit<VideoInfo, 'el'>> {
  const { graceMs = 2500, mode = 'src' } = opts

  // 先把上一条彻底清干净，否则残留的 readyState 会骗过下面的轮询
  try {
    el.pause()
  } catch {
    /* ignore */
  }
  el.srcObject = null
  el.removeAttribute('src')
  try {
    el.load()
  } catch {
    /* ignore */
  }

  const url = URL.createObjectURL(file)

  el.muted = true
  el.defaultMuted = true
  el.playsInline = true
  el.setAttribute('playsinline', '')
  el.setAttribute('webkit-playsinline', '')
  el.setAttribute('muted', '')
  el.preload = 'auto'

  let mediaError: string | null = null
  const onError = () => {
    mediaError = describeMediaError(el)
  }
  el.addEventListener('error', onError)

  if (mode === 'object') {
    // 少数 iOS 版本不吃 blob: 的 src，但对 srcObject 放行
    try {
      el.srcObject = file as unknown as MediaProvider
    } catch {
      /* 不支持就退回 src 模式 */
    }
  }
  if (!el.srcObject) {
    el.setAttribute('src', url)
  }
  try {
    el.load()
  } catch {
    /* ignore */
  }

  // 关键信号：play() 被 NotAllowedError 拒绝 = 缺用户激活。
  // 这时再怎么等都不会有进展，必须让用户点一下。
  let blockedByActivation = false
  const nudge = () => {
    const p = el.play()
    if (!p || typeof p.then !== 'function') return
    p.then(() => {
      try {
        el.pause()
      } catch {
        /* ignore */
      }
    }).catch((err: unknown) => {
      const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : ''
      if (name === 'NotAllowedError') blockedByActivation = true
    })
  }
  nudge()

  const started = performance.now()
  let nudged = 1

  try {
    for (;;) {
      if (mediaError) throw new Error(mediaError)

      const ready =
        el.readyState >= 1 &&
        el.videoWidth > 0 &&
        Number.isFinite(el.duration) &&
        el.duration > 0
      if (ready) break

      const elapsed = performance.now() - started

      // 网络状态一直是 0 ＝ 浏览器从没发起过请求。
      // 这时候干等 20 秒没有意义，早点把控制权交给用户。
      if (elapsed > graceMs && el.networkState === 0) {
        throw new NotStartedError(blockedByActivation)
      }

      if (elapsed > 3000 && nudged === 1) {
        nudged = 2
        nudge()
      }
      if (elapsed > 8000 && nudged === 2) {
        nudged = 3
        try {
          el.load()
        } catch {
          /* ignore */
        }
        nudge()
      }
      if (elapsed > LOAD_TIMEOUT_MS) {
        throw new Error(`加载超时 ${diagnose(el, file, mode)}`)
      }
      await new Promise((r) => setTimeout(r, 150))
    }

    // 等第一帧真正解出来再返回，否则预览区会是一片空白
    const frameDeadline = performance.now() + 3000
    while (el.readyState < 2 && performance.now() < frameDeadline) {
      await new Promise((r) => setTimeout(r, 100))
    }

    await seekTo(el, Math.min(0.04, el.duration / 2))

    return {
      url,
      duration: el.duration,
      width: el.videoWidth,
      height: el.videoHeight,
    }
  } catch (e) {
    el.removeEventListener('error', onError)
    disposeVideo(el)
    URL.revokeObjectURL(url)
    throw e
  } finally {
    el.removeEventListener('error', onError)
  }
}

/**
 * 精确 seek。iOS Safari 上 seek 结束后偶发还没渲染出新帧，
 * 所以额外等一次 rAF，并保留超时兜底避免永久挂起。
 */
export function seekTo(el: HTMLVideoElement, t: number): Promise<void> {
  const target = Math.max(0, Math.min(t, Math.max(0, (el.duration || 0) - 0.001)))

  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      el.removeEventListener('seeked', finish)
      clearTimeout(timer)
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }
    const timer = setTimeout(finish, 1500)
    el.addEventListener('seeked', finish, { once: true })
    try {
      el.currentTime = target
    } catch {
      finish()
    }
  })
}

export function drawFrame(
  el: HTMLVideoElement,
  rect: Rect,
  outW: number,
  outH: number,
): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('浏览器拿不到 canvas 2d')

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, outW, outH)
  ctx.drawImage(
    el,
    Math.round(rect.x),
    Math.round(rect.y),
    Math.max(1, Math.round(rect.w)),
    Math.max(1, Math.round(rect.h)),
    0,
    0,
    outW,
    outH,
  )
  return ctx.getImageData(0, 0, outW, outH)
}

export type ExtractOptions = {
  el: HTMLVideoElement
  start: number
  end: number
  fps: number
  rect: Rect
  outW: number
  outH: number
  onProgress?: (ratio: number) => void
  shouldAbort?: () => boolean
}

export type ExtractResult = {
  frames: ImageData[]
  fps: number
  width: number
  height: number
}

/** 按帧率从视频窗口里抽帧。全部完成后返回，进度通过回调上报。 */
export async function extractFrames(opts: ExtractOptions): Promise<ExtractResult> {
  const { el, start, end, fps, rect, outW, outH, onProgress, shouldAbort } = opts
  const span = Math.max(0.04, end - start)
  const count = Math.max(1, Math.min(180, Math.round(span * fps)))
  const step = span / count
  const frames: ImageData[] = []

  for (let i = 0; i < count; i++) {
    if (shouldAbort?.()) throw new Error('已取消')
    const t = start + i * step
    await seekTo(el, t)
    frames.push(drawFrame(el, rect, outW, outH))
    onProgress?.((i + 1) / count)
    // 让出主线程，否则进度条不动、手机也会觉得卡死
    if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0))
  }

  return { frames, fps: count / span, width: outW, height: outH }
}
