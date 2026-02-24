// 用户听歌行为记录API

import { API_BASE_URL } from './baseUrl';

export interface ListeningBehavior {
  username: string;
  system_type?: 'A' | 'B'; // 系统 A/B，用于 DB 维度
  track_name: string;
  artist_name: string;
  track_id: string;
  listen_duration?: number; // 听歌时长（秒）
  is_favorited?: boolean; // 是否收藏
  rating?: number; // 评分（0-5）
}

/**
 * 记录用户听歌行为
 */
export const logListeningBehavior = async (behavior: ListeningBehavior): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/behavior/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(behavior),
    });

    if (response.ok) {
      const data = await response.json();
      return data.success;
    }
    return false;
  } catch (error) {
    console.error('记录听歌行为失败:', error);
    return false;
  }
};
