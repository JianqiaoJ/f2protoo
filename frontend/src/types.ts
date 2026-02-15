export interface TrackTags {
  genres: string[];
  instruments: string[];
  moods: string[];
  themes: string[];
}

export interface JamendoTrack {
  id: string;
  name: string;
  artist_name: string;
  album_name: string;
  image: string;
  audio: string;
  duration: number;
  releasedate: string;
  tags?: TrackTags;
}

export interface FavoriteTrack {
  id: string;
  name: string;
  artist_name: string;
  album_name: string;
  image: string;
  audio: string;
  rating: number;
  favoritedAt: number;
}

export interface TrackRating {
  trackId: string;
  rating: number;
}

/** 每个 tag 的权重，key 为 tag 名，value 为权重值 */
export type TagWeights = Record<string, number>;

export interface UserPreference {
  genres: string[];
  instruments: string[];
  moods: string[];
  themes: string[];
  /** 各分类下 tag 的权重，与 genres/instruments/moods/themes 对应 */
  genresWeights?: TagWeights;
  instrumentsWeights?: TagWeights;
  moodsWeights?: TagWeights;
  themesWeights?: TagWeights;
}

export interface HistoryRecord {
  trackId: string;
  name: string;
  artist_name: string;
  album_name: string;
  image: string;
  audio: string;
  playedAt: number; // 播放时间戳
  duration: number; // 听歌时长（秒）
}

export interface PlayerState {
  currentTrack: JamendoTrack | null;
  currentTrackIndex: number;
  isPlaying: boolean;
  favorites: FavoriteTrack[];
  ratings: TrackRating[]; // 独立的评分系统
  userPreferences: UserPreference; // 用户偏好记忆
  history: HistoryRecord[]; // 听歌历史
  trackIds: string[];
  loading: boolean;
  error: string | null;
  currentTime: number; // 当前播放时间
}
