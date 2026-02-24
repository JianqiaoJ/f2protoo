// 多样性推荐API

import { API_BASE_URL } from './baseUrl';

export interface DiversityRecommendRequest {
  username: string;
}

export interface DiversityRecommendResponse {
  success: boolean;
  trackId?: string;
  message?: string;
}

/**
 * 获取多样性推荐歌曲（用户没有表达过厌恶，但也没有展示过喜爱的tag的歌）
 */
export const getDiversityRecommendation = async (
  request: DiversityRecommendRequest
): Promise<string | null> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/recommend/diversity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (response.ok) {
      const data: DiversityRecommendResponse = await response.json();
      if (data.success && data.trackId) {
        return data.trackId;
      }
    }
    return null;
  } catch (error) {
    console.error('获取多样性推荐失败:', error);
    return null;
  }
};
