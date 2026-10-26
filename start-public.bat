@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Halloween Quest - public HTTPS
echo This starts the public HTTPS server. Ports 80 and 443 must be reachable.
echo Do not use a private or local network address.
set "QUEST_PUBLIC_IP="
set /p "QUEST_PUBLIC_IP=Enter public IPv4: "
if not defined QUEST_PUBLIC_IP (
  echo No IP entered. Server was not started.
  pause
  exit /b 1
)
call npm.cmd run public
echo.
echo Server stopped. If it failed, check the message above.
pause
