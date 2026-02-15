#!/bin/bash

# 自动部署脚本
# 使用方法: ./自动部署.sh

SERVER_IP="43.143.53.202"
SERVER_USER="ubuntu"
SERVER_PASS="PwUb]2~T^nrc4K3"

echo "=========================================="
echo "开始部署到服务器 $SERVER_IP"
echo "=========================================="

# 检查 sshpass
if ! command -v sshpass &> /dev/null; then
    echo "错误: 未安装 sshpass"
    echo "请运行: brew install sshpass (macOS) 或 sudo apt-get install sshpass (Linux)"
    exit 1
fi

# 1. 构建前端
echo ""
echo "1. 构建前端..."
cd frontend
npm run build
if [ $? -ne 0 ]; then
    echo "错误: 前端构建失败"
    exit 1
fi
cd ..
echo "✓ 前端构建完成"

# 2. 创建部署包
echo ""
echo "2. 创建部署包..."
tar -czf deploy-package.tar.gz frontend/dist backend raw.tsv
if [ $? -ne 0 ]; then
    echo "错误: 创建部署包失败"
    exit 1
fi
echo "✓ 部署包创建完成: deploy-package.tar.gz"

# 3. 上传部署包
echo ""
echo "3. 上传部署包到服务器..."
sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no -o ConnectTimeout=30 deploy-package.tar.gz $SERVER_USER@$SERVER_IP:/tmp/
if [ $? -ne 0 ]; then
    echo "错误: 上传失败，可能是网络问题或SSH连接超时"
    echo ""
    echo "请尝试手动上传:"
    echo "  scp deploy-package.tar.gz $SERVER_USER@$SERVER_IP:/tmp/"
    echo "或使用 SFTP 客户端上传到 /tmp/deploy-package.tar.gz"
    exit 1
fi
echo "✓ 部署包上传完成"

# 4. 在服务器上执行部署
echo ""
echo "4. 在服务器上执行部署..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 $SERVER_USER@$SERVER_IP << 'ENDSSH'
set -e

echo "开始服务器端部署..."

# 解压部署包
echo "解压部署包..."
cd /tmp
tar -xzf deploy-package.tar.gz

# 部署前端
echo "部署前端..."
sudo mkdir -p /var/www/music-player
sudo rm -rf /var/www/music-player/*  # 清除旧文件
sudo cp -r frontend/dist/* /var/www/music-player/
sudo chown -R www-data:www-data /var/www/music-player
echo "✓ 前端部署完成"

# 部署后端
echo "部署后端..."
sudo mkdir -p /opt/music-player-backend
sudo rm -rf /opt/music-player-backend/*  # 清除旧文件
sudo cp -r backend/* /opt/music-player-backend/
sudo cp raw.tsv /opt/music-player-backend/raw.tsv

# 安装后端依赖
echo "安装后端依赖..."
cd /opt/music-player-backend
sudo npm install

# 初始化数据库
echo "初始化数据库..."
sudo npm run init-db || echo "数据库初始化完成或已存在"

# 停止旧的后端服务
echo "停止旧服务..."
sudo pkill -f 'node.*server.js' || true
sleep 2

# 启动新的后端服务
echo "启动后端服务..."
cd /opt/music-player-backend
nohup sudo node server.js > /var/log/music-player-backend.log 2>&1 &
sleep 2

# 重启nginx
echo "重启Nginx..."
sudo systemctl restart nginx || echo "Nginx重启失败，请检查配置"

# 检查服务状态
echo ""
echo "检查服务状态..."
echo "后端进程:"
ps aux | grep "node.*server.js" | grep -v grep || echo "⚠ 后端服务未运行"
echo ""
echo "Nginx状态:"
sudo systemctl status nginx --no-pager | head -5 || echo "⚠ 无法获取Nginx状态"

echo ""
echo "=========================================="
echo "部署完成！"
echo "=========================================="
echo "前端访问地址: http://43.143.53.202"
echo "后端API地址: http://43.143.53.202:3000"
echo "查看后端日志: tail -f /var/log/music-player-backend.log"
ENDSSH

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✓ 部署成功完成！"
    echo "=========================================="
    echo "前端访问地址: http://$SERVER_IP"
    echo "后端API地址: http://$SERVER_IP:3000"
else
    echo ""
    echo "=========================================="
    echo "⚠ 部署过程中出现错误"
    echo "=========================================="
    echo "请检查上面的错误信息，或使用手动部署方式"
fi
