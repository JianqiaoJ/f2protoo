#!/bin/bash
# 部署：构建前端 → 覆盖 backend/public → 同步到服务器 → npm install 并启动 systemd
# 使用方式: DEPLOY_HOST=43.143.53.202 DEPLOY_USER=ubuntu SSHPASS='密码' ./deploy.sh
set -e
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
DEPLOY_HOST="${DEPLOY_HOST:-106.15.32.248}"
DEPLOY_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/f2proto}"

echo "==> 目标: ${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DIR}"

# 1. 构建前端（保证左上角「更新时间」为当前构建时间）
echo "==> 构建前端..."
(cd "$FRONTEND_DIR" && VITE_API_BASE_URL= npm run build)

# 2. 清空并覆盖 backend/public，避免残留旧 hash 的 js/css
echo "==> 更新 backend/public..."
rm -rf "$BACKEND_DIR/public"
mkdir -p "$BACKEND_DIR/public"
cp -r "$FRONTEND_DIR/dist/"* "$BACKEND_DIR/public/"

# 3. raw.tsv
if [ ! -f "$BACKEND_DIR/raw.tsv" ] && [ -f "$ROOT_DIR/raw.tsv" ]; then
  cp "$ROOT_DIR/raw.tsv" "$BACKEND_DIR/raw.tsv"
  echo "==> 已复制 raw.tsv 到 backend"
fi

# 4. 同步 backend（不删远程目录，避免 cannot delete non-empty directory；public 单独用 --delete 覆盖）
RSYNC_OPTS=(-az
  --exclude 'node_modules'
  --exclude 'users.db'
  --exclude '.git'
  --exclude '*.log'
)
if [ -n "${SSHPASS}" ]; then
  export RSYNC_RSH="sshpass -e ssh -o StrictHostKeyChecking=accept-new"
  rsync "${RSYNC_OPTS[@]}" "$BACKEND_DIR/" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DIR}/"
else
  rsync "${RSYNC_OPTS[@]}" -e "ssh -o StrictHostKeyChecking=accept-new" "$BACKEND_DIR/" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DIR}/"
fi
# 强制 public 与本地一致，删除服务器上多余的旧资源
RSYNC_PUBLIC=(-az --delete)
if [ -n "${SSHPASS}" ]; then
  rsync "${RSYNC_PUBLIC[@]}" "$BACKEND_DIR/public/" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DIR}/public/"
else
  rsync "${RSYNC_PUBLIC[@]}" -e "ssh -o StrictHostKeyChecking=accept-new" "$BACKEND_DIR/public/" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DIR}/public/"
fi

echo "==> 在服务器上安装依赖并启动..."
# 将 systemd 服务文件中的路径和用户替换为当前 REMOTE_DIR 和 DEPLOY_USER
# 若服务器有 nginx 使用 /var/www/app 提供前端，则把本次部署的 public 同步过去，否则用户通过 80 端口看到的仍是旧版
RUN="cd ${REMOTE_DIR} && sed -i.bak \"s|/opt/f2proto|${REMOTE_DIR}|g; s|User=root|User=${DEPLOY_USER}|g\" f2proto.service && npm install --production && sudo cp ${REMOTE_DIR}/f2proto.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable f2proto && sudo systemctl stop f2proto 2>/dev/null; sleep 3; sudo lsof -ti:3000 | xargs -r sudo kill -9 2>/dev/null; sleep 2; sudo systemctl start f2proto && sleep 2; if [ -d /var/www/app ]; then sudo rsync -a --delete ${REMOTE_DIR}/public/ /var/www/app/ && sudo chown -R www-data:www-data /var/www/app && echo 'Synced frontend to nginx /var/www/app'; fi"
if [ -n "${SSHPASS}" ]; then
  sshpass -e ssh -o StrictHostKeyChecking=accept-new "${DEPLOY_USER}@${DEPLOY_HOST}" "$RUN"
else
  ssh -o StrictHostKeyChecking=accept-new "${DEPLOY_USER}@${DEPLOY_HOST}" "$RUN"
fi

# 若服务未运行则打印错误日志
SHOW_STATUS="sudo systemctl status f2proto --no-pager; if ! systemctl is-active --quiet f2proto; then echo '--- server.log ---'; tail -80 ${REMOTE_DIR}/server.log 2>/dev/null || true; echo '--- journalctl ---'; sudo journalctl -u f2proto -n 40 --no-pager 2>/dev/null || true; fi"
if [ -n "${SSHPASS}" ]; then
  sshpass -e ssh -o StrictHostKeyChecking=accept-new "${DEPLOY_USER}@${DEPLOY_HOST}" "$SHOW_STATUS"
else
  ssh -o StrictHostKeyChecking=accept-new "${DEPLOY_USER}@${DEPLOY_HOST}" "$SHOW_STATUS"
fi

echo "==> 部署完成。若使用 nginx 反向代理，请访问: http://${DEPLOY_HOST}  或直连: http://${DEPLOY_HOST}:3000"
