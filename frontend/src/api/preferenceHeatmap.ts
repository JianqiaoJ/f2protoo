// 偏好热力图API

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3000';

export interface TagWeight {
  tag: string;
  weight: number;
}

export interface PreferenceHeatmapData {
  genres: TagWeight[];
  instruments: TagWeight[];
  moods: TagWeight[];
  themes: TagWeight[];
}

export interface PreferenceHeatmapRequest {
  username: string;
  system_type?: 'A' | 'B';
}

export interface PreferenceHeatmapResponse {
  success: boolean;
  data?: PreferenceHeatmapData;
  message?: string;
}

const HEATMAP_REQUEST_TIMEOUT_MS = 20000;

/**
 * 获取用户偏好热力图数据（带超时，避免一直加载）
 */
export const getPreferenceHeatmap = async (
  request: PreferenceHeatmapRequest
): Promise<PreferenceHeatmapData | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEATMAP_REQUEST_TIMEOUT_MS);
  try {
    console.log('🔍 请求偏好热力图:', request);
    const response = await fetch(`${API_BASE_URL}/api/preferences/heatmap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    console.log('🔍 API 响应状态:', response.status, response.statusText);

    if (response.ok) {
      let data: any;
      try {
        data = await response.json();
      } catch (parseErr: any) {
        const reason = `响应体非 JSON，解析失败: ${parseErr?.message ?? String(parseErr)}`;
        console.error('❌ [treemap]', reason);
        throw new Error(reason);
      }
      console.log('🔍 API 响应数据:', data);
      if (!data || !data.success) {
        const reason = `API 返回 success 为假或空: ${JSON.stringify(data ?? 'null')}`;
        console.warn('⚠️ [treemap]', reason);
        throw new Error(reason);
      }
      // 兼容两种格式：原格式扁平 { success, genres, instruments, moods, themes } 与包装格式 { success, data: { ... } }
      let heatmap: PreferenceHeatmapData;
      if (data.data && Array.isArray(data.data.genres)) {
        heatmap = data.data;
      } else if (Array.isArray(data.genres)) {
        heatmap = {
          genres: data.genres || [],
          instruments: data.instruments || [],
          moods: data.moods || [],
          themes: data.themes || [],
        };
      } else {
        const reason = `热力图结构异常，缺少 genres/instruments/moods/themes 数组: ${JSON.stringify(data)}`;
        console.warn('⚠️ [treemap]', reason);
        throw new Error(reason);
      }
      console.log('🔍 热力图数据详情:', {
        genres: heatmap.genres.length,
        instruments: heatmap.instruments.length,
        moods: heatmap.moods.length,
        themes: heatmap.themes.length,
      });
      return heatmap;
    } else {
      const errorText = await response.text();
      const reason = `HTTP ${response.status} ${response.statusText}: ${errorText || '(无响应体)'}`;
      console.error('❌ [treemap]', reason);
      throw new Error(reason);
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error?.name === 'AbortError') {
      const reason = `请求超时(${HEATMAP_REQUEST_TIMEOUT_MS}ms)，请确认后端已启动且地址正确: ${API_BASE_URL}`;
      console.error('❌ [treemap]', reason);
      throw new Error(reason);
    }
    if (error instanceof Error && error.message) {
      throw error;
    }
    const reason = `网络或未知错误: ${error?.message ?? String(error)}`;
    console.error('❌ [treemap]', reason);
    throw new Error(reason);
  }
};
