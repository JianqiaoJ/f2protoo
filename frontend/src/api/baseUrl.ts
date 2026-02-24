/**
 * 后端 API 基址。
 * - 构建时设置 VITE_API_BASE_URL 则使用该值（如部署到不同域名时填完整 origin）。
 * - 未设置且为生产构建：使用 ''，请求走相对路径 /api/...，与当前页同源（nginx 反代或同机 3000 均可）。
 * - 未设置且为开发模式：使用 http://localhost:3000，对接本地 backend。
 */
const raw = (import.meta as any).env?.VITE_API_BASE_URL;
const isDev = (import.meta as any).env?.DEV === true;
export const API_BASE_URL =
  raw !== undefined && raw !== '' ? String(raw) : (isDev ? 'http://localhost:3000' : '');
