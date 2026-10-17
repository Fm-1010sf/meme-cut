# 构建并部署到 Cloudflare Pages
#
# 用法:
#   pwsh -File deploy.ps1
#   pwsh -File deploy.ps1 -Project my-name -Branch main
#
# 前置条件（二选一）:
#   A. 已经跑过 wrangler login 并授权成功
#   B. 设置了环境变量 CLOUDFLARE_API_TOKEN（Cloudflare Pages:Edit 权限）
#
# 授权状态检查: pnpm dlx wrangler whoami

param(
  [string]$Project = 'meme-cut',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# 没有显式设置就尝试从「用户环境变量」里取，这样令牌不必出现在命令行或聊天里
if (-not $env:CLOUDFLARE_API_TOKEN) {
  $userToken = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN', 'User')
  if ($userToken) {
    $env:CLOUDFLARE_API_TOKEN = $userToken
    Write-Host '已从用户环境变量读取 CLOUDFLARE_API_TOKEN' -ForegroundColor DarkGray
  }
}
if (-not $env:CLOUDFLARE_ACCOUNT_ID) {
  $userAcct = [Environment]::GetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID', 'User')
  if ($userAcct) { $env:CLOUDFLARE_ACCOUNT_ID = $userAcct }
}

Write-Host "== 构建 ==" -ForegroundColor Cyan
& pnpm exec vite build
if ($LASTEXITCODE -ne 0) { throw '构建失败' }

$files = Get-ChildItem dist -Recurse -File
$total = ($files | Measure-Object Length -Sum).Sum
Write-Host ("产物 {0} 个文件，共 {1:N0} KB" -f $files.Count, ($total / 1KB))

Write-Host "`n== 检查授权 ==" -ForegroundColor Cyan
& pnpm dlx wrangler whoami 2>&1 | Out-String | Write-Host
if (-not $env:CLOUDFLARE_API_TOKEN) {
  Write-Host '没有 CLOUDFLARE_API_TOKEN，走已登录的 OAuth 会话' -ForegroundColor Yellow
}

Write-Host "`n== 部署 ==" -ForegroundColor Cyan
& pnpm dlx wrangler pages deploy dist --project-name $Project --branch $Branch --commit-dirty=true
if ($LASTEXITCODE -ne 0) { throw '部署失败' }

Write-Host "`n完成。" -ForegroundColor Green
Write-Host "地址一般是 https://$Project.pages.dev"
