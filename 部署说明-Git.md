# 通过 Git 在服务器上部署 f2proto

仓库地址：`https://github.com/JianqiaoJ/f2protoo.git`

---

## 一、服务器准备

- 已安装 **Node.js**（建议 v18+）和 **npm**
- 若用 Nginx 提供前端页面，需已安装 **nginx**
- 放行端口：**3000**（后端）、**80/443**（前端，若用 Nginx）

---

## 二、克隆代码

```bash
cd /opt   # 或你希望的目录
sudo git clone https://github.com/JianqiaoJ/f2protoo.git
cd f2protoo
```

以后更新代码：

```bash
cd /opt/f2protoo
sudo git pull origin main
```

---

## 三、后端部署

```bash
cd /opt/f2protoo/backend

# 1. 安装依赖
sudo npm install

# 2. 确保 raw.tsv 存在（项目根目录有，recommender 会读 ../raw.tsv）
# 若没有，从项目根复制：cp /opt/f2protoo/raw.tsv ./

# 3. 初始化数据库
sudo node init-db.js

# 4. 启动后端（端口 3000）
# 方式 A：前台运行（测试用，关终端会停）
sudo node server.js

# 方式 B：后台常驻（推荐）
nohup sudo node server.js > backend.log 2>&1 &

# 方式 C：用 pm2 管理（需先 npm i -g pm2）
# pm2 start server.js --name f2proto-backend
```

确认后端正常：`curl http://localhost:3000/api/users` 有返回即可。

---

## 四、前端构建与 API 地址

构建时要把前端请求的后端地址改成**你服务器的地址**。

把下面的 `你的服务器IP或域名` 换成实际地址（例如 `43.143.53.202` 或 `api.example.com`）：

```bash
cd /opt/f2protoo/frontend

# 安装依赖
sudo npm install

# 重要：指定后端 API 地址再构建（用户浏览器会请求这个地址）
export VITE_API_BASE_URL="http://你的服务器IP或域名:3000"
sudo npm run build
```

构建完成后，静态文件在 `frontend/dist` 目录。

---

## 五、前端访问方式

### 方式 A：用 Nginx 提供前端页面（推荐）

1. 把构建好的 `dist` 拷到 Nginx 目录：

```bash
sudo mkdir -p /var/www/f2proto
sudo cp -r /opt/f2protoo/frontend/dist/* /var/www/f2proto/
```

2. Nginx 配置示例（`/etc/nginx/sites-available/f2proto` 或 conf.d 下）：

```nginx
server {
    listen 80;
    server_name 你的服务器IP或域名;
    root /var/www/f2proto;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    location /raw.tsv {
        alias /var/www/f2proto/raw.tsv;
    }
}
```

3. 启用并重载 Nginx：

```bash
sudo ln -sf /etc/nginx/sites-available/f2proto /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

访问：`http://你的服务器IP或域名`

### 方式 B：用 Vite 自带的预览（仅测试用）

```bash
cd /opt/f2protoo/frontend
sudo npm run preview
```

默认端口 4173，仅适合临时测试。

---

## 六、一次性部署脚本示例（在服务器上执行）

把 `你的服务器IP或域名` 换成实际值后，在服务器上执行：

```bash
cd /opt
sudo git clone https://github.com/JianqiaoJ/f2protoo.git
cd f2protoo

# 后端
cd backend && sudo npm install && sudo node init-db.js && cd ..
nohup sudo node backend/server.js > backend/backend.log 2>&1 &

# 前端（替换为你的 IP 或域名）
cd frontend
export VITE_API_BASE_URL="http://你的服务器IP或域名:3000"
sudo npm install && sudo npm run build
sudo mkdir -p /var/www/f2proto && sudo cp -r dist/* /var/www/f2proto/
cd ..
```

然后按上面 Nginx 配置好并重载，即可通过浏览器访问。

---

## 七、更新部署（代码有更新时）

```bash
cd /opt/f2protoo
sudo git pull origin main

# 后端：重启
sudo pkill -f 'node.*server.js' || true
sleep 2
cd backend && nohup sudo node server.js > backend.log 2>&1 &
cd ..

# 前端：重新构建并拷贝
cd frontend
export VITE_API_BASE_URL="http://你的服务器IP或域名:3000"
sudo npm run build
sudo cp -r dist/* /var/www/f2proto/
cd ..
```

---

## 八、注意

- **VITE_API_BASE_URL** 必须是用户浏览器能访问的地址（公网 IP 或域名 + 端口 3000），否则前端会请求失败。
- 若用域名且希望用 80/443 而不带端口，可再在 Nginx 里给 `/api` 做反向代理到 `http://127.0.0.1:3000`，并把 `VITE_API_BASE_URL` 设为 `http://你的域名`（或 https）。
- 后端数据库和文件在 `backend/users.db` 和当前目录，更新代码时注意不要误删或覆盖。
