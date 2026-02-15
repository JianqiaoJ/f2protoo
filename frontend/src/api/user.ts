import axios from 'axios';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3000';

/**
 * 清除该用户在服务端的全部数据，回到冷启动：
 * 偏好、对话历史、听歌行为、已推荐记录一并清除，
 * LLM 与推荐系统均不再保留该用户过去行为。
 */
export async function clearAllUserDataOnServer(username: string) {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/user/clear-all`, { username });
    return response.data;
  } catch (error) {
    console.error('清除服务端用户数据失败:', error);
    throw error;
  }
}
