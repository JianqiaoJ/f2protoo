# 安装 Node.js 和 npm

## 🔍 问题

`sudo: npm: command not found` 表示服务器上没有安装 Node.js 和 npm。

## 📋 安装步骤

### 方法 1: 使用 NodeSource 安装（推荐，最新版本）

在终端中执行以下命令：

```bash
# 1. 更新系统包列表
sudo apt update

# 2. 安装必要的工具
sudo apt install -y curl

# 3. 下载并运行 NodeSource 安装脚本（Node.js 20.x LTS版本）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# 4. 安装 Node.js 和 npm
sudo apt install -y nodejs

# 5. 验证安装
node -v
npm -v
```

### 方法 2: 使用 apt 直接安装（简单但版本可能较旧）

```bash
# 1. 更新系统包列表
sudo apt update

# 2. 安装 Node.js 和 npm
sudo apt install -y nodejs npm

# 3. 验证安装
node -v
npm -v
```

### 方法 3: 使用 nvm（Node Version Manager，推荐用于开发环境）

```bash
# 1. 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 2. 重新加载 shell 配置
source ~/.bashrc

# 3. 安装 Node.js LTS 版本
nvm install --lts

# 4. 使用安装的版本
nvm use --lts

# 5. 验证安装
node -v
npm -v
```

## 🎯 推荐操作

**建议使用方法 1**（NodeSource），因为：
- ✅ 安装最新稳定版本
- ✅ 包含 npm
- ✅ 适合生产环境

## 📝 完整安装命令（一键执行）

复制粘贴以下命令：

```bash
sudo apt update && sudo apt install -y curl && curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs && echo "==========================================" && echo "✓ Node.js 和 npm 安装完成" && echo "==========================================" && node -v && npm -v
```

## ✅ 安装完成后继续部署

安装完成后，继续执行部署命令：

```bash
cd /opt/music-player-backend
sudo npm install
sudo npm run init-db
sudo pkill -f 'node.*server.js' || true
sleep 2
nohup sudo node server.js > /var/log/music-player-backend.log 2>&1 &
sleep 2
sudo systemctl restart nginx
```

## 🔍 验证安装

安装完成后，应该看到类似输出：

```
v20.x.x
10.x.x
```

第一个是 Node.js 版本，第二个是 npm 版本。

## ⚠️ 注意事项

- 如果使用 `nvm`，可能需要为 root 用户单独安装，或者不使用 sudo
- 安装完成后，确保 `node` 和 `npm` 命令在 PATH 中
- 如果仍有问题，可以尝试：`which node` 和 `which npm` 查看路径
