#!/bin/bash

# 部署脚本
# 使用方法: ./deploy.sh

SERVER_IP="43.143.53.202"
SERVER_USER="ubuntu"
SERVER_PASS="PwUb]2~T^nrc4K3"

echo "开始部署到服务器 $SERVER_IP..."

# 1. 构建前端（API 指向服务器地址，部署后浏览器才能正确请求后端）
echo "1. 构建前端 (VITE_API_BASE_URL=http://$SERVER_IP:3000)..."
cd frontend
export VITE_API_BASE_URL="http://${SERVER_IP}:3000"
npm run build
cd ..

# 2. 上传前端文件
echo "2. 上传前端文件..."
sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no -r frontend/dist $SERVER_USER@$SERVER_IP:/tmp/f2proto-frontend-dist

# 3. 上传后端文件
echo "3. 上传后端文件..."
sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no -r backend $SERVER_USER@$SERVER_IP:/tmp/f2proto-backend

# 4. 上传raw.tsv文件
echo "4. 上传raw.tsv文件..."
sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no raw.tsv $SERVER_USER@$SERVER_IP:/tmp/f2proto-raw.tsv

# 5. 部署前端到nginx目录
echo "5. 部署前端到nginx目录..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP << 'ENDSSH'
sudo mkdir -p /var/www/music-player
sudo cp -r /tmp/f2proto-frontend-dist/* /var/www/music-player/
sudo chown -R www-data:www-data /var/www/music-player
echo "前端文件部署完成"
ENDSSH

# 6. 部署后端
echo "6. 部署后端..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP << 'ENDSSH'
sudo mkdir -p /opt/music-player-backend
sudo cp -r /tmp/f2proto-backend/* /opt/music-player-backend/
sudo cp /tmp/f2proto-raw.tsv /opt/music-player-backend/raw.tsv
cd /opt/music-player-backend
sudo npm install
sudo npm run init-db
echo "后端文件部署完成"
ENDSSH

# 7. 重启服务
echo "7. 重启服务..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP << 'ENDSSH'
# 停止旧的后端服务
sudo pkill -f 'node.*server.js' || true
sleep 2

# 启动新的后端服务（日志写到应用目录，避免权限问题）
cd /opt/music-player-backend
nohup sudo node server.js > backend.log 2>&1 &

# 重启nginx
sudo systemctl restart nginx

echo "服务重启完成"
ENDSSH

echo "部署完成！"
echo "前端访问地址: http://$SERVER_IP"
echo "后端API地址: http://$SERVER_IP:3000"
