import axios from 'axios';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3000';

/**
 * 追加一条对话到服务端（同时写入当前会话表与永久历史表，冷启动时只清当前会话表）
 */
export async function appendConversationMessage(
  username: string,
  session_id: string,
  sender: 'user' | 'assistant',
  content: string,
  sequence_no: number
) {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/conversation/append`, {
      username,
      session_id,
      sender,
      content: content ?? '',
      sequence_no,
    });
    return response.data;
  } catch (error) {
    console.error('追加对话失败:', error);
    throw error;
  }
}

/**
 * 清除该用户当前会话对话（user_conversations 表）；user_conversations_history 永不删除
 */
export async function clearUserConversations(username: string) {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/conversation/clear`, { username });
    return response.data;
  } catch (error) {
    console.error('清除对话历史失败:', error);
    throw error;
  }
}
