@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Halloween Quest - stop local server
node scripts/stop-managed.mjs local
echo.
pause
