@echo off
title Iverson Bar Launcher
cd /d "%~dp0"

echo ============================================
echo   Iverson Bar - Auto Launcher
echo ============================================
echo.

echo [1/2] Stopping previous server processes...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1

echo [2/2] Starting Bar Server and Cloudflare Tunnel...
start "Iverson Bar Server" cmd /k "node server.js"

timeout /t 3 >nul
start http://localhost:3000/dashboard.html
start http://localhost:3000/qr.html

echo.
echo ============================================
echo   [OK] Iverson Bar is starting up!
echo   Please check the "Iverson Bar Server" window
echo   for the Cloudflare Tunnel URL.
echo ============================================
echo.
pause
