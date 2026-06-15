# 飞书 (Feishu/Lark) + Cloudflare Tunnel 一键启动脚本
#
# 使用前必读：
# 1. 已注册飞书开放平台应用，拿到 App ID / App Secret
# 2. 已配置飞书机器人的"事件订阅"Request URL（先用 trycloudflare 临时域名也行）
# 3. 已安装 cloudflared（winget install Cloudflare.cloudflared）
# 4. 已创建隧道（cloudflared tunnel create agent-watch）
# 5. 已配 .env 文件（FEISHU_ENABLED=true 等）
#
# 启动顺序：
# 1. 启动 Gateway（3000 端口）
# 2. 启动 Cloudflare Tunnel（暴露 Gateway 到公网）
# 3. 启动 CLI（agent-watch.js 监听命令）
#
# 这个脚本做第 2 步。其它步骤见 README.md 飞书章节。

[CmdletBinding()]
param(
    [string]$TunnelName = "agent-watch",
    [string]$ConfigFile = "$PSScriptRoot\tunnel-config.yml",
    [switch]$TryCloudflare  # 用临时域名（不需自己的域名）
)

# ============================================================
# 0. 检查 cloudflared 是否安装
# ============================================================
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
    Write-Host "❌ cloudflared 未安装" -ForegroundColor Red
    Write-Host "请先运行：winget install Cloudflare.cloudflared" -ForegroundColor Yellow
    Write-Host "或下载：https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -ForegroundColor Yellow
    exit 1
}

# ============================================================
# 1. 检查 Gateway 是否在跑
# ============================================================
$gatewayRunning = Test-NetConnection -ComputerName localhost -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $gatewayRunning) {
    Write-Host "⚠️  Gateway (localhost:3000) 未启动" -ForegroundColor Yellow
    Write-Host "请先在另一个终端运行：pnpm dev" -ForegroundColor Yellow
    Write-Host "或：cd packages/gateway && pnpm start" -ForegroundColor Yellow
    $continue = Read-Host "是否仍要继续启动 tunnel？(y/n)"
    if ($continue -ne "y") {
        exit 0
    }
}

# ============================================================
# 2. 启动 Cloudflare Tunnel
# ============================================================
if ($TryCloudflare) {
    # 临时域名模式：免 domain 即可使用
    Write-Host "🚀 启动 Cloudflare Tunnel (trycloudflare 临时域名模式)..." -ForegroundColor Cyan
    Write-Host "   复制输出的 https://xxxx.trycloudflare.com 链接" -ForegroundColor Cyan
    Write-Host "   粘贴到飞书开放平台 → 事件订阅 → Request URL" -ForegroundColor Cyan
    Write-Host ""
    cloudflared tunnel --url http://localhost:3000
} else {
    # 正式隧道模式
    if (-not (Test-Path $ConfigFile)) {
        Write-Host "❌ 配置文件不存在：$ConfigFile" -ForegroundColor Red
        Write-Host "请先运行：" -ForegroundColor Yellow
        Write-Host "  1. cloudflared tunnel login" -ForegroundColor Yellow
        Write-Host "  2. cloudflared tunnel create $TunnelName" -ForegroundColor Yellow
        Write-Host "  3. 编辑 $ConfigFile 填入你的域名" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "🚀 启动 Cloudflare Tunnel: $TunnelName" -ForegroundColor Cyan
    Write-Host "   配置文件：$ConfigFile" -ForegroundColor Cyan
    Write-Host ""
    cloudflared tunnel --config $ConfigFile run $TunnelName
}
