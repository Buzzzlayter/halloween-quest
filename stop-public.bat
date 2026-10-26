@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Halloween Quest - stop public server
node scripts/stop-managed.mjs public
echo.
pause
