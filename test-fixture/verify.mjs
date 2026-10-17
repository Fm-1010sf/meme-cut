import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL = process.env.APP_URL || 'http://127.0.0.1:5183'
const sample = path.resolve('test-fixture/sample.mp4')
const noise = path.resolve('test-fixture/noise.mp4')

/** 按 GIF 规范逐块走，数真实帧数（不能搜字节，LZW 数据里会撞车） */
function gifInfo(buf) {
  let p = 6
  const w = buf.readUInt16LE(p)
  p += 2
  const h = buf.readUInt16LE(p)
  p += 2
  const packed = buf[p]
  p += 3
  if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1))
  const skip = () => {
    while (buf[p] !== 0) p += buf[p] + 1
    p += 1
  }
  let frames = 0
  const delays = []
  while (p < buf.length) {
    const b = buf[p]
    if (b === 0x3b) break
    if (b === 0x21) {
      p += 1
      const label = buf[p]
      p += 1
      if (label === 0xf9) {
        frames++
        // 块结构: 04 packed delayLo delayHi transparentIdx 00
        delays.push(buf[p + 2] | (buf[p + 3] << 8))
      }
      skip()
    } else if (b === 0x2c) {
      p += 1
      p += 8
      const lp = buf[p]
      p += 1
      if (lp & 0x80) p += 3 * (1 << ((lp & 7) + 1))
      p += 1
      skip()
    } else break
  }
  const totalMs = delays.reduce((a, b) => a + b, 0) * 10
  return { w, h, frames, delays, totalMs }
}

let pass = true
const results = []
function ok(cond, msg) {
  console.log(`${cond ? '✔' : '✖'} ${msg}`)
  if (!cond) pass = false
  return cond
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const ctx = await browser.newContext({ viewport: { width: 880, height: 1000 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const shot = async (name) => {
  await page.waitForTimeout(750)
  await page.screenshot({ path: `test-fixture/${name}.png` })
}

const t0 = Date.now()
await page.goto(URL, { waitUntil: 'networkidle' })
await page.getByText('选一段录屏').first().waitFor({ timeout: 20000 })
console.log(`✔ 首屏 ${Date.now() - t0}ms`)
await shot('1-import')

async function pick(file) {
  // 结果页只有「调整参数再来」，先退回编辑态才看得到「换一个视频」
  const adjust = page.getByRole('button', { name: /调整参数再来/ })
  if (await adjust.count()) {
    await adjust.click()
    await page.getByRole('button', { name: /生成表情/ }).waitFor({ timeout: 20000 })
  }
  const swap = page.getByRole('button', { name: /换一个视频/ })
  if (await swap.count()) {
    await swap.click()
    await page.getByText('选一段录屏').first().waitFor({ timeout: 20000 })
  }
  await page.setInputFiles('input[type=file]', file)

  // 手机上「选完文件没反应」多半是这里缺反馈，所以专门盯一下
  const sawLoading = await page
    .getByText('正在读取视频')
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false)

  // 走了「需要点一下」的分支就点下去，两条路径都要覆盖
  const startBtn = page.getByRole('button', { name: /开始处理/ })
  if (await startBtn.count()) await startBtn.click()

  await page.getByRole('button', { name: /生成表情/ }).waitFor({ timeout: 40000 })
  await page.waitForTimeout(500)
  return sawLoading
}

async function setSeg(label) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.waitForTimeout(200)
}

async function generate(tag) {
  const t = Date.now()
  await page.getByRole('button', { name: /生成表情/ }).click()
  await page.getByText('做好了').waitFor({ timeout: 180000 })
  const ms = Date.now() - t
  await shot(`3-result-${tag}`)

  const data = await page.evaluate(async () => {
    const img = document.querySelector('img[alt="生成的表情"]')
    const res = await fetch(img.src)
    const bytes = new Uint8Array(await res.arrayBuffer())
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    const stats = [...document.querySelectorAll('div')]
      .filter(
        (d) =>
          d.children.length === 2 &&
          /^(体积|尺寸|帧数|时长|实际帧率)$/.test(d.children[0].textContent?.trim() ?? ''),
      )
      .map((d) => `${d.children[0].textContent.trim()}=${d.children[1].textContent.trim()}`)
    const notice =
      [...document.querySelectorAll('div')]
        .map((d) => d.textContent?.trim() ?? '')
        .filter((s) => /降到|超过/.test(s) && s.length < 80)
        .sort((a, b) => a.length - b.length)[0] ?? null
    return { b64: btoa(bin), bytes: bytes.byteLength, stats, notice }
  })

  const gif = Buffer.from(data.b64, 'base64')
  const info = gifInfo(gif)
  fs.writeFileSync(`test-fixture/out-${tag}.gif`, gif)
  results.push({ tag, kb: data.bytes / 1024, ...info, notice: data.notice, ms })
  console.log(
    `\n[${tag}] ${ms}ms · ${(data.bytes / 1024).toFixed(1)}KB · ${info.w}×${info.h} · ${info.frames}帧`,
  )
  console.log(`      ${data.stats.join(' | ')}`)
  if (data.notice) console.log(`      提示: ${data.notice}`)
  return { bytes: data.bytes, info }
}

/* ---------- A 坏文件必须报错，不能静默 ---------- */
fs.writeFileSync('test-fixture/broken.mp4', Buffer.from('definitely not a video'.repeat(64)))
await page.setInputFiles('input[type=file]', path.resolve('test-fixture/broken.mp4'))
const errShown = await page
  .getByText(/broken\.mp4/)
  .first()
  .waitFor({ timeout: 25000 })
  .then(() => true)
  .catch(() => false)
ok(errShown, '坏文件给出可见错误（不再是无反应）')
await page.waitForTimeout(400)
await page.screenshot({ path: 'test-fixture/0-error.png' })

/* ---------- B 不支持的编码也要报错 ---------- */
await page.setInputFiles('input[type=file]', path.resolve('test-fixture/hevc.mov'))
const hevcOutcome = await page
  .getByText(/hevc\.mov/)
  .first()
  .waitFor({ timeout: 25000 })
  .then(() => 'error')
  .catch(async () =>
    (await page.getByRole('button', { name: /生成表情/ }).count()) ? 'decoded' : 'silent',
  )
ok(hevcOutcome !== 'silent', `HEVC 文件有明确结果（${hevcOutcome === 'error' ? '报错提示' : '浏览器能解码'}）`)

/* ---------- C 正常素材 ---------- */
const sawLoading = await pick(sample)
ok(sawLoading, '载入期间有可见的加载状态')
const painted = await page.evaluate(() => {
  const v = document.querySelector('video')
  if (!v) return -1
  const c = document.createElement('canvas')
  c.width = 24
  c.height = 24
  const g = c.getContext('2d')
  g.drawImage(v, 0, 0, 24, 24)
  const d = g.getImageData(0, 0, 24, 24).data
  const s = new Set()
  for (let i = 0; i < d.length; i += 4) s.add(`${d[i]},${d[i + 1]},${d[i + 2]}`)
  return s.size
})
ok(painted > 3, `编辑态视频有画面（${painted} 种取样色）`)
await shot('2-edit')

const a = await generate('A-sample-1M')
const aInfo = gifInfo(fs.readFileSync('test-fixture/out-A-sample-1M.gif'))
ok(aInfo.frames > 1, '输出是动图')
ok(a.bytes <= 1024 * 1024, `1MB 预算内（${(a.bytes / 1024).toFixed(0)}KB）`)
ok(aInfo.w === 200 && aInfo.h === 200, '尺寸 200×200')

// 片段默认 2.5s，导出的总时长必须对得上，否则就是快放/慢放
const span = 2500
const drift = Math.abs(aInfo.totalMs - span) / span
ok(
  drift < 0.12,
  `播放速度与原片一致（GIF 总长 ${(aInfo.totalMs / 1000).toFixed(2)}s / 片段 2.50s，偏差 ${(drift * 100).toFixed(1)}%）`,
)
console.log(`     每帧间隔(厘秒): ${[...new Set(aInfo.delays)].join(', ')}`)

/* ---------- B 高熵画面 500KB 预算，压测降级阶梯 ---------- */
await pick(noise)
await setSeg('240')
await setSeg('20')
await setSeg('500K')
const b = await generate('B-noise-240-20fps-500K')
ok(b.bytes <= 500 * 1024, `500KB 预算内（${(b.bytes / 1024).toFixed(0)}KB）——降级阶梯生效`)
ok(b.info.frames > 1, '压完仍是动图')
const last = results[results.length - 1]
ok(Boolean(last.notice), `如实告知降级：${last.notice ?? '（没提示）'}`)

/* ---------- C 移动端布局 ---------- */
const m = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})
const mp = await m.newPage()
await mp.goto(URL, { waitUntil: 'networkidle' })
await mp.getByText('选一段录屏').first().waitFor({ timeout: 20000 })
await mp.waitForTimeout(700)
await mp.screenshot({ path: 'test-fixture/4-mobile-import.png' })
await mp.setInputFiles('input[type=file]', sample)
await mp.getByRole('button', { name: /生成表情/ }).waitFor({ timeout: 30000 })
await mp.waitForTimeout(800)
await mp.screenshot({ path: 'test-fixture/5-mobile-edit.png', fullPage: true })
const overflowX = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
ok(overflowX <= 0, `移动端无横向溢出（${overflowX}px）`)

console.log('\n控制台错误:', errors.length ? errors.slice(0, 5).join(' | ') : '无')
ok(errors.length === 0, '无控制台错误')

await browser.close()
console.log(pass ? '\n全部通过' : '\n有失败项')
process.exit(pass ? 0 : 1)
