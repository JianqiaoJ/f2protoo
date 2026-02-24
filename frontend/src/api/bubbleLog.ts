/**
 * 气泡展示记录 API：记录气泡展示时间、类型、内容，以及是否被点击
 */

import { API_BASE_URL } from './baseUrl';

export type BubbleType =
  | 'recommendation'
  | 'whyThisTrack'
  | 'ratingFeedback'
  | 'oneMinute'
  | 'ninetyFive'
  | 'quickSkip'
  | 'diversity';

/** 记录气泡展示：展示时调用，返回 log_id 供点击时更新 */
export const logBubbleShow = async (params: {
  username: string;
  bubble_type: BubbleType;
  content?: string;
}): Promise<number | null> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/bubble/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: params.username,
        bubble_type: params.bubble_type,
        content: params.content ?? '',
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.success && typeof data.log_id === 'number' ? data.log_id : null;
  } catch (e) {
    console.warn('气泡展示记录失败:', e);
    return null;
  }
};

/** 记录气泡被点击 */
export const logBubbleClick = async (logId: number | null): Promise<void> => {
  if (logId == null) return;
  try {
    await fetch(`${API_BASE_URL}/api/bubble/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: logId }),
    });
  } catch (e) {
    console.warn('气泡点击记录失败:', e);
  }
};
