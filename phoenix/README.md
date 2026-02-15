# Phoenix 可观测平台部署说明

[Arize Phoenix](https://github.com/Arize-ai/phoenix) 是开源的 ML/LLM 可观测平台，基于 OpenTelemetry，用于**追踪、评估和优化**模型调用与日志。

## 一、启动 Phoenix（Docker）

**环境要求**：已安装 [Docker](https://docs.docker.com/get-docker/)。

在项目根目录执行：

```bash
cd phoenix
docker compose up -d
```

- **Phoenix UI**：浏览器打开 [http://localhost:6006](http://localhost:6006)
- **OTLP 上报**：gRPC `localhost:4317`，HTTP 使用 `http://localhost:6006`（与 UI 同端口）

停止服务：

```bash
docker compose down
```

数据默认持久化在 Docker volume `phoenix_data`，重启后仍可查看历史 trace。

---

## 二、把模型日志 / Trace 上报到 Phoenix

当前本项目的 LLM 调用在**前端**（`frontend/src/api/aiAssistant.ts` 请求 DeepSeek）。要让 Phoenix 记录这些调用，有两种常见方式。

### 方式 A：后端代理 + Node 接入（推荐）

1. 在后端增加一个代理接口，前端改为请求该接口，由后端再请求 DeepSeek。
2. 在后端用 **@arizeai/phoenix-otel** 注册 tracer，并把 OTLP 指向本机 Phoenix：

```bash
cd backend
npm install @arizeai/phoenix-otel
```

在 **backend 入口文件最顶部**（在任何其他 require/import 之前）添加：

```js
import { register } from '@arizeai/phoenix-otel';

register({
  projectName: 'f2proto-music',
  url: 'http://localhost:6006',
  batch: true,
});
```

3. 重启后端，所有通过该代理的 LLM 请求会被 OpenTelemetry 自动捕获（若使用 OpenAI 兼容客户端，可再配 OpenAI instrumentation），并在 Phoenix UI 中看到 trace。

### 方式 B：仅先跑通 Phoenix，再逐步接入

1. 只部署 Phoenix（如上 `docker compose up -d`）。
2. 在 [http://localhost:6006](http://localhost:6006) 确认界面正常。
3. 再按 [Phoenix JavaScript/Node 文档](https://docs.arize.com/phoenix/tracing/how-to-tracing/setup-tracing/javascript) 或方式 A 在后端/前端接入 `@arizeai/phoenix-otel`，把 `url` 设为 `http://localhost:6006` 即可。

---

## 三、生产环境建议

- 将镜像固定为具体版本，例如：`arizephoenix/phoenix:version-8.0.0`，避免 `latest` 自动升级。
- 需要长期保留数据时，可改用 PostgreSQL，参考 [Phoenix Docker 文档 - PostgreSQL](https://docs.arize.com/phoenix/self-hosting/deployment-options/docker#postgresql) 修改 `docker-compose.yml`。

---

## 四、参考链接

- [Phoenix 官方文档](https://docs.arize.com/phoenix)
- [自托管部署总览](https://docs.arize.com/phoenix/deployment)
- [Docker 部署](https://docs.arize.com/phoenix/self-hosting/deployment-options/docker)
- [JavaScript/Node 接入 Phoenix](https://docs.arize.com/phoenix/tracing/how-to-tracing/setup-tracing/javascript)
