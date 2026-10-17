import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertCircle,
  ArrowLeft,
  Crop,
  Download,
  Gauge,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  Smartphone,
  Upload,
} from 'lucide-react'
import { CropOverlay } from './components/CropOverlay'
import { Timeline } from './components/Timeline'
import { Button, Field, IconButton, Progress, Segmented, cx } from './components/ui'
import {
  disposeVideo,
  extractFrames,
  loadVideoInto,
  NotStartedError,
  seekTo,
  type Clip,
  type Rect,
  type VideoInfo,
} from './lib/video'
import { encodeGif, formatBytes, type EncodeResult } from './lib/gif'

type Stage = 'import' | 'edit' | 'result'

const SPRING = { type: 'spring', stiffness: 300, damping: 30 } as const

const fadeUp = {
  hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)' },
  out: { opacity: 0, y: -8, filter: 'blur(4px)' },
}

const listIn = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
  out: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
}

export default function App() {
  const [stage, setStage] = useState<Stage>('import')
  const [video, setVideo] = useState<VideoInfo | null>(null)
  const [clip, setClip] = useState<Clip>({ start: 0, end: 1 })
  const [current, setCurrent] = useState(0)
  const [crop, setCrop] = useState<Rect | null>(null)
  const [square, setSquare] = useState(true)
  const [edge, setEdge] = useState('200')
  const [fps, setFps] = useState('12')
  const [budget, setBudget] = useState('1000')

  const [busy, setBusy] = useState<null | { phase: 'extract' | 'encode'; progress: number; note: string }>(null)
  const [result, setResult] = useState<(EncodeResult & { overflow: boolean }) | null>(null)
  const [gifUrl, setGifUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  /** iOS 需要用户点一下才肯开始加载时，把这个文件挂在这里等点击 */
  const [pending, setPending] = useState<{ file: File; label: string } | null>(null)
  const pendingRef = useRef<File | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const abortRef = useRef(false)
  const [box, setBox] = useState({ w: 0, h: 0 })

  /* ---------- 预览区尺寸测量 ---------- */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [stage])

  /* ---------- 视频元素 ----------
     这个 <video> 由 React 常驻渲染在预览区里，不再手工 appendChild。
     iOS 只在媒体元素真正参与布局和渲染时才加载，所以它必须一直在。 */

  /* ---------- 播放片段 ---------- */
  useEffect(() => {
    const el = video?.el
    if (!el || !playing) return
    void seekTo(el, clip.start).then(() => {
      void el.play().catch(() => setPlaying(false))
    })
    const onTime = () => {
      setCurrent(el.currentTime)
      if (el.currentTime >= clip.end - 0.01) {
        el.currentTime = clip.start
      }
    }
    el.addEventListener('timeupdate', onTime)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.pause()
    }
  }, [playing, video, clip.start, clip.end])

  /* ---------- 载入文件 ----------
     分两种触发：选完文件自动试一次；如果浏览器不给加载（iOS 缺用户激活），
     就把文件挂起来等用户点一下，那一下会带来激活。 */
  const attemptLoad = useCallback(
    async (file: File, fromTap: boolean) => {
      setError(null)
      setResult(null)
      setGifUrl(null)
      setPlaying(false)
      setPending(null)

      if (file.size > 400 * 1024 * 1024) {
        setError(`${(file.size / 1024 / 1024).toFixed(0)}MB 太大了 先把录屏剪短再试`)
        return
      }

      const el = videoRef.current
      if (!el) {
        setError('预览区还没准备好 请再点一次')
        return
      }

      setLoading(fromTap ? '正在开始' : '正在读取视频')

      if (video) {
        URL.revokeObjectURL(video.url)
        setVideo(null)
      }

      try {
        const info = await loadVideoInto(
          file,
          el,
          fromTap ? { graceMs: 8000, mode: 'object' } : { graceMs: 2500 },
        )
        const span = Math.min(info.duration, 2.5)
        const base = Math.min(info.width, info.height)
        const side = Math.round(base * 0.82)
        setClip({ start: 0, end: Math.max(0.2, span) })
        setCrop({
          x: Math.round((info.width - side) / 2),
          y: Math.round((info.height - side) / 2),
          w: side,
          h: side,
        })
        setCurrent(0)
        setVideo({ ...info, el })
        setStage('edit')
        pendingRef.current = null
      } catch (e) {
        const label = `${file.name} · ${(file.size / 1048576).toFixed(1)}MB`
        pendingRef.current = file
        if (e instanceof NotStartedError) {
          // 不是坏了，是浏览器不肯开始——交给用户点一下
          setPending({ file, label })
        } else {
          setError(`${file.name}：${e instanceof Error ? e.message : '载入失败'}`)
          setPending({ file, label })
        }
      } finally {
        setLoading(null)
      }
    },
    [video],
  )

  const onFile = useCallback(
    (file: File) => {
      pendingRef.current = file
      void attemptLoad(file, false)
    },
    [attemptLoad],
  )

  const startFromTap = useCallback(() => {
    const f = pendingRef.current
    if (f) void attemptLoad(f, true)
  }, [attemptLoad])

  /* ---------- 生成 ---------- */
  const generate = useCallback(async () => {
    if (!video || !crop) return
    abortRef.current = false
    setError(null)
    setPlaying(false)
    const outEdge = Number(edge)
    const outFps = Number(fps)
    const maxBytes = Number(budget) * 1024

    const scale = Math.min(1, outEdge / Math.max(crop.w, crop.h))
    const outW = Math.max(16, Math.round((crop.w * scale) / 2) * 2)
    const outH = Math.max(16, Math.round((crop.h * scale) / 2) * 2)

    try {
      setBusy({ phase: 'extract', progress: 0, note: '正在逐帧取画面' })
      video.el.pause()
      const extracted = await extractFrames({
        el: video.el,
        start: clip.start,
        end: clip.end,
        fps: outFps,
        rect: crop,
        outW,
        outH,
        onProgress: (p) =>
          setBusy({ phase: 'extract', progress: p, note: `正在逐帧取画面 ${Math.round(p * 100)}%` }),
        shouldAbort: () => abortRef.current,
      })

      setBusy({ phase: 'encode', progress: 0, note: '正在压成 GIF' })
      await new Promise((r) => setTimeout(r, 16))

      const encoded = encodeGif({
        frames: extracted.frames,
        width: outW,
        height: outH,
        fps: extracted.fps,
        maxBytes,
        onAttempt: (i, total, plan) =>
          setBusy({
            phase: 'encode',
            progress: i / total,
            note: `正在压成 GIF · ${plan.label}`,
          }),
        shouldAbort: () => abortRef.current,
      })

      if (gifUrl) URL.revokeObjectURL(gifUrl)
      setGifUrl(URL.createObjectURL(encoded.blob))
      setResult(encoded)
      setStage('result')
    } catch (e) {
      if (!abortRef.current) setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setBusy(null)
    }
  }, [video, crop, clip, edge, fps, budget, gifUrl])

  const reset = useCallback(() => {
    abortRef.current = true
    setBusy(null)
    setPlaying(false)
    setStage(video ? 'edit' : 'import')
  }, [video])

  const restart = useCallback(() => {
    setPlaying(false)
    setStage('import')
    setResult(null)
    if (gifUrl) URL.revokeObjectURL(gifUrl)
    setGifUrl(null)
  }, [gifUrl])

  /* ---------- 预览尺寸（contain 适配） ---------- */
  const fit = useMemo(() => {
    if (!video || box.w === 0 || box.h === 0) return { w: 0, h: 0, x: 0, y: 0 }
    const s = Math.min(box.w / video.width, box.h / video.height)
    const w = video.width * s
    const h = video.height * s
    return { w, h, x: (box.w - w) / 2, y: (box.h - h) / 2 }
  }, [video, box])

  const canGenerate = Boolean(video && crop && !busy)

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[320px] grid-veil" />

      <div className="relative mx-auto w-full max-w-[720px] px-5 pb-28 pt-9">
        {/* 标题 */}
        <motion.header
          initial="hidden"
          animate="show"
          variants={listIn}
          className="mb-7 flex items-start justify-between gap-4"
        >
          <motion.div variants={fadeUp} transition={SPRING}>
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">
              录屏变表情
            </h1>
            <p className="mt-1.5 max-w-[38ch] text-[13.5px] leading-relaxed text-ink-soft">
              截一段录屏 框出表情 直接得到微信能收的 GIF
            </p>
          </motion.div>
          <motion.div variants={fadeUp} transition={SPRING} className="mt-1 shrink-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-[11.5px] font-medium text-ink-soft">
              <Smartphone size={12} strokeWidth={2.2} />
              全程本地
            </span>
          </motion.div>
        </motion.header>

        {/* 主卡：跨阶段共享，用 layout 做形变衔接 */}
        <motion.section
          layout
          transition={{ layout: SPRING }}
          className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_36px_-12px_rgb(0_0_0/0.10)]"
        >
          <motion.div
            ref={stageRef}
            layout
            transition={{ layout: SPRING }}
            className="relative flex items-center justify-center bg-[#f2f2f4]"
            style={{ height: stage === 'import' ? 236 : 'clamp(280px, 44vh, 470px)' }}
          >
            {/* 常驻的 video 节点。iOS 只在媒体元素真正参与布局时才建解码器，
                所以它不能按阶段条件渲染，也不能被藏起来。 */}
            <video
              ref={videoRef}
              playsInline
              muted
              preload="metadata"
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              style={{ opacity: stage === 'result' ? 0 : 1 }}
            />

            <AnimatePresence mode="wait" initial={false}>
              {stage === 'import' && (
                <motion.div
                  key="drop"
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.02, filter: 'blur(6px)' }}
                  transition={SPRING}
                  className="absolute inset-0 p-3"
                >
                  <Dropzone onFile={onFile} />
                </motion.div>
              )}

              {stage === 'edit' && video && (
                <motion.div
                  key="canvas"
                  initial={{ opacity: 0, scale: 1.01 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.99 }}
                  transition={SPRING}
                  className="absolute inset-0"
                >
                  {crop && (
                    <div className="absolute" style={{ left: fit.x, top: fit.y }}>
                      <CropOverlay
                        natW={video.width}
                        natH={video.height}
                        boxW={fit.w}
                        boxH={fit.h}
                        value={crop}
                        square={square}
                        onChange={setCrop}
                      />
                    </div>
                  )}
                </motion.div>
              )}

              {stage === 'result' && gifUrl && result && (
                <motion.div
                  key="out"
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.03 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  className="absolute inset-0 grid place-items-center p-4"
                >
                  <div className="relative flex h-full w-full max-w-[300px] flex-col overflow-hidden rounded-[22px] bg-[#ededed]">
                    <div className="flex items-center justify-center border-b border-black/[0.06] py-2 text-[11.5px] text-muted">
                      微信聊天
                    </div>
                    <div className="flex flex-1 items-center justify-center p-4">
                      <motion.img
                        src={gifUrl}
                        alt="生成的表情"
                        className="max-h-full max-w-full rounded-[6px]"
                        style={{ width: Math.min(result.width, 200), height: 'auto' }}
                        initial={{ rotate: -1.5, opacity: 0 }}
                        animate={{ rotate: 0, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 播放控制 */}
            {stage === 'edit' && video && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="absolute bottom-3 left-3"
              >
                <IconButton
                  label={playing ? '暂停' : '播放片段'}
                  onClick={() => setPlaying((p) => !p)}
                  className="h-10 w-10 backdrop-blur"
                >
                  {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                </IconButton>
              </motion.div>
            )}

            {/* 处理中 / 读取中 */}
            <AnimatePresence>
              {(busy || loading) && (
                <motion.div
                  key="overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-20 grid place-items-center bg-white/82 backdrop-blur-sm"
                >
                  <motion.div
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -6, opacity: 0 }}
                    transition={SPRING}
                    className="w-[76%] max-w-[280px] rounded-2xl border border-line bg-white p-5 shadow-lg"
                  >
                    <div className="mb-3 flex items-center gap-2 text-[13px] font-medium">
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
                        className="inline-flex"
                      >
                        <Loader2 size={14} />
                      </motion.span>
                      {busy?.note ?? loading}
                    </div>
                    {busy ? (
                      <Progress value={busy.progress} />
                    ) : (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                        <motion.div
                          className="h-full w-1/3 rounded-full bg-ink"
                          animate={{ x: ['-100%', '300%'] }}
                          transition={{ repeat: Infinity, duration: 1.15, ease: 'easeInOut' }}
                        />
                      </div>
                    )}
                    {busy && (
                      <button
                        type="button"
                        onClick={reset}
                        className="mt-3 text-[12px] text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
                      >
                        取消
                      </button>
                    )}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* 下方控制区 */}
          <div className="border-t border-line">
            <AnimatePresence mode="wait" initial={false}>
              {stage === 'edit' && video && crop && (
                <motion.div
                  key="edit-controls"
                  variants={listIn}
                  initial="hidden"
                  animate="show"
                  exit="out"
                  className="space-y-6 p-5"
                >
                  <motion.div variants={fadeUp} transition={SPRING} className="space-y-3">
                    <SectionTitle icon={<Scissors size={13} />} title="截取片段" />
                    <Timeline
                      duration={video.duration}
                      clip={clip}
                      current={current}
                      onClip={setClip}
                      onSeek={(t) => {
                        setPlaying(false)
                        setCurrent(t)
                        void seekTo(video.el, t)
                      }}
                    />
                  </motion.div>

                  <motion.div variants={fadeUp} transition={SPRING} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <SectionTitle icon={<Crop size={13} />} title="框选画面" />
                      <button
                        type="button"
                        onClick={() => {
                          if (!square && crop) {
                            const side = Math.min(crop.w, crop.h)
                            setCrop({
                              x: Math.min(crop.x, video.width - side),
                              y: Math.min(crop.y, video.height - side),
                              w: side,
                              h: side,
                            })
                          }
                          setSquare((s) => !s)
                        }}
                        className={cx(
                          'rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-all duration-200',
                          square
                            ? 'border-ink bg-ink text-white'
                            : 'border-line-strong text-muted hover:border-ink/35 hover:text-ink',
                        )}
                      >
                        锁定正方形
                      </button>
                    </div>
                    <p className="text-[12px] leading-relaxed text-muted">
                      拖框内移动 拖四角缩放 · 当前 {crop.w}×{crop.h}
                    </p>
                  </motion.div>

                  <motion.div variants={fadeUp} transition={SPRING} className="space-y-5">
                    <SectionTitle icon={<Gauge size={13} />} title="输出参数" />
                    <Field label="边长" hint={`${edge} px`}>
                      <Segmented
                        value={edge}
                        onChange={setEdge}
                        options={[
                          { value: '160', label: '160' },
                          { value: '200', label: '200' },
                          { value: '240', label: '240' },
                        ]}
                      />
                    </Field>
                    <Field label="帧率" hint={`${fps} fps`}>
                      <Segmented
                        value={fps}
                        onChange={setFps}
                        options={[
                          { value: '8', label: '8' },
                          { value: '12', label: '12' },
                          { value: '15', label: '15' },
                          { value: '20', label: '20' },
                        ]}
                      />
                    </Field>
                    <Field label="体积上限" hint="微信里自动播放要 ≤ 1MB">
                      <Segmented
                        value={budget}
                        onChange={setBudget}
                        options={[
                          { value: '500', label: '500K' },
                          { value: '1000', label: '1M' },
                          { value: '2000', label: '2M' },
                          { value: '5000', label: '5M' },
                        ]}
                      />
                    </Field>
                  </motion.div>

                  <motion.div variants={fadeUp} transition={SPRING} className="space-y-2.5 pt-1">
                    <Button full onClick={generate} disabled={!canGenerate} icon={<Download size={16} />}>
                      生成表情
                    </Button>
                    <Button full variant="quiet" onClick={restart} icon={<ArrowLeft size={15} />}>
                      换一个视频
                    </Button>
                  </motion.div>
                </motion.div>
              )}

              {stage === 'result' && result && gifUrl && (
                <motion.div
                  key="result-controls"
                  variants={listIn}
                  initial="hidden"
                  animate="show"
                  exit="out"
                  className="space-y-5 p-5"
                >
                  <motion.div variants={fadeUp} transition={SPRING} className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-white">
                      <Check size={13} strokeWidth={3} />
                    </span>
                    <span className="text-[15px] font-medium">做好了</span>
                  </motion.div>

                  <motion.div variants={fadeUp} transition={SPRING}>
                    <div className="grid grid-cols-2 gap-2">
                      <Stat label="体积" value={formatBytes(result.bytes)} />
                      <Stat label="尺寸" value={`${result.width}×${result.height}`} />
                      <Stat label="帧数" value={String(result.frames)} />
                      <Stat label="时长" value={`${(result.durationMs / 1000).toFixed(2)} 秒`} />
                    </div>
                  </motion.div>

                  <motion.div variants={fadeUp} transition={SPRING} className="space-y-2.5">
                    {result.overflow && (
                      <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/[0.05] p-3 text-[12.5px] leading-relaxed text-danger">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                        已经压到最低档仍然超过 {Number(budget) / 1000}MB 建议缩短片段或把边长调小
                      </div>
                    )}
                    {!result.overflow && result.plan.label !== '最高画质' && (
                      <div className="rounded-xl border border-line bg-black/[0.025] p-3 text-[12.5px] leading-relaxed text-ink-soft">
                        为塞进体积上限，画质降到「{result.plan.label}」档
                        {result.width < Number(edge) && `，尺寸缩到 ${result.width}px`}
                        {result.plan.keepEvery > 1 && `，帧率降到 ${result.fps.toFixed(1)} fps`}
                      </div>
                    )}
                    <a
                      href={gifUrl}
                      download={`meme-${Date.now()}.gif`}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-ink bg-ink px-5 py-3 text-[15px] font-medium text-white transition-transform duration-200 active:scale-[0.97]"
                    >
                      <Download size={16} />
                      保存 GIF
                    </a>
                    <p className="text-center text-[12px] leading-relaxed text-muted">
                      手机上长按这张图 → 存储到照片 → 微信里从相册添加为表情
                    </p>
                  </motion.div>

                  <motion.div variants={fadeUp} transition={SPRING}>
                    <Button full variant="quiet" onClick={reset} icon={<RefreshCw size={15} />}>
                      调整参数再来
                    </Button>
                  </motion.div>
                </motion.div>
              )}

              {stage === 'import' && (
                <motion.div
                  key="import-controls"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={SPRING}
                  className="space-y-3 p-5"
                >
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ['录屏', '抖音里长按屏幕录制'],
                      ['裁切', '框出表情那一块'],
                      ['导出', '200px 的 GIF'],
                    ].map(([t, d]) => (
                      <div key={t} className="rounded-xl border border-line bg-black/[0.015] p-2.5">
                        <div className="text-[12.5px] font-medium">{t}</div>
                        <div className="mt-0.5 text-[11px] leading-snug text-muted">{d}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[12px] leading-relaxed text-muted">
                    抖音私信的表情没有对外出口 存不下来也分享不出去 录屏是唯一能拿到的路
                  </p>
                </motion.div>
              )}

            </AnimatePresence>

            {/* 需要用户点一下才继续（iOS 缺用户激活时） */}
            <AnimatePresence>
              {pending && !loading && (
                <motion.div
                  key="pending"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={SPRING}
                  className="overflow-hidden border-t border-line"
                >
                  <div className="space-y-3 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12.5px] font-medium text-ink-soft">已选好文件</span>
                      <span className="truncate text-[12px] text-muted">{pending.label}</span>
                    </div>
                    <Button full onClick={startFromTap} icon={<Play size={15} fill="currentColor" />}>
                      开始处理
                    </Button>
                    <p className="text-[11.5px] leading-relaxed text-muted">
                      iPhone 上需要你点这一下 浏览器才允许开始读取视频 这不是出错
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 错误独立成块，避免和阶段切换抢同一个 AnimatePresence */}
            <AnimatePresence>
              {error && (
                <motion.div
                  key="err"
                  initial={{ opacity: 0, height: 0, y: 8 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -6 }}
                  transition={SPRING}
                  className="overflow-hidden"
                >
                  <div className="flex items-start gap-2 border-t border-danger/20 bg-danger/[0.05] p-4 text-[12.5px] leading-relaxed text-danger">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.section>

        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.5 }}
          className="mt-6 text-center text-[11.5px] leading-relaxed text-muted"
        >
          视频不离开你的设备 不上传 不联网
        </motion.footer>
      </div>
    </div>
  )
}

/* ---------- 子组件 ---------- */

function Dropzone({ onFile }: { onFile: (f: File) => void }) {
  const [hover, setHover] = useState(false)

  // 用 label 包住 input，点击由浏览器原生转发。
  // 之前用 JS 调 .click() 打隐藏 input，部分手机浏览器会静默拒绝打开选择器。
  return (
    <motion.label
      whileHover={{ scale: 1.005 }}
      whileTap={{ scale: 0.99 }}
      transition={SPRING}
      onDragOver={(e) => {
        e.preventDefault()
        setHover(true)
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault()
        setHover(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      }}
      className={cx(
        'group flex h-full w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-[20px] border-2 border-dashed',
        'transition-colors duration-300 outline-none focus-within:ring-2 focus-within:ring-accent/40',
        hover ? 'border-accent bg-accent-soft' : 'border-line-strong bg-white hover:border-ink/30',
      )}
    >
      <input
        type="file"
        accept="video/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      <motion.span
        className="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-white shadow-sm"
        whileHover={{ rotate: -6, scale: 1.06 }}
        transition={SPRING}
      >
        <Upload size={20} strokeWidth={2} />
      </motion.span>
      <span className="text-[14px] font-medium">选一段录屏</span>
      <span className="text-[11.5px] text-muted">或直接拖进来 · MP4 / MOV / WebM</span>
    </motion.label>
  )
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-tight text-ink">
      <span className="text-muted">{icon}</span>
      {title}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={SPRING}
      className="rounded-xl border border-line bg-black/[0.015] p-3"
    >
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 text-[15px] font-medium tabular-nums">{value}</div>
    </motion.div>
  )
}

function Check({ size = 14, strokeWidth = 2.5 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
