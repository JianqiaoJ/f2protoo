#!/bin/bash

# 在服务器上执行的部署命令
# 使用方法：将此脚本上传到服务器后执行，或直接复制命令到服务器执行

echo "开始部署..."

# 解压部署包（如果已上传）
if [ -f /tmp/deploy-package.tar.gz ]; then
    echo "解压部署包..."
    cd /tmp
    tar -xzf deploy-package.tar.gz
fi

# 部署前端
echo "部署前端..."
sudo mkdir -p /var/www/music-player
sudo rm -rf /var/www/music-player/*  # 清除旧文件
if [ -d /tmp/frontend/dist ]; then
    sudo cp -r /tmp/frontend/dist/* /var/www/music-player/
else
    echo "警告: 前端文件不存在"
fi
sudo chown -R www-data:www-data /var/www/music-player
echo "前端部署完成"

# 部署后端
echo "部署后端..."
sudo mkdir -p /opt/music-player-backend
sudo rm -rf /opt/music-player-backend/*  # 清除旧文件
if [ -d /tmp/backend ]; then
    sudo cp -r /tmp/backend/* /opt/music-player-backend/
else
    echo "警告: 后端文件不存在"
fi
if [ -f /tmp/raw.tsv ]; then
    sudo cp /tmp/raw.tsv /opt/music-player-backend/raw.tsv
else
    echo "警告: raw.tsv文件不存在"
fi

# 安装后端依赖
echo "安装后端依赖..."
cd /opt/music-player-backend
sudo npm install

# 初始化数据库
echo "初始化数据库..."
sudo npm run init-db

# 停止旧的后端服务
echo "停止旧服务..."
sudo pkill -f 'node.*server.js' || true
sleep 2

# 启动新的后端服务
echo "启动后端服务..."
cd /opt/music-player-backend
nohup sudo node server.js > /var/log/music-player-backend.log 2>&1 &

# 重启nginx
echo "重启Nginx..."
sudo systemctl restart nginx

# 检查服务状态
echo "检查服务状态..."
echo "后端进程:"
ps aux | grep "node.*server.js" | grep -v grep || echo "后端服务未运行"
echo ""
echo "Nginx状态:"
sudo systemctl status nginx --no-pager | head -5

echo ""
echo "部署完成！"
echo "前端访问地址: http://43.143.53.202"
echo "后端API地址: http://43.143.53.202:3000"
echo "查看后端日志: tail -f /var/log/music-player-backend.log"
