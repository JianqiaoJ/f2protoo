#!/bin/bash
# 在 43.143.53.202 上运行此脚本完成前端部署
# 用法: 上传到服务器后 chmod +x deploy-to-server.sh && ./deploy-to-server.sh

set -e
SERVER_IP="43.143.53.202"
PROJECT_ROOT="/opt/f2protoo"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
NGINX_ROOT="/var/www/f2proto"

echo "==> 1. 进入项目目录（若 /opt/f2protoo 无写权限则需先 sudo chown -R ubuntu:ubuntu /opt/f2protoo）"
cd "$PROJECT_ROOT" || { echo "错误: $PROJECT_ROOT 不存在或无权限"; exit 1; }

echo "==> 2. 拉取最新代码"
git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || true

echo "==> 3. 修复 SystemEyesModal 未使用变量（若存在）"
FILE="$FRONTEND_DIR/src/components/SystemEyesModal.tsx"
if [ -f "$FILE" ] && grep -q "THEME_GRADIENT" "$FILE"; then
  sed -i.bak "/const THEME_GRADIENT = /d" "$FILE" && echo "    已移除 THEME_GRADIENT"
fi

echo "==> 4. 安装依赖并构建前端"
cd "$FRONTEND_DIR"
export VITE_API_BASE_URL="http://${SERVER_IP}:3000"
npm ci 2>/dev/null || npm install
npm run build

echo "==> 5. 部署到 Nginx 目录"
sudo mkdir -p "$NGINX_ROOT"
sudo cp -r dist/* "$NGINX_ROOT/"
echo "    已复制 dist -> $NGINX_ROOT"

echo "==> 6. 重载 Nginx"
sudo nginx -t && sudo systemctl reload nginx && echo "    Nginx 已重载"

echo ""
echo "部署完成。请访问: http://${SERVER_IP}"
echo "若无法访问，请检查: sudo grep -r 'root ' /etc/nginx/sites-enabled/"
echo "确保有 root $NGINX_ROOT; 和 try_files \$uri \$uri/ /index.html;"
