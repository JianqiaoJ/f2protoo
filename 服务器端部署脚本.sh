#!/bin/bash

# 服务器端部署脚本
# 在服务器上执行此脚本进行部署
# 使用方法: sudo bash 服务器端部署脚本.sh

set -e

echo "=========================================="
echo "开始部署音乐播放器应用"
echo "=========================================="

# 检查部署包是否存在
if [ ! -f /tmp/deploy-package.tar.gz ]; then
    echo "错误: 部署包 /tmp/deploy-package.tar.gz 不存在"
    echo "请先上传 deploy-package.tar.gz 到 /tmp/ 目录"
    exit 1
fi

# 解压部署包
echo ""
echo "1. 解压部署包..."
cd /tmp
tar -xzf deploy-package.tar.gz
echo "✓ 解压完成"

# 部署前端
echo ""
echo "2. 部署前端..."
sudo mkdir -p /var/www/music-player
sudo rm -rf /var/www/music-player/*  # 清除旧文件
if [ -d /tmp/frontend/dist ]; then
    sudo cp -r /tmp/frontend/dist/* /var/www/music-player/
    sudo chown -R www-data:www-data /var/www/music-player
    echo "✓ 前端部署完成"
else
    echo "⚠ 警告: 前端文件不存在"
fi

# 部署后端
echo ""
echo "3. 部署后端..."
sudo mkdir -p /opt/music-player-backend
sudo rm -rf /opt/music-player-backend/*  # 清除旧文件
if [ -d /tmp/backend ]; then
    sudo cp -r /tmp/backend/* /opt/music-player-backend/
    echo "✓ 后端文件复制完成"
else
    echo "⚠ 警告: 后端文件不存在"
    exit 1
fi

if [ -f /tmp/raw.tsv ]; then
    sudo cp /tmp/raw.tsv /opt/music-player-backend/raw.tsv
    echo "✓ 数据文件复制完成"
else
    echo "⚠ 警告: raw.tsv 文件不存在"
fi

# 安装后端依赖
echo ""
echo "4. 安装后端依赖..."
cd /opt/music-player-backend
if [ -f package.json ]; then
    sudo npm install
    echo "✓ 依赖安装完成"
else
    echo "⚠ 警告: package.json 不存在"
fi

# 初始化数据库
echo ""
echo "5. 初始化数据库..."
if [ -f package.json ] && grep -q "init-db" package.json; then
    sudo npm run init-db || echo "数据库初始化完成或已存在"
else
    echo "⚠ 跳过数据库初始化（脚本不存在）"
fi

# 停止旧的后端服务
echo ""
echo "6. 停止旧服务..."
sudo pkill -f 'node.*server.js' || true
sleep 2
echo "✓ 旧服务已停止"

# 启动新的后端服务
echo ""
echo "7. 启动后端服务..."
cd /opt/music-player-backend
if [ -f server.js ]; then
    nohup sudo node server.js > /var/log/music-player-backend.log 2>&1 &
    sleep 2
    echo "✓ 后端服务已启动"
else
    echo "⚠ 错误: server.js 不存在"
    exit 1
fi

# 重启nginx
echo ""
echo "8. 重启Nginx..."
if systemctl is-active --quiet nginx; then
    sudo systemctl restart nginx
    echo "✓ Nginx 已重启"
else
    echo "⚠ 警告: Nginx 未运行，请检查配置"
fi

# 检查服务状态
echo ""
echo "=========================================="
echo "检查服务状态"
echo "=========================================="
echo ""
echo "后端进程:"
if ps aux | grep "node.*server.js" | grep -v grep; then
    echo "✓ 后端服务正在运行"
else
    echo "⚠ 后端服务未运行"
fi

echo ""
echo "Nginx状态:"
if systemctl is-active --quiet nginx; then
    echo "✓ Nginx 正在运行"
    sudo systemctl status nginx --no-pager | head -5
else
    echo "⚠ Nginx 未运行"
fi

echo ""
echo "端口监听:"
sudo netstat -tlnp | grep -E ':(80|3000)' || echo "⚠ 端口未监听"

echo ""
echo "=========================================="
echo "部署完成！"
echo "=========================================="
echo "前端访问地址: http://43.143.53.202"
echo "后端API地址: http://43.143.53.202:3000"
echo ""
echo "查看后端日志: tail -f /var/log/music-player-backend.log"
echo "查看Nginx日志: sudo tail -f /var/log/nginx/error.log"
echo "=========================================="
