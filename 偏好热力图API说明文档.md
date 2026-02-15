# 偏好热力图 API 说明文档

## 概述

偏好热力图功能通过分析用户的听歌历史、评分、收藏和听歌时长，计算每个音乐标签（风格、乐器、情绪、主题）的权重，生成可视化的偏好热力图。

## API 端点

### POST `/api/preferences/heatmap`

根据用户的听歌行为历史计算偏好热力图数据。

## 请求格式

### 请求头
```
Content-Type: application/json
```

### 请求体
```json
{
  "username": "user1"
}
```

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| username | string | 是 | 用户名 |

## 响应格式

### 成功响应 (200 OK)

```json
{
  "success": true,
  "data": {
    "genres": [
      {
        "tag": "jazz",
        "weight": 8.0
      },
      {
        "tag": "electronic",
        "weight": 5.0
      },
      {
        "tag": "rock",
        "weight": -2.0
      }
    ],
    "instruments": [
      {
        "tag": "piano",
        "weight": 6.0
      },
      {
        "tag": "guitar",
        "weight": 3.0
      }
    ],
    "moods": [
      {
        "tag": "relaxing",
        "weight": 7.0
      },
      {
        "tag": "energetic",
        "weight": -1.0
      }
    ],
    "themes": [
      {
        "tag": "nature",
        "weight": 4.0
      }
    ]
  }
}
```

### 错误响应

#### 400 Bad Request - 缺少用户名
```json
{
  "success": false,
  "message": "用户名不能为空"
}
```

#### 500 Internal Server Error - 服务器错误
```json
{
  "success": false,
  "message": "获取偏好热力图失败: [错误详情]"
}
```

## 权重计算规则

### 评分贡献
- **1-2星**: 权重 -2（表示不偏好）
- **3星**: 权重 0（中性，不影响偏好）
- **4-5星**: 权重 +2（表示偏好）

### 收藏贡献
- **收藏**: 权重 +1

### 听歌时长贡献
- **>120秒**: 权重 +2
- **>60秒**: 权重 +1
- **≤60秒**: 权重 0

### 权重累加规则
- 同一标签在多个行为记录中出现时，权重会累加
- 最终权重 = 所有相关行为记录的权重总和
- 权重为0的记录会被跳过（不影响偏好）

## 请求日志示例

### 示例 1: 正常请求

#### 前端请求
```javascript
// 请求URL
POST http://localhost:3000/api/preferences/heatmap

// 请求体
{
  "username": "user1"
}
```

#### 后端日志输出
```
📊 偏好热力图: 用户 user1, 记录数: 15
```

#### 响应数据
```json
{
  "success": true,
  "data": {
    "genres": [
      { "tag": "jazz", "weight": 8.0 },
      { "tag": "electronic", "weight": 5.0 },
      { "tag": "rock", "weight": -2.0 }
    ],
    "instruments": [
      { "tag": "piano", "weight": 6.0 },
      { "tag": "guitar", "weight": 3.0 }
    ],
    "moods": [
      { "tag": "relaxing", "weight": 7.0 },
      { "tag": "energetic", "weight": -1.0 }
    ],
    "themes": [
      { "tag": "nature", "weight": 4.0 }
    ]
  }
}
```

### 示例 2: 新用户（无历史记录）

#### 前端请求
```javascript
POST http://localhost:3000/api/preferences/heatmap
{
  "username": "newuser"
}
```

#### 后端日志输出
```
📊 偏好热力图: 用户 newuser, 记录数: 0
```

#### 响应数据
```json
{
  "success": true,
  "data": {
    "genres": [],
    "instruments": [],
    "moods": [],
    "themes": []
  }
}
```

### 示例 3: 错误请求（缺少用户名）

#### 前端请求
```javascript
POST http://localhost:3000/api/preferences/heatmap
{
  // 缺少 username 字段
}
```

#### 后端日志输出
```
❌ 获取偏好热力图失败: 用户名不能为空
```

#### 响应数据
```json
{
  "success": false,
  "message": "用户名不能为空"
}
```

## 完整请求流程示例

### 场景：用户 user1 查看偏好热力图

#### 1. 用户行为历史（数据库记录）
```
用户 user1 的听歌记录：
- track_123: 评分5星, 收藏, 听歌时长180秒, 标签: [jazz, piano, relaxing]
- track_456: 评分4星, 未收藏, 听歌时长90秒, 标签: [electronic, synthesizer, energetic]
- track_789: 评分2星, 未收藏, 听歌时长30秒, 标签: [rock, guitar, energetic]
- track_101: 评分5星, 收藏, 听歌时长120秒, 标签: [jazz, piano, relaxing, nature]
```

#### 2. 权重计算过程

**风格 (genres) 权重计算：**
- `jazz`: track_123(+2评分 +1收藏 +2时长) + track_101(+2评分 +1收藏 +1时长) = **+9**
- `electronic`: track_456(+2评分 +1时长) = **+3**
- `rock`: track_789(-2评分) = **-2**

**乐器 (instruments) 权重计算：**
- `piano`: track_123(+2评分 +1收藏 +2时长) + track_101(+2评分 +1收藏 +1时长) = **+9**
- `guitar`: track_789(-2评分) = **-2**
- `synthesizer`: track_456(+2评分 +1时长) = **+3**

**情绪 (moods) 权重计算：**
- `relaxing`: track_123(+2评分 +1收藏 +2时长) + track_101(+2评分 +1收藏 +1时长) = **+9**
- `energetic`: track_456(+2评分 +1时长) + track_789(-2评分) = **+1**

**主题 (themes) 权重计算：**
- `nature`: track_101(+2评分 +1收藏 +1时长) = **+4**

#### 3. 前端请求
```javascript
const response = await fetch('http://localhost:3000/api/preferences/heatmap', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    username: 'user1'
  })
});

const data = await response.json();
```

#### 4. 后端处理日志
```
📊 偏好热力图: 用户 user1, 记录数: 4
```

#### 5. 响应数据
```json
{
  "success": true,
  "data": {
    "genres": [
      { "tag": "jazz", "weight": 9.0 },
      { "tag": "electronic", "weight": 3.0 },
      { "tag": "rock", "weight": -2.0 }
    ],
    "instruments": [
      { "tag": "piano", "weight": 9.0 },
      { "tag": "synthesizer", "weight": 3.0 },
      { "tag": "guitar", "weight": -2.0 }
    ],
    "moods": [
      { "tag": "relaxing", "weight": 9.0 },
      { "tag": "energetic", "weight": 1.0 }
    ],
    "themes": [
      { "tag": "nature", "weight": 4.0 }
    ]
  }
}
```

#### 6. LLM 解释生成
前端调用 `generateHeatmapExplanation` 生成解释文本：
```
根据您的听歌历史，我发现您对爵士乐（jazz）和钢琴（piano）有着明显的偏好，
特别是在放松（relaxing）的情绪下。您似乎不太喜欢摇滚（rock）风格的音乐。
这些偏好会影响推荐算法，系统会优先为您推荐符合您偏好的爵士钢琴曲，
并减少推荐摇滚风格的歌曲。
```

## 前端调用示例

### 使用 preferenceHeatmap API

```typescript
import { getPreferenceHeatmap } from '../api/preferenceHeatmap';

// 获取偏好热力图
const heatmapData = await getPreferenceHeatmap({ username: 'user1' });

if (heatmapData) {
  console.log('风格偏好:', heatmapData.genres);
  console.log('乐器偏好:', heatmapData.instruments);
  console.log('情绪偏好:', heatmapData.moods);
  console.log('主题偏好:', heatmapData.themes);
} else {
  console.log('获取热力图失败或数据为空');
}
```

### 在 AIAssistant 中触发

用户输入以下任一关键词时，会自动显示热力图：
- "我的偏好是什么？"
- "我的偏好"
- "偏好热力图"
- "我的喜好"
- "偏好情况"
- "偏好分析"
- "我的音乐偏好"
- "听歌偏好"

## 调试技巧

### 1. 检查后端日志
```bash
# 查看后端终端输出
📊 偏好热力图: 用户 [username], 记录数: [count]
```

### 2. 检查浏览器控制台
```javascript
// 在浏览器开发者工具中查看
console.log('热力图数据:', heatmapData);
```

### 3. 检查网络请求
- 打开浏览器开发者工具 → Network 标签
- 筛选 XHR 请求
- 查找 `/api/preferences/heatmap` 请求
- 查看 Request Payload 和 Response

### 4. 验证数据完整性
```javascript
// 检查返回的数据结构
if (data.success && data.data) {
  const { genres, instruments, moods, themes } = data.data;
  console.log('风格数量:', genres.length);
  console.log('乐器数量:', instruments.length);
  console.log('情绪数量:', moods.length);
  console.log('主题数量:', themes.length);
}
```

## 常见问题

### Q1: 为什么返回的数据为空？
**A:** 可能原因：
- 用户没有听歌历史记录
- 所有记录的权重都为0（被跳过）
- 数据库中没有对应的 track_id 标签信息

### Q2: 权重计算不准确？
**A:** 检查：
- 用户行为历史是否正确记录到数据库
- `trackTagsMap` 是否正确加载了 `raw.tsv` 数据
- 权重计算规则是否符合预期

### Q3: API 请求失败？
**A:** 检查：
- 后端服务是否正常运行（端口 3000）
- 用户名是否正确
- 网络连接是否正常
- CORS 配置是否正确

## 相关文件

- **后端实现**: `f2proto/backend/server.js` (第 740-810 行)
- **前端API**: `f2proto/frontend/src/api/preferenceHeatmap.ts`
- **热力图组件**: `f2proto/frontend/src/components/PreferenceHeatmap.tsx`
- **AI助手集成**: `f2proto/frontend/src/components/AIAssistant.tsx`
- **LLM解释**: `f2proto/frontend/src/api/aiAssistant.ts` (generateHeatmapExplanation 方法)
