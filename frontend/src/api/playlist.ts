/**
 * 待播列表：后台维护，按顺序播放，倒数第二首时自动追加 3 首，排除已听过
 */

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3000';

/**
 * 获取待播列表。若当前在倒数第二首，后台会追加 3 首并返回新列表；若列表已播完会重新生成。
 * trackScores 与 trackIds 一一对应，供待播列表展示召回分；从 DB 读取时可能全为 0。
 */
export async function getPlaylist(
  username: string,
  currentIndex?: number,
  systemType?: 'A' | 'B'
): Promise<{ success: boolean; trackIds: string[]; trackScores?: number[] }> {
  try {
    const params = new URLSearchParams({ username });
    if (systemType) params.set('system_type', systemType);
    if (typeof currentIndex === 'number' && !Number.isNaN(currentIndex)) {
      params.set('currentIndex', String(currentIndex));
    }
    const response = await fetch(`${API_BASE_URL}/api/playlist?${params}`);
    if (response.ok) {
      const data = await response.json();
      const trackIds = Array.isArray(data.trackIds) ? data.trackIds : [];
      const trackScores = Array.isArray(data.trackScores) && data.trackScores.length === trackIds.length
        ? data.trackScores
        : trackIds.map(() => 0);
      return { success: data.success === true, trackIds, trackScores };
    }
    return { success: false, trackIds: [], trackScores: [] };
  } catch (error) {
    console.error('获取待播列表失败:', error);
    return { success: false, trackIds: [], trackScores: [] };
  }
}

/**
 * 设置待播列表（用于偏好/不喜欢后替换列表时与后台同步）
 */
export async function setPlaylist(username: string, trackIds: string[], systemType?: 'A' | 'B'): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, trackIds, system_type: systemType ?? 'A' }),
    });
    if (response.ok) {
      const data = await response.json();
      return data.success === true;
    }
    return false;
  } catch (error) {
    console.error('更新待播列表失败:', error);
    return false;
  }
}
