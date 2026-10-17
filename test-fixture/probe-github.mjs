import { chromium } from 'playwright-core'
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})
const page = await browser.newPage()
for (const url of ['https://github.com/', 'https://github.com/Sfeng10/meme-cut']) {
  try {
    const r = await page.goto(url, { timeout: 20000, waitUntil: 'domcontentloaded' })
    console.log(`  ${url} -> HTTP ${r?.status()}  标题: ${await page.title()}`)
  } catch (e) {
    console.log(`  ${url} -> 失败: ${e.message.split('\n')[0]}`)
  }
}
await browser.close()
