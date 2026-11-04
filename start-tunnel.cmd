@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title 抽签系统 · 公网隧道（关闭本窗口即断开）
echo ============================================
echo   抽签系统 · 一键公网隧道（免费 / 无提示插页）
echo ============================================
echo.

netstat -ano | findstr ":3000" | findstr LISTENING >nul
if errorlevel 1 (
  echo [1/2] 启动本地抽签服务...
  start "抽签服务" cmd /k node --experimental-sqlite server.js
  timeout /t 3 >nul
) else (
  echo [1/2] 检测到 3000 端口已在运行，跳过启动。
)

if not exist "tunnel_key" (
  echo [i] 首次运行，生成隧道专用 SSH 密钥...
  ssh-keygen -t ed25519 -f tunnel_key -N "" -q -C "lottery-tunnel"
)

:loop
echo.
echo [2/2] 建立公网隧道，稍等 5~10 秒会打印公网地址...
echo       出现 https://xxxx.lhr.life 即为用户可用链接（每次重连地址会变）。
echo       保持本窗口开启；断线会自动重连。
echo.
ssh -i tunnel_key -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL ^
    -o IdentitiesOnly=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 ^
    -o ExitOnForwardFailure=yes -R 80:localhost:3000 nokey@localhost.run

echo.
echo [i] 隧道已断开，5 秒后自动重连（地址会变，注意更新发出去的链接）...
echo     想彻底退出请直接关闭本窗口。
timeout /t 5 >nul
goto loop
