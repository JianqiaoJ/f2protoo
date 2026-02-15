# Jamendo 音乐播放器

一个经典极简设计风格的音乐播放界面，使用 Jamendo API 获取免费音乐。

## 功能特性

- 🎵 在线音乐播放
- 🖼️ 专辑封面展示
- ⭐ 1-5 分评分系统
- ❤️ 收藏歌曲功能
- 📋 收藏列表展示
- 🔄 下一首推荐切换
- 💾 本地存储收藏记录

## 技术栈

- React 18 + TypeScript
- Vite
- TailwindCSS
- Zustand (状态管理)
- Axios (HTTP 请求)

## 快速开始

### 1. 安装依赖

```bash
cd frontend
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

应用将在 http://localhost:5174 启动

### 3. 构建生产版本

```bash
npm run build
```

## 项目结构

```
f2proto/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── MusicPlayer.tsx    # 主播放器组件
│   │   │   └── FavoritesList.tsx  # 收藏列表组件
│   │   ├── api.ts                 # Jamendo API 集成
│   │   ├── store.ts               # Zustand 状态管理
│   │   ├── types.ts               # TypeScript 类型定义
│   │   ├── App.tsx                # 主应用组件
│   │   └── main.tsx               # 入口文件
│   ├── public/
│   │   └── raw.tsv                # 歌曲ID列表
│   └── package.json
└── raw.tsv                         # 原始数据文件
```

## 使用说明

1. **播放音乐**：应用启动后会自动加载第一首歌曲
2. **播放/暂停**：点击中央的播放按钮
3. **评分**：点击星星进行1-5分评分
4. **收藏**：点击"收藏"按钮将歌曲添加到收藏列表
5. **下一首**：点击"下一首推荐"按钮切换到下一首歌曲
6. **查看收藏**：右侧面板显示所有收藏的歌曲，点击可播放

## Jamendo API

使用 Jamendo Client ID: `1ccf1f44`

API 文档参考：https://devportal.jamendo.com/admin/applications/1409626611808

## 数据来源

歌曲ID从 `raw.tsv` 文件中按顺序读取，格式为：
```
TRACK_ID	ARTIST_ID	ALBUM_ID	...
track_0000214	artist_000014	album_000031	...
```

## 注意事项

- 需要网络连接以访问 Jamendo API
- 收藏数据存储在浏览器本地存储中
- 某些歌曲可能无法在 Jamendo 上找到，会自动跳过
