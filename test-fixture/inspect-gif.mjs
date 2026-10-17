// 检查一个 GIF 的真实帧率。用法: node test-fixture/inspect-gif.mjs path/to/file.gif
import fs from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('用法: node test-fixture/inspect-gif.mjs <file.gif>')
  process.exit(1)
}

const buf = fs.readFileSync(file)

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

const delays = []
let imageBlocks = 0

while (p < buf.length) {
  const b = buf[p]
  if (b === 0x3b) break
  if (b === 0x21) {
    p += 1
    const label = buf[p]
    p += 1
    if (label === 0xf9) delays.push(buf[p + 2] | (buf[p + 3] << 8))
    skip()
  } else if (b === 0x2c) {
    imageBlocks++
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
const fps = totalMs > 0 ? (delays.length / totalMs) * 1000 : 0
const hist = {}
for (const d of delays) hist[d] = (hist[d] ?? 0) + 1

console.log(`文件      ${file}`)
console.log(`体积      ${(buf.length / 1024).toFixed(1)} KB`)
console.log(`尺寸      ${w}×${h}`)
console.log(`图像块    ${imageBlocks}`)
console.log(`带延时的帧 ${delays.length}`)
console.log(`延时分部  ${Object.entries(hist).map(([cs, n]) => `${cs}厘秒×${n}`).join('  ')}`)
console.log(`总时长    ${(totalMs / 1000).toFixed(2)} 秒`)
console.log(`实际帧率  ${fps.toFixed(2)} fps`)
