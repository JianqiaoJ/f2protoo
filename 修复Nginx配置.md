# 修复 Nginx 配置

## 🔍 问题诊断

从诊断结果看到：
- ❌ **Nginx错误日志**显示在查找 `/var/www/html/music-player/vite.svg`
- ❌ **本地测试**返回 500 错误
- ✅ 前端文件实际在 `/var/www/html/`
- ⚠️ Nginx配置可能指向了 `/var/www/html/music-player`

## 🔧 修复步骤

### 步骤 1: 检查并修复 Nginx 配置

```bash
# 1. 查看当前Nginx配置中的root路径
sudo nginx -T 2>&1 | grep -A 5 "root"

# 2. 查找所有配置文件
sudo find /etc/nginx -name "*.conf" -type f

# 3. 检查sites-enabled目录
sudo ls -la /etc/nginx/sites-enabled/
sudo cat /etc/nginx/sites-enabled/* 2>/dev/null
```

### 步骤 2: 修复配置指向正确目录

如果配置指向 `/var/www/html/music-player`，需要修改为 `/var/www/html`：

```bash
# 方法1: 使用sed修改（如果配置文件存在）
sudo sed -i 's|root /var/www/html/music-player|root /var/www/html|g' /etc/nginx/sites-enabled/default
sudo sed -i 's|root /var/www/html/music-player|root /var/www/html|g' /etc/nginx/sites-available/default

# 方法2: 或者创建新的配置文件
sudo nano /etc/nginx/sites-available/default
```

### 步骤 3: 创建正确的 Nginx 配置

如果配置文件不存在或需要重新创建：

```bash
# 创建配置文件
sudo tee /etc/nginx/sites-available/default > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    
    root /var/www/html;
    index index.html index.htm;
    
    server_name _;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://localhost:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# 创建符号链接（如果不存在）
sudo ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# 测试配置
sudo nginx -t

# 重启Nginx
sudo systemctl restart nginx
```

### 步骤 4: 清理后端进程

```bash
# 停止所有后端进程
sudo pkill -9 -f "node.*server.js"
sleep 2

# 确认没有残留进程
ps aux | grep "node.*server.js" | grep -v grep

# 启动单个后端服务
cd /opt/music-player-backend
nohup sudo node server.js > /var/log/music-player-backend.log 2>&1 &
sleep 3

# 检查进程
ps aux | grep "node.*server.js" | grep -v grep
```

## 🎯 一键修复命令（推荐）

复制粘贴以下完整命令：

```bash
# 1. 停止所有服务
sudo pkill -9 -f "node.*server.js" && sudo systemctl stop nginx

# 2. 修复Nginx配置（创建正确的配置）
sudo tee /etc/nginx/sites-available/default > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    
    root /var/www/html;
    index index.html index.htm;
    
    server_name _;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://localhost:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# 3. 创建符号链接
sudo ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# 4. 测试并重启Nginx
sudo nginx -t && sudo systemctl start nginx

# 5. 启动单个后端服务
cd /opt/music-player-backend && nohup sudo node server.js > /var/log/music-player-backend.log 2>&1 & sleep 3

# 6. 验证
echo "=== 修复完成 ===" && echo "Nginx状态:" && sudo systemctl is-active nginx && echo "后端进程数:" && ps aux | grep "node.*server.js" | grep -v grep | wc -l && echo "本地测试:" && curl -s http://localhost | head -10
```

## 🔍 验证修复

修复后，执行：

```bash
# 1. 检查Nginx配置
sudo nginx -T 2>&1 | grep "root"

# 2. 测试本地访问
curl http://localhost

# 3. 应该返回HTML内容，而不是500错误
```

## 💡 如果还有问题

如果执行后仍有问题，检查：

1. **Nginx配置语法**：`sudo nginx -t`
2. **文件权限**：`sudo ls -la /var/www/html/`
3. **Nginx错误日志**：`sudo tail -20 /var/log/nginx/error.log`
