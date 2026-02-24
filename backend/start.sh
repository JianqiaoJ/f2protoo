#!/bin/bash
# 在服务器上启动后端，日志写在当前目录 backend.log，便于排查 502
cd "$(dirname "$0")"
LOG=backend.log
echo "=== $(date -Iseconds) 启动 ===" >> "$LOG"
pkill -f 'node.*server.js' 2>/dev/null || true
sleep 2
nohup node server.js >> "$LOG" 2>&1 &
sleep 2
if pgrep -f 'node.*server.js' >/dev/null; then
  echo "后端已启动，日志: $PWD/$LOG"
else
  echo "启动失败，请查看: tail -50 $PWD/$LOG"
  exit 1
fi
