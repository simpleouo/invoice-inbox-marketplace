#!/bin/zsh
# 停止發票收件匣
pkill -f "node server.js" && echo "已停止" || echo "本來就沒在執行"
