# SSH 连接超时问题排查指南

## 🔍 问题诊断结果

**测试结果**:
- ✅ **服务器可达**: ping 测试成功（延迟 9-55ms）
- ❌ **SSH 端口不通**: 端口 22 连接超时

**结论**: 服务器在线，但 SSH 端口被阻止或未开放。

## 🎯 可能的原因

### 1. **防火墙阻止 SSH 端口**（最常见）

服务器上的防火墙（如 `ufw` 或 `iptables`）可能未开放端口 22。

### 2. **云服务商安全组规则**

如果服务器在云平台（阿里云、腾讯云、AWS等），安全组可能未允许 SSH 访问。

### 3. **SSH 服务未运行**

服务器上的 SSH 服务（sshd）可能未启动。

### 4. **SSH 端口被修改**

SSH 服务可能配置为使用非标准端口（非 22）。

### 5. **网络策略限制**

公司网络或 ISP 可能阻止了 SSH 连接。

## 🔧 解决方案

### 方案 1: 通过云服务商控制台登录（推荐）

如果服务器在云平台，使用控制台的 Web SSH 功能：

1. **阿里云**:
   - 登录阿里云控制台
   - 进入 ECS 实例管理
   - 点击"远程连接" → "Workbench远程连接"

2. **腾讯云**:
   - 登录腾讯云控制台
   - 进入 CVM 实例管理
   - 点击"登录" → "标准登录方式"

3. **AWS**:
   - 使用 AWS Systems Manager Session Manager
   - 或通过 EC2 Instance Connect

### 方案 2: 在服务器上配置防火墙

通过控制台登录后，执行以下命令：

```bash
# 检查防火墙状态
sudo ufw status

# 如果防火墙未启用，启用并开放SSH
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 3000/tcp
sudo ufw enable

# 或者检查 iptables
sudo iptables -L -n | grep 22
```

### 方案 3: 配置云服务商安全组

#### 阿里云安全组配置：
1. 登录阿里云控制台
2. 进入 **ECS** → **网络与安全** → **安全组**
3. 找到服务器对应的安全组
4. 点击 **配置规则** → **入方向**
5. 添加规则：
   - **规则方向**: 入方向
   - **授权策略**: 允许
   - **协议类型**: 自定义TCP
   - **端口范围**: 22/22
   - **授权对象**: 0.0.0.0/0（或您的IP地址）
   - **描述**: SSH访问

#### 腾讯云安全组配置：
1. 登录腾讯云控制台
2. 进入 **云服务器** → **安全组**
3. 找到服务器对应的安全组
4. 点击 **修改规则** → **入站规则**
5. 添加规则：
   - **类型**: 自定义
   - **来源**: 0.0.0.0/0
   - **协议端口**: TCP:22
   - **策略**: 允许

### 方案 4: 检查并启动 SSH 服务

```bash
# 检查 SSH 服务状态
sudo systemctl status sshd
# 或
sudo systemctl status ssh

# 如果未运行，启动服务
sudo systemctl start sshd
sudo systemctl enable sshd  # 设置开机自启

# 检查 SSH 端口配置
sudo grep Port /etc/ssh/sshd_config
```

### 方案 5: 使用其他端口（如果22端口被封）

如果端口 22 被 ISP 或网络策略阻止，可以配置 SSH 使用其他端口：

```bash
# 编辑 SSH 配置
sudo nano /etc/ssh/sshd_config

# 修改或添加：
Port 2222  # 或其他端口，如 22022

# 重启 SSH 服务
sudo systemctl restart sshd

# 开放新端口
sudo ufw allow 2222/tcp
```

然后使用新端口连接：
```bash
ssh -p 2222 ubuntu@43.143.53.202
```

## 📋 快速检查清单

通过控制台登录服务器后，执行以下检查：

```bash
# 1. 检查防火墙状态
sudo ufw status verbose

# 2. 检查 SSH 服务
sudo systemctl status sshd

# 3. 检查端口监听
sudo netstat -tlnp | grep :22
# 或
sudo ss -tlnp | grep :22

# 4. 检查 iptables 规则
sudo iptables -L -n -v | grep 22

# 5. 检查 SSH 配置
sudo grep -E "^Port|^ListenAddress" /etc/ssh/sshd_config

# 6. 查看 SSH 日志
sudo tail -f /var/log/auth.log
# 或
sudo journalctl -u sshd -f
```

## 🚀 临时解决方案：使用 SFTP 客户端

如果 SSH 暂时无法修复，可以使用 SFTP 客户端上传文件：

### 使用 FileZilla：

1. **下载**: https://filezilla-project.org/
2. **连接设置**:
   - 协议: **SFTP** (不是 FTP)
   - 主机: `43.143.53.202`
   - 端口: `22` (如果 SFTP 可用) 或尝试 `2222`
   - 用户名: `ubuntu`
   - 密码: `PwUb]2~T^nrc4K3`

3. **如果 SFTP 也超时**:
   - 尝试使用 **FTP over TLS** (端口 21)
   - 或通过云服务商的文件管理功能上传

### 使用云服务商文件管理：

- **阿里云**: 通过控制台的文件管理功能
- **腾讯云**: 通过控制台的文件管理功能
- **AWS**: 使用 S3 或其他存储服务

## 🔐 安全建议

1. **限制 SSH 访问 IP**: 在安全组中只允许特定 IP 访问
2. **使用密钥认证**: 禁用密码登录，使用 SSH 密钥
3. **修改默认端口**: 使用非标准端口减少扫描攻击
4. **启用 fail2ban**: 防止暴力破解

## 📞 需要帮助？

如果以上方法都无法解决，请：

1. 检查云服务商的控制台，查看安全组规则
2. 联系云服务商技术支持
3. 检查服务器提供商是否有特殊网络限制

## 💡 部署建议

由于 SSH 连接问题，建议：

1. **优先使用云服务商控制台**登录服务器
2. **通过控制台配置防火墙和安全组**
3. **使用 SFTP 客户端**上传部署文件
4. **在服务器上直接执行部署脚本**

部署文件已准备好：
- `deploy-package.tar.gz` - 部署包
- `服务器端部署脚本.sh` - 自动化部署脚本
