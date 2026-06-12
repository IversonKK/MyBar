@echo off
title Stop Iverson Bar
echo ============================================
echo   Stopping Iverson Bar and Cloudflare Tunnels...
echo ============================================
echo.

taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1

echo [OK] Node.js server stopped.
echo [OK] Cloudflare tunnels closed.
echo.
echo ============================================
echo   All services stopped successfully!
echo ============================================
echo.
pause
