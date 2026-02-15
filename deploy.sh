#!/bin/bash

# 部署脚本（最新代码 → 43.143.53.202）
# 使用方法: ./deploy.sh
# 密码可选: export F2PROTO_SSH_PASS='你的SSH密码' 再执行 ./deploy.sh（推荐，避免密码写进脚本）

SERVER_IP="43.143.53.202"
SERVER_USER="ubuntu"
SERVER_PASS="${F2PROTO_SSH_PASS:-}"

if [ -z "$SERVER_PASS" ]; then
  echo "请设置环境变量: export F2PROTO_SSH_PASS='你的SSH密码'"
  echo "或编辑本脚本填写 SERVER_PASS"
  exit 1
fi

echo "开始部署到服务器 $SERVER_IP..."

# 1. 构建前端（API 指向服务器地址，部署后浏览器才能正确请求后端）
echo "1. 构建前端 (VITE_API_BASE_URL=http://$SERVER_IP，API 走 Nginx /api/ 代理)..."
cd frontend
# 使用同源（走 Nginx 代理 /api/ -> localhost:3000），避免暴露 3000 端口
export VITE_API_BASE_URL="http://${SERVER_IP}"
npm run build
cd ..

# 2. 上传前端文件
echo "2. 上传前端文件..."
sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no -r frontend/dist $SERVER_USER@$SERVER_IP:/tmp/f2proto-frontend-dist

# 3. 上传后端文件
echo "3. 上传后端文件..."
sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no -r backend $SERVER_USER@$SERVER_IP:/tmp/f2proto-backend

# 4. 上传 raw.tsv 与 推荐算法设计文档.md
echo "4. 上传 raw.tsv 和 推荐算法设计文档.md..."
sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no raw.tsv $SERVER_USER@$SERVER_IP:/tmp/f2proto-raw.tsv
[ -f "推荐算法设计文档.md" ] && sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no 推荐算法设计文档.md $SERVER_USER@$SERVER_IP:/tmp/f2proto-doc.md

# 4.5 清空服务器上已部署内容后再部署
echo "4.5 清空服务器上已部署内容..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP << 'ENDSSH'
sudo pkill -f 'node.*server.js' || true
sudo rm -rf /var/www/app/*
sudo rm -rf /opt/music-player-backend/*
echo "已清空 /var/www/app 和 /opt/music-player-backend"
ENDSSH

# 5. 部署前端（写入 Nginx 实际使用的 root：/var/www/app）
echo "5. 部署前端到 /var/www/app（Nginx root）..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP << 'ENDSSH'
sudo mkdir -p /var/www/app
sudo cp -r /tmp/f2proto-frontend-dist/* /var/www/app/
sudo chown -R www-data:www-data /var/www/app
echo "前端已更新到 /var/www/app"
ENDSSH

# 6. 部署后端到 /opt/music-player-backend
echo "6. 部署后端到 /opt/music-player-backend..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP << 'ENDSSH'
sudo mkdir -p /opt/music-player-backend
sudo cp -r /tmp/f2proto-backend/* /opt/music-player-backend/
sudo cp /tmp/f2proto-raw.tsv /opt/music-player-backend/raw.tsv
[ -f /tmp/f2proto-doc.md ] && sudo cp /tmp/f2proto-doc.md /opt/推荐算法设计文档.md
cd /opt/music-player-backend
sudo npm install
sudo npm run init-db
echo "后端已更新到 /opt/music-player-backend"
ENDSSH

# 7. 重启后端与 Nginx
echo "7. 重启服务..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no $SERVER_USER@$SERVER_IP << 'ENDSSH'
sudo pkill -f 'node.*server.js' || true
sleep 2
sudo bash -c 'cd /opt/music-player-backend && nohup node server.js >> /var/log/music-player-backend.log 2>&1 &'
sudo systemctl restart nginx
echo "后端已从 /opt/music-player-backend 启动，Nginx 已重启"
ENDSSH

echo "部署完成！"
echo "前端访问地址: http://$SERVER_IP"
echo "后端API（经 Nginx /api/ 代理）: http://$SERVER_IP/api/"
