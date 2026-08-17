# ============================================================
# 公网暴露脚本（需在能联网的本机/服务器上运行，服务器需先启动）
# 用法:  powershell -ExecutionPolicy Bypass -File scripts\tunnel.ps1 [-Port 3000]
# 优先 cloudflared（免费、HTTPS、无中间页，推荐），否则 localtunnel（有中间确认页）
# ============================================================
param([int]$Port = 3000)

$ErrorActionPreference = 'Continue'

Write-Host "◆ 检查本机服务器 $Port 端口..."
$serverUp = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue -InformationLevel Quiet
if (-not $serverUp) {
  Write-Host '⚠ 服务器未启动！请先运行: npm start' -ForegroundColor Yellow
  Write-Host '  然后重新执行本脚本。'
  exit 1
}

$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cf) {
  Write-Host "◆ 使用 cloudflared quick tunnel → http://127.0.0.1:$Port" -ForegroundColor Green
  Write-Host '  生成的 trycloudflare.com 地址直接发给朋友即可（HTTPS，语音可用）'
  & cloudflared tunnel --url "http://127.0.0.1:$Port"
  exit $LASTEXITCODE
}

Write-Host '◆ 未找到 cloudflared，改用 localtunnel（需要 Node/npx）' -ForegroundColor Green
Write-Host '  提示：首次访问 localtunnel 地址会有一个确认中间页，点一下即可进入'
npx --yes localtunnel --port $Port
