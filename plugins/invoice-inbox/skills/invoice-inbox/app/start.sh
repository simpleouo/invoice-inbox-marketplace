#!/bin/zsh
# 在背景啟動發票收件匣並開啟網頁；啟動後終端機可直接關閉。停止請執行 ./stop.sh
cd "$(dirname "$0")"
PORT="${PORT:-3456}"
if ! lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  NODE=""
  for c in "$HOME"/.nvm/versions/node/v22*/bin/node "$HOME"/.nvm/versions/node/v24*/bin/node "$HOME"/.nvm/versions/node/v20*/bin/node /opt/homebrew/bin/node /usr/local/bin/node node; do
    if command -v "$c" >/dev/null 2>&1 && [ "$("$c" -p 'parseInt(process.versions.node)')" -ge 18 ]; then NODE="$c"; break; fi
  done
  [ -z "$NODE" ] && { echo "找不到 Node 18 以上"; exit 1; }
  PORT=$PORT nohup "$NODE" server.js >> server.log 2>&1 &
  disown
  sleep 1
  echo "已在背景啟動（紀錄：server.log）"
else
  echo "已經在執行了"
fi
open "http://localhost:$PORT"
