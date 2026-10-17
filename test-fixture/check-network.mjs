// 检查这台机器能不能访问各处（浏览器走系统代理，和真实访问一致）
// 用法: node test-fixture/check-network.mjs
import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const targets = [
  ['线上站点', 'https://fm-1010sf.github.io/meme-cut/'],
  ['GitHub 仓库', 'https://github.com/Fm-1010sf/meme-cut'],
  ['GitHub API', 'https://api.github.com/'],
  ['GitHub Pages CDN', 'https://githubnext.github.io/'],
  ['Netlify', 'https://www.netlify.com/'],
  ['Cloudflare', 'https://www.cloudflare.com/'],
]

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage()

for (const [label, url] of targets) {
  const t = Date.now()
  try {
    const res = await page.goto(url, { timeout: 20000, waitUntil: 'domcontentloaded' })
    console.log(`  ${label.padEnd(16)} HTTP ${res?.status()}  ${Date.now() - t}ms`)
  } catch (e) {
    console.log(`  ${label.padEnd(16)} 失败  ${e.message.split('\n')[0].slice(0, 60)}`)
  }
}

await browser.close()
