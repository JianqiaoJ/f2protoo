/**
 * 对话框按钮记录 API：记录展示给用户的按钮、按钮文字、是否被点击、点击后的下一个文字
 */

import { API_BASE_URL } from './baseUrl';

export interface ButtonItem {
  label: string;
  action: string;
}

/** 记录对话框内展示的按钮（展示时调用，返回 log_id 供点击时更新） */
export const logDialogButtons = async (params: {
  username: string;
  session_id: string;
  message_sequence_no: number;
  buttons: ButtonItem[];
}): Promise<number | null> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/dialog-button/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: params.username,
        session_id: params.session_id,
        message_sequence_no: params.message_sequence_no,
        buttons: params.buttons,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.success && typeof data.log_id === 'number' ? data.log_id : null;
  } catch (e) {
    console.warn('对话框按钮展示记录失败:', e);
    return null;
  }
};

/** 记录用户点击了哪个按钮，以及点击后展示的下一个文字（可选） */
export const logDialogButtonClick = async (params: {
  log_id: number | null;
  clicked_label: string;
  clicked_action: string;
  next_text?: string | null;
}): Promise<void> => {
  if (params.log_id == null) return;
  try {
    await fetch(`${API_BASE_URL}/api/dialog-button/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        log_id: params.log_id,
        clicked_label: params.clicked_label,
        clicked_action: params.clicked_action,
        next_text: params.next_text ?? null,
      }),
    });
  } catch (e) {
    console.warn('对话框按钮点击记录失败:', e);
  }
};

/** 补传「点击之后的下一个文字」（若点击时未传可后续调用） */
export const updateDialogButtonNextText = async (log_id: number | null, next_text: string): Promise<void> => {
  if (log_id == null) return;
  try {
    await fetch(`${API_BASE_URL}/api/dialog-button/next-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id, next_text }),
    });
  } catch (e) {
    console.warn('对话框按钮 next_text 更新失败:', e);
  }
};
