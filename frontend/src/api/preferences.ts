import axios from 'axios';
import { API_BASE_URL } from './baseUrl';

/** 冷启动健康检查超时：后端首次请求可能较慢（加载 DB/TSV），给足时间 */
const BACKEND_CHECK_TIMEOUT_MS = 30000;

/**
 * 冷启动前检查后端是否可用，避免保存偏好时长时间无响应
 */
export async function checkBackendHealth(): Promise<void> {
  try {
    await axios.get(`${API_BASE_URL}/api/users`, { timeout: BACKEND_CHECK_TIMEOUT_MS });
  } catch (error: any) {
    const isDeployed = API_BASE_URL !== '' && !API_BASE_URL.includes('localhost');
    const hint = isDeployed
      ? '若已部署到服务器，请在服务器上执行: cd /opt/music-player-backend && sudo node server.js >> backend.log 2>&1 & 然后查看 tail backend.log'
      : `请确认 backend 已启动（在 backend 目录运行 node server.js），并确认地址为 ${API_BASE_URL}`;
    const msg = error?.code === 'ECONNABORTED'
      ? `连接后端超时(${BACKEND_CHECK_TIMEOUT_MS}ms)。${hint}`
      : `无法连接后端(${API_BASE_URL})。${hint}`;
    throw new Error(msg);
  }
}

export type PreferenceUpdateOperation =
  | 'conversation'      // 对话中表达偏好
  | 'first_login'       // 首次登录填写偏好
  | 'rating_confirm'    // 评分反馈确认
  | 'one_minute_confirm'// 听满1分钟确认
  | 'ninety_five_confirm'// 听满95%确认
  | 'conflict_confirm'  // 说的不对后确认更新
  | 'favorite'         // 收藏歌曲
  | 'dislike_remove'   // 用户表达讨厌，删除该 tag
  | 'unknown';

/** 用户偏好更新日志用：操作类型 -> 中文「因何行为更新」 */
export const PREFERENCE_OPERATION_LABELS: Record<PreferenceUpdateOperation, string> = {
  conversation: '对话中表达偏好',
  first_login: '冷启动/首次填写偏好',
  rating_confirm: '评分反馈确认（是这样的）',
  one_minute_confirm: '听满1分钟确认',
  ninety_five_confirm: '听满95%确认',
  conflict_confirm: '说的不对后确认更新',
  favorite: '收藏歌曲',
  dislike_remove: '用户表达讨厌并移除 tag',
  unknown: '未知',
};

export function getPreferenceOperationLabel(op?: PreferenceUpdateOperation | null): string {
  return (op && PREFERENCE_OPERATION_LABELS[op]) ? PREFERENCE_OPERATION_LABELS[op] : PREFERENCE_OPERATION_LABELS.unknown;
}

/**
 * 保存用户偏好到数据库（含 tag 与权重），可选记录操作类型和会话内容（对话时）
 */
export async function saveUserPreferences(
  username: string,
  preferences: {
    genres: string[];
    instruments: string[];
    moods: string[];
    themes: string[];
    genresWeights?: Record<string, number>;
    instrumentsWeights?: Record<string, number>;
    moodsWeights?: Record<string, number>;
    themesWeights?: Record<string, number>;
  },
  options?: { operation?: PreferenceUpdateOperation; conversationContent?: string; systemType?: 'A' | 'B' }
) {
  try {
    const payload = {
      username,
      system_type: options?.systemType ?? 'A',
      preferences: {
        genres: preferences.genres,
        instruments: preferences.instruments,
        moods: preferences.moods,
        themes: preferences.themes,
        genres_weights: preferences.genresWeights ?? {},
        instruments_weights: preferences.instrumentsWeights ?? {},
        moods_weights: preferences.moodsWeights ?? {},
        themes_weights: preferences.themesWeights ?? {},
      },
      operation: options?.operation ?? 'unknown',
      conversation_content: options?.conversationContent ?? null,
    };
    const SAVE_TIMEOUT_MS = 30000;
    const response = await axios.post(`${API_BASE_URL}/api/preferences/save`, payload, { timeout: SAVE_TIMEOUT_MS });
    return response.data;
  } catch (error: any) {
    const hint = '请先启动后端: 在 backend 目录运行 npm run start 或 node server.js';
    const msg = error?.code === 'ECONNABORTED'
      ? `保存偏好超时(30s)，请检查后端是否启动: ${API_BASE_URL}。${hint}`
      : (error?.message || '保存用户偏好失败');
    console.error('保存用户偏好失败:', msg, error);
    throw new Error(msg);
  }
}

/**
 * 获取用户偏好
 */
export async function getUserPreferences(username: string, systemType?: 'A' | 'B') {
  try {
    const params = systemType ? `?system_type=${systemType}` : '';
    const response = await axios.get(`${API_BASE_URL}/api/preferences/${username}${params}`);
    return response.data;
  } catch (error) {
    console.error('获取用户偏好失败:', error);
    throw error;
  }
}

/**
 * 清除用户偏好内容（冷启动）：只清空库内 user_preferences 的 tag 与权重，不删除 user_preference_updates
 */
export async function clearUserPreferences(username: string, systemType?: 'A' | 'B') {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/preferences/clear`, {
      username,
      system_type: systemType ?? 'A',
    });
    return response.data;
  } catch (error) {
    console.error('清除用户偏好失败:', error);
    throw error;
  }
}
