#!/bin/bash

echo "=========================================="
echo "Jamendo 音乐播放器 - 启动脚本"
echo "=========================================="

# 检查是否在正确的目录
if [ ! -d "frontend" ]; then
    echo "错误: 请在项目根目录运行此脚本"
    exit 1
fi

# 进入前端目录
cd frontend

# 检查 node_modules 是否存在
if [ ! -d "node_modules" ]; then
    echo "检测到未安装依赖，正在安装..."
    npm install
    if [ $? -ne 0 ]; then
        echo "依赖安装失败，请检查网络连接和npm配置"
        exit 1
    fi
    echo "依赖安装完成！"
fi

# 检查 public/raw.tsv 是否存在
if [ ! -f "public/raw.tsv" ]; then
    echo "复制 raw.tsv 到 public 目录..."
    if [ -f "../raw.tsv" ]; then
        cp ../raw.tsv public/raw.tsv
        echo "raw.tsv 已复制"
    else
        echo "警告: 未找到 raw.tsv 文件"
    fi
fi

echo ""
echo "启动开发服务器..."
echo "应用将在 http://localhost:5174 启动"
echo "按 Ctrl+C 停止服务器"
echo ""

# 启动开发服务器
npm run dev
