# ============================================================
#  🍸 Iverson Bar — 一鍵啟動腳本
#  功能：啟動 Node.js 伺服器 + cloudflared HTTPS 隧道
#        自動偵測 URL 並開啟 QR Code 頁面
# ============================================================

$Host.UI.RawUI.WindowTitle = "🍸 Iverson Bar 吧台系統"
$BAR_DIR = $PSScriptRoot

# ANSI 顏色（Windows Terminal / PowerShell 5.1+）
function Write-Color($text, $color = "White") {
    Write-Host $text -ForegroundColor $color
}

Clear-Host
Write-Color "============================================" "DarkGray"
Write-Color "  🍸  Iverson Bar  —  吧台一鍵啟動系統" "Yellow"
Write-Color "============================================" "DarkGray"
Write-Host ""

# ── 步驟 1：停止舊的 Node 與 cloudflared 程序 ──
Write-Color "⏹  正在停止舊的伺服器與隧道程序..." "DarkGray"
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 600

# ── 步驟 2：啟動 Node.js 伺服器（新視窗）──
Write-Color "🚀  正在啟動吧台伺服器..." "Cyan"
$nodeProc = Start-Process -FilePath "powershell" `
    -ArgumentList "-NoExit", "-Command", "cd '$BAR_DIR'; node server.js" `
    -WindowStyle Minimized `
    -PassThru

Start-Sleep -Seconds 2
Write-Color "✅  吧台伺服器已啟動 (http://localhost:3000)" "Green"
Write-Host ""

# ── 步驟 3：確認 cloudflared 已安裝 ──
Write-Color "🔍  正在確認 cloudflared 安裝狀態..." "DarkGray"
$cfInstalled = $null -ne (Get-Command cloudflared -ErrorAction SilentlyContinue)

if (-not $cfInstalled) {
    Write-Color "⚠️  找不到 cloudflared，正在使用 winget 安裝..." "Yellow"
    winget install --id Cloudflare.cloudflared -e --silent --accept-source-agreements --accept-package-agreements
    
    # 更新 PATH
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    
    $cfInstalled = $null -ne (Get-Command cloudflared -ErrorAction SilentlyContinue)
    if (-not $cfInstalled) {
        Write-Color "❌  cloudflared 安裝失敗，請手動安裝後重試。" "Red"
        Write-Color "    下載頁面: https://github.com/cloudflare/cloudflared/releases" "Gray"
        Read-Host "按 Enter 離開"
        exit 1
    }
    Write-Color "✅  cloudflared 安裝成功！" "Green"
}

Write-Host ""
Write-Color "🌐  正在建立 HTTPS 隧道，請稍候..." "Cyan"
Write-Color "    (通常需要 10~30 秒)" "DarkGray"
Write-Host ""

# ── 步驟 4：啟動 cloudflared 並截取 URL ──
$pinfo = New-Object System.Diagnostics.ProcessStartInfo
$pinfo.FileName = "cloudflared"
$pinfo.Arguments = "tunnel --url http://localhost:3000 --no-autoupdate"
$pinfo.RedirectStandardError = $true
$pinfo.RedirectStandardOutput = $true
$pinfo.UseShellExecute = $false
$pinfo.CreateNoWindow = $true

$cfProc = New-Object System.Diagnostics.Process
$cfProc.StartInfo = $pinfo
$cfProc.Start() | Out-Null

$tunnelUrl = ""
$timeout = [DateTime]::Now.AddSeconds(60)   # 最多等 60 秒
$urlPattern = 'https://[a-zA-Z0-9\-]+\.trycloudflare\.com'
$dots = 0

while ([DateTime]::Now -lt $timeout -and -not $cfProc.HasExited) {
    $line = $cfProc.StandardError.ReadLine()
    if (-not $line) { $line = $cfProc.StandardOutput.ReadLine() }
    
    if ($line -match $urlPattern) {
        $tunnelUrl = $Matches[0]
        break
    }
    
    # 顯示進度點
    $dots++
    if ($dots % 5 -eq 0) { Write-Host "." -NoNewline -ForegroundColor DarkGray }
}

Write-Host ""

# ── 步驟 5：處理結果 ──
if ([string]::IsNullOrEmpty($tunnelUrl)) {
    Write-Color "❌  未能取得隧道網址，可能原因：" "Red"
    Write-Color "    - 電腦目前沒有網路連線" "DarkYellow"
    Write-Color "    - cloudflared 服務暫時無法使用" "DarkYellow"
    Write-Color "" "White"
    Write-Color "💡  您仍可讓客人用 Wi-Fi 連線：" "Yellow"
    
    # 取得本機 IP 顯示給用戶
    $localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch "^(127|169)" -and $_.PrefixOrigin -eq "Dhcp" } | Select-Object -First 1).IPAddress
    if ($localIp) {
        Write-Color "    http://${localIp}:3000" "Cyan"
        Write-Color "    (Toast 頁面通知可用，但無系統推播)" "DarkGray"
    }
    Write-Host ""
    Read-Host "按 Enter 關閉（Node.js 伺服器仍在背景運行）"
    exit
}

# ── 成功！──
Write-Host ""
Write-Color "============================================" "DarkGreen"
Write-Color "  ✅  HTTPS 隧道建立成功！" "Green"
Write-Color "============================================" "DarkGreen"
Write-Host ""
Write-Color "  🔗  客人連線網址：" "White"
Write-Color "      $tunnelUrl" "Cyan"
Write-Host ""
Write-Color "  📱  QR Code 頁面即將開啟..." "Yellow"
Write-Host ""

# 把 URL 傳給 Node.js 伺服器
try {
    $body = "{`"url`":`"$tunnelUrl`"}" 
    Invoke-WebRequest -Uri "http://localhost:3000/api/tunnel-url" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -UseBasicParsing | Out-Null
} catch {
    # 不影響主流程，靜默忽略
}

# 開啟 QR Code 頁面
$qrPageUrl = "http://localhost:3000/qr.html?url=$([System.Uri]::EscapeDataString($tunnelUrl))"
Start-Process $qrPageUrl

# ── 步驟 6：保持程式執行（維持隧道存活）──
Write-Color "  ⏸  按 Ctrl+C 或關閉此視窗以停止所有服務" "DarkGray"
Write-Host ""
Write-Color "============================================" "DarkGray"
Write-Color "  📊  即時日誌（cloudflared）" "DarkGray"
Write-Color "============================================" "DarkGray"
Write-Host ""

# 持續讀取 cloudflared 輸出（保持隧道存活）
try {
    while (-not $cfProc.HasExited) {
        $line = $cfProc.StandardError.ReadLine()
        if ($line -and $line -match "ERR|error|fail") {
            Write-Color "[CF] $line" "DarkRed"
        }
        # 靜默其他一般日誌
    }
} finally {
    # 清理：停止所有子程序
    Write-Host ""
    Write-Color "🛑  正在停止所有服務..." "Yellow"
    if (-not $cfProc.HasExited) { $cfProc.Kill() }
    if ($nodeProc -and -not $nodeProc.HasExited) { $nodeProc.Kill() }
    Write-Color "👋  已關閉，晚安！" "Green"
}
