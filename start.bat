@echo off
title 无人负责 夜行列车 服务器
cd /d "%~dp0"

if not exist node_modules (
  echo [首次运行] 正在安装依赖，请稍候...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

rem 端口 3000 被占用 = 服务器已在运行，直接打开浏览器（避免 EADDRINUSE）
netstat -ano | findstr /c:":3000 " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo 检测到服务器已在运行，直接打开浏览器...
  start http://127.0.0.1:3000
  exit /b 0
)

echo 正在启动服务器：http://127.0.0.1:3000
echo 按 Ctrl+C 停止。
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:3000"
node server.js
pause
