#!/usr/bin/env sh
# 像素抽签一键启动（Mac/Linux）
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[首次运行] 正在安装依赖，请稍候…"
  npm install --no-audit --no-fund
fi

echo "正在启动服务器：http://127.0.0.1:3000"
echo "按 Ctrl+C 停止。"
( sleep 2 && ( command -v open >/dev/null 2>&1 && open http://127.0.0.1:3000 || command -v xdg-open >/dev/null 2>&1 && xdg-open http://127.0.0.1:3000 ) ) &
node server.js
