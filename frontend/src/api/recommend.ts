// 推荐API

import { API_BASE_URL } from './baseUrl';

/** 推荐请求触发原因，用于后端日志 */
export type RecommendTrigger =
  | 'user_expressed_preference'  // 用户主动表达喜好
  | 'user_dislike_remove'        // 用户表达讨厌并移除 tag
  | 'preferences_updated'        // 用户偏好已更新（可能因收藏、评分、听歌时长等）
  | 'preload_next_batch'         // 待播列表剩余不多，预拉下一批（未播完）
  | 'playlist_finished'          // 当前播放列表播放完毕
  | 'user_request_rerecommend';  // 用户说重新推荐/换一批等，立刻重新推荐

/** 用户明确不喜欢的 tag，带这些 tag 的歌曲不再推荐 */
export interface ExcludedTags {
  genres?: string[];
  instruments?: string[];
  moods?: string[];
  themes?: string[];
}

export interface RecommendRequest {
  username: string;
  /** 系统 A/B，用于 DB 维度与 A/B 实验 */
  systemType?: 'A' | 'B';
  currentTrackId?: string;
  explicitPreferences?: {
    genres?: string[];
    instruments?: string[];
    moods?: string[];
    themes?: string[];
  };
  /** 用户明确不喜欢时传入，推荐结果中不会包含带这些 tag 的歌曲 */
  excludedTags?: ExcludedTags;
  /** 用户表达厌恶时传入当前待播列表，后端返回过滤后的列表（去掉含厌恶 tag 的曲目）供前端插队拼接 */
  currentPlaylist?: string[];
  count?: number;
  /** 触发原因，用于后端请求日志 */
  trigger?: RecommendTrigger;
  /** 当 trigger 为 preferences_updated 时可选传入：偏好更新原因（如 favorite/rating_confirm），后端日志会明确展示为 收藏/评分高/听歌完播 等 */
  preferenceUpdateReason?: string;
  /** 当 trigger 为 user_expressed_preference 时可选传入：用户主动表达喜好的消息原文，后端日志会打印在推荐结果原因中 */
  triggerUserMessage?: string;
}

/** 后端返回的首曲完整信息，与 JamendoTrack 一致 */
export interface FirstTrackFromApi {
  id: string;
  name: string;
  artist_name: string;
  album_name: string;
  image: string;
  audio: string;
  duration: number;
  releasedate: string;
  tags?: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] };
}

export interface RecommendResponse {
  success: boolean;
  recommendedTracks: string[];
  recommendedScores?: number[];
  count?: number;
  firstTrack?: FirstTrackFromApi | null;
  /** 前 N 首完整曲目详情，用于「下一首」直接播放无需再请求 Jamendo */
  firstTracks?: FirstTrackFromApi[];
  message?: string;
}

export interface RecommendResult {
  recommendedTracks: string[];
  recommendedScores?: number[];
  firstTrack?: FirstTrackFromApi | null;
  firstTracks?: FirstTrackFromApi[];
  /** 仅当 trigger 为 user_dislike_remove 且传了 currentPlaylist 时返回：当前待播中不含厌恶 tag 的曲目，供插队后拼接 */
  filteredPlaylist?: string[];
}

/** 推荐接口超时：后端加载 raw.tsv / 打分可能较慢，尤其是首次请求，延长至 2 分钟避免误报 */
const RECOMMEND_TIMEOUT_MS = 120000;

/**
 * 获取推荐歌曲（含首曲详情时可直接用 firstTrack，减少一次前端请求 Jamendo）
 */
export const getRecommendations = async (
  request: RecommendRequest
): Promise<RecommendResult> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RECOMMEND_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/api/recommend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data: RecommendResponse & { filteredPlaylist?: string[] } = await response.json();
      if (data.success && data.recommendedTracks) {
        return {
          recommendedTracks: data.recommendedTracks,
          recommendedScores: data.recommendedScores,
          firstTrack: data.firstTrack ?? undefined,
          firstTracks: data.firstTracks ?? undefined,
          filteredPlaylist: data.filteredPlaylist,
        };
      }
    }
    return { recommendedTracks: [] };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error?.name === 'AbortError') {
      console.error('获取推荐超时:', RECOMMEND_TIMEOUT_MS, 'ms', API_BASE_URL);
      throw new Error(`推荐请求超时(${RECOMMEND_TIMEOUT_MS / 1000}秒)，可能是后端处理过慢（如首次加载数据）或未启动，请稍后重试或检查: ${API_BASE_URL}`);
    }
    console.error('获取推荐失败:', error);
    throw error;
  }
};

/** 为什么推荐这首：单曲的推荐理由（内容分、行为分、匹配标签） */
export interface RecommendWhyData {
  contentScore: number;
  behaviorScore: number;
  finalScore: number;
  matchedTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] };
  trackTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] };
}

/** 可选：当前歌曲的标签，当 trackId 不在后端标签库时用于计算推荐理由 */
export interface TrackTagsForWhy {
  genres?: string[];
  instruments?: string[];
  moods?: string[];
  themes?: string[];
}

export const getRecommendWhy = async (
  username: string,
  trackId: string,
  trackTags?: TrackTagsForWhy | null
): Promise<RecommendWhyData | null> => {
  try {
    const body: { username: string; trackId: string; trackTags?: TrackTagsForWhy } = { username, trackId };
    if (trackTags && (trackTags.genres?.length || trackTags.instruments?.length || trackTags.moods?.length || trackTags.themes?.length)) {
      body.trackTags = trackTags;
    }
    const response = await fetch(`${API_BASE_URL}/api/recommend/why`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data) return data.data;
    }
    return null;
  } catch (error) {
    console.error('获取推荐理由失败:', error);
    return null;
  }
};

/** 记录「为什么推荐这首」按钮点击及系统返回的解释消息 */
export const logWhyThisTrack = async (
  username: string,
  explanation: string,
  trackId?: string,
  trackName?: string
): Promise<void> => {
  try {
    await fetch(`${API_BASE_URL}/api/log/why-this-track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        track_id: trackId ?? null,
        track_name: trackName ?? null,
        explanation,
      }),
    });
  } catch (e) {
    console.warn('记录为什么推荐这首失败:', e);
  }
};
