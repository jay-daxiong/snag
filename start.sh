#!/bin/bash
# Snag 本地 / 自托管启动脚本
# 说明：Render 等平台会自动执行 `node server.js`，不需要本脚本。
#       本脚本仅用于在本机或自有服务器上手动启动。
PORT="${PORT:-8787}"
echo "启动 Snag 服务 (PORT=$PORT) ..."
node server.js
