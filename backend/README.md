# 后端服务

## 安装依赖

```bash
cd backend
npm install
```

## 初始化数据库

首次运行前，需要初始化数据库：

```bash
npm run init-db
```

这将会：
- 创建 `users.db` SQLite 数据库文件
- 创建 `users` 表
- 插入初始用户数据（user1/12, user2/24, user3/36）

## 启动服务器

```bash
npm start
```

服务器将在 `http://localhost:3000` 启动

## API 端点

### POST /api/auth/login
用户登录验证

请求体：
```json
{
  "username": "user1",
  "password": "12"
}
```

响应：
```json
{
  "success": true,
  "message": "登录成功",
  "user": {
    "username": "user1",
    "id": 1
  }
}
```

### GET /api/users
获取所有用户列表（仅用于测试）

### POST /api/users
创建新用户

请求体：
```json
{
  "username": "newuser",
  "password": "password"
}
```

## 数据库文件

数据库文件 `users.db` 位于 `backend/` 目录下。

## 数据库表结构

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```
