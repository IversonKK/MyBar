# ============================================================
#  Iverson Bar — 一鍵啟動腳本
#  功能：啟動 Node.js 伺服器 + cloudflared HTTPS 隧道
#        自動偵測 URL 並開啟 QR Code 頁面
# ============================================================

$Host.UI.RawUI.WindowTitle = "Iverson Bar System"
$BAR_DIR = $PSScriptRoot
if (-not $BAR_DIR) { $BAR_DIR = (Get-Location).Path }

function Write-Color($text, $color = "White") {
    Write-Host $text -ForegroundColor $color
}

Write-Color "============================================" "Cyan"
Write-Color "  🍸  Iverson Bar  —  吧台一鍵啟動系統" "Yellow"
Write-Color "============================================" "Cyan"
Write-Host ""

# ── 步驟 1：停止舊的 Node 與 cloudflared 程序 ──
Write-Color "⏹  正在停止舊的伺服器與隧道程序..." "Gray"
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 600

# ── 步驟 2：啟動 Node.js 伺服器 ──
Write-Color "🚀  正在啟動吧台伺服器..." "Cyan"
$nodeProc = Start-Process -FilePath "powershell" `
    -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "cd '$BAR_DIR'; node server.js" `
    -WindowStyle Minimized `
    -PassThru

Start-Sleep -Seconds 2
Write-Color "✅  吧台伺服器已啟動 (http://localhost:3000)" "Green"
Write-Host ""

# ── 步驟 3：確認 cloudflared 執行檔路徑 ──
Write-Color "🔍  正在尋找 cloudflared..." "Gray"

$cfExe = ""
if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    $cfExe = "cloudflared"
} else {
    $candidates = @(
        "C:\Program Files (x86)\cloudflared\cloudflared.exe",
        "C:\Program Files\cloudflared\cloudflared.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared*\cloudflared.exe",
        "$BAR_DIR\cloudflared.exe"
    )
    foreach ($cand in $candidates) {
        $found = Resolve-Path $cand -ErrorAction SilentlyContinue
        if ($found) {
            $cfExe = $found[0].Path
            $cfDir = Split-Path $cfExe
            $env:PATH = "$cfDir;" + $env:PATH
            break
        }
    }
}

$tunnelUrl = ""

if ($cfExe) {
    Write-Color "✅  找到 Cloudflare 隧道元件：$cfExe" "Green"
    Write-Color "🌐  正在建立 HTTPS 隧道，請稍候..." "Cyan"
    
    $cfLog = Join-Path $BAR_DIR "cloudflared.log"
    if (Test-Path $cfLog) { Remove-Item $cfLog -Force -ErrorAction SilentlyContinue }

    $cfProc = Start-Process -FilePath $cfExe `
        -ArgumentList "tunnel --url http://localhost:3000 --no-autoupdate --protocol http2 --edge-ip-version 4" `
        -RedirectStandardError $cfLog `
        -RedirectStandardOutput $cfLog `
        -WindowStyle Hidden `
        -PassThru

    $timeout = [DateTime]::Now.AddSeconds(30)
    $urlPattern = 'https://[a-zA-Z0-9\-]+\.trycloudflare\.com'
    $dots = 0

    while ([DateTime]::Now -lt $timeout -and -not $cfProc.HasExited) {
        Start-Sleep -Milliseconds 500
        if (Test-Path $cfLog) {
            $content = Get-Content $cfLog -Raw -ErrorAction SilentlyContinue
            if ($content -and $content -match $urlPattern) {
                $tunnelUrl = $Matches[0]
                break
            }
        }
        $dots++
        if ($dots % 2 -eq 0) { Write-Host "." -NoNewline -ForegroundColor Yellow }
    }
    Write-Host ""
} else {
    Write-Color "⚠️  未找到 cloudflared，跳過公網隧道..." "Yellow"
}

# ── 步驟 4：處理結果與開啟頁面 ──
$localIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch "^(127|169)" -and $_.PrefixOrigin -eq "Dhcp" } | Select-Object -First 1).IPAddress
if (-not $localIp) { $localIp = "localhost" }

if ($tunnelUrl) {
    Write-Host ""
    Write-Color "============================================" "Green"
    Write-Color "  ✅  HTTPS 隧道建立成功！" "Green"
    Write-Color "============================================" "Green"
    Write-Host ""
    Write-Color "  🔗  外網連線網址：" "White"
    Write-Color "      $tunnelUrl" "Cyan"
    Write-Host ""
    
    # 傳給 Node.js 伺服器
    try {
        $body = "{`"url`":`"$tunnelUrl`"}" 
        Invoke-WebRequest -Uri "http://localhost:3000/api/tunnel-url" `
            -Method POST `
            -ContentType "application/json" `
            -Body $body `
            -UseBasicParsing -TimeoutSec 3 | Out-Null
    } catch {}

    $qrPageUrl = "http://localhost:3000/qr.html?url=$([System.Uri]::EscapeDataString($tunnelUrl))"
    Start-Process $qrPageUrl
} else {
    Write-Host ""
    Write-Color "💡  使用本機區域網路連線：" "Yellow"
    Write-Color "    http://${localIp}:3000" "Cyan"
    Write-Host ""
    Start-Process "http://localhost:3000"
}

# ── 步驟 5：保持程式運行 ──
Write-Host ""
Write-Color "============================================" "Cyan"
Write-Color "  📊  吧台服務持續運行中（請勿關閉此視窗）" "Yellow"
Write-Color "  💡  若要關閉系統，請直接關閉此視窗或按 Ctrl+C" "Gray"
Write-Color "============================================" "Cyan"
Write-Host ""

try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host ""
    Write-Color "🛑  正在停止所有吧台服務..." "Yellow"
    if ($cfProc -and -not $cfProc.HasExited) { $cfProc.Kill() }
    if ($nodeProc -and -not $nodeProc.HasExited) { $nodeProc.Kill() }
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force
    if (Test-Path $cfLog) { Remove-Item $cfLog -Force -ErrorAction SilentlyContinue }
    Write-Color "👋  服務已全部停止，晚安！" "Green"
}
