@echo off
chcp 65001 >nul
title 像素抽签服务器
cd /d "%~dp0"

if not exist node_modules (
  echo [首次运行] 正在安装依赖，请稍候…
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo 正在启动服务器：http://127.0.0.1:3000
echo 按 Ctrl+C 停止。
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:3000"
node server.js
pause
