import axios from 'axios';

import { API_BASE_URL } from './baseUrl';

/** 消息附带的操作按钮（如「是这样的！」「说的不对」） */
export type MessageButton = { label: string; action: string };

/**
 * 追加一条对话到服务端（同时写入当前会话表与永久历史表，冷启动时只清当前会话表）
 * @param message_buttons 该条消息附带的操作按钮（仅 assistant 消息可有）
 */
export async function appendConversationMessage(
  username: string,
  session_id: string,
  sender: 'user' | 'assistant',
  content: string,
  sequence_no: number,
  message_buttons?: MessageButton[] | null
) {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/conversation/append`, {
      username,
      session_id,
      sender,
      content: content ?? '',
      sequence_no,
      ...(message_buttons != null && message_buttons.length > 0 ? { message_buttons } : {}),
    });
    return response.data;
  } catch (error) {
    console.error('追加对话失败:', error);
    throw error;
  }
}

/**
 * 记录用户对某条助手消息的操作按钮选择（更新该条的 user_button_choice）
 */
export async function recordConversationButtonChoice(
  username: string,
  session_id: string,
  sequence_no: number,
  choice: { label: string; action: string }
) {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/conversation/record-button-choice`, {
      username,
      session_id,
      sequence_no,
      choice_label: choice.label,
      choice_action: choice.action,
    });
    return response.data;
  } catch (error) {
    console.error('记录按钮选择失败:', error);
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
