#!/bin/bash
# Snag 停止脚本（仅停止由 `node server.js` 启动的进程）
pkill -f "node server.js" 2>/dev/null && echo "Snag 已停止" || echo "未发现运行中的 Snag 进程"
