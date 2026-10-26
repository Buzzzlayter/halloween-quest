@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Halloween Quest - local test
echo Starting local test server. Browser will open when ready.
echo Close this window or press Ctrl+C to stop the server.
echo.
call npm.cmd run local
echo.
echo Server stopped. If it failed, check the message above.
pause
