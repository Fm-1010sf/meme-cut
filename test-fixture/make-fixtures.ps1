# 重新生成端到端测试用的素材
# 用法: pwsh -File test-fixture/make-fixtures.ps1 -Ffmpeg "C:\path\to\ffmpeg.exe"
#
# 三个素材分别覆盖不同情况：
#   sample.mp4  普通画面，体积压得动
#   noise.mp4   高熵噪声，压不动，用来逼出压缩阶梯的降级分支
#   hevc.mov    iOS 录屏的默认编码
# broken.mp4 由 verify.mjs 自己写，不需要生成

param(
  [string]$Ffmpeg = 'ffmpeg'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "使用 ffmpeg: $Ffmpeg"

& $Ffmpeg -y -hide_banner -loglevel error `
  -f lavfi -i "testsrc2=size=720x1280:rate=30:duration=3" `
  -pix_fmt yuv420p -c:v libx264 -preset veryfast "$here\sample.mp4"

& $Ffmpeg -y -hide_banner -loglevel error `
  -f lavfi -i "nullsrc=size=720x1280:rate=30:duration=2.5,geq=random(1)*255:128:128" `
  -pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 18 "$here\noise.mp4"

& $Ffmpeg -y -hide_banner -loglevel error `
  -f lavfi -i "testsrc2=size=720x1280:rate=30:duration=2" `
  -c:v libx265 -tag:v hvc1 -pix_fmt yuv420p "$here\hevc.mov"

Get-ChildItem $here -File | Where-Object { $_.Extension -in '.mp4', '.mov' } |
  ForEach-Object { "{0,-14} {1,8:N1} KB" -f $_.Name, ($_.Length / 1KB) }
