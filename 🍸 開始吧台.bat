@echo off
chcp 65001 >nul
title 🍸 Iverson Bar 吧台啟動器
echo.
echo   正在啟動 Iverson Bar 吧台系統...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-bar.ps1"
pause
