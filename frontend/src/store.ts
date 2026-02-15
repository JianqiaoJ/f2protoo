import { create } from 'zustand';
import { JamendoTrack, FavoriteTrack, PlayerState, TrackRating, UserPreference, HistoryRecord } from './types';
import { jamendoApi } from './api';
import { getUserStorageKey, getCurrentUser } from './utils/storage';
import { getRecommendations } from './api/recommend';
import { getPlaylist, setPlaylist } from './api/playlist';
import { saveUserPreferences, getUserPreferences as fetchUserPreferences, getPreferenceOperationLabel, type PreferenceUpdateOperation } from './api/preferences';
import { appendSystemLog } from './api/logs';

let preloadInProgress = false;

interface PlayerStore extends PlayerState {
  setCurrentTrack: (track: JamendoTrack | null) => void;
  setCurrentTrackIndex: (index: number) => void;
  setIsPlaying: (playing: boolean) => void;
  addFavorite: (track: JamendoTrack) => void; // 收藏不需要rating
  removeFavorite: (trackId: string) => void;
  setRating: (trackId: string, rating: number) => void; // 独立的评分功能
  getRating: (trackId: string) => number;
  addUserPreference: (type: 'genres' | 'instruments' | 'moods' | 'themes', items: string[], options?: { operation?: PreferenceUpdateOperation; conversationContent?: string }) => Promise<void>;
  removeUserPreference: (type: 'genres' | 'instruments' | 'moods' | 'themes', items: string[], options?: { operation?: PreferenceUpdateOperation; conversationContent?: string }) => Promise<void>;
  removeUserPreferenceBatch: (removals: { type: 'genres' | 'instruments' | 'moods' | 'themes'; items: string[] }[], options?: { operation?: PreferenceUpdateOperation; conversationContent?: string }) => Promise<void>;
  getUserPreferences: () => UserPreference;
  /** 冷启动等场景：直接替换本地偏好并持久化，不调 API（API 由调用方负责） */
  replaceUserPreferences: (prefs: UserPreference) => void;
  addHistoryRecord: (track: JamendoTrack, duration: number) => void; // 添加历史记录
  getHistory: () => HistoryRecord[]; // 获取历史记录
  clearAllUserData: () => void; // 清除当前用户的所有数据
  /** 从 localStorage 按当前用户重新加载收藏/偏好/历史等，用于切换用户后显示对应用户数据 */
  hydrateFromStorage: () => void;
  /** 将「上次推荐时的偏好版本」同步为当前偏好版本，避免刚拉完推荐后点下一首又被当成偏好更新而重复拉 10 首 */
  syncLastRecommendationVersion: () => void;
  setTrackIds: (ids: string[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  loadRandomTrack: () => Promise<void>; // 从待播列表按序取下一首，列表耗尽时请求推荐并同步待播列表，不随机选歌
  /** 仅从当前待播列表播下一首（不拉新推荐），用于「推荐下一首」请求进行中时仍可连续切歌 */
  playNextFromList: () => Promise<boolean>;
  togglePlayPause: () => void;
  setCurrentTime: (time: number) => void; // 设置当前播放时间
  currentTime: number; // 当前播放时间
  recommendedTrackIds: string[]; // 推荐列表（与马上要播的顺序一致）
  /** 待播列表中每首曲目对应的请求原因（如「用户表达喜好」「待播列表剩余不多，预拉下一批」） */
  recommendedTrackReasons: string[];
  /** 待播列表中每首曲目被召回时的系统打分 (trackId -> score) */
  recommendedTrackScores: Record<string, number>;
  /** 待播列表中每首曲目被加入列表的时间戳 (trackId -> timestamp) */
  recommendedTrackRequestedAt: Record<string, number>;
  recommendedTrackIndex: number; // 当前推荐列表的索引
  /** 待播列表前 N 首的完整曲目详情缓存，用于「下一首」直接播放无需再请求 Jamendo */
  recommendedTrackDetails: Record<string, JamendoTrack>;
  setRecommendedTrackIds: (ids: string[], scores?: number[], detailsCache?: JamendoTrack[], reason?: string) => void;
  setRecommendedTrackIndex: (index: number) => void;
  /** 提前拉好的下一批推荐（列表快用完时后台拉取），点下一首时直接用，不等接口 */
  preloadedNextBatch: { trackIds: string[]; scores?: number[]; firstTracks?: JamendoTrack[] } | null;
  setPreloadedNextBatch: (batch: { trackIds: string[]; scores?: number[]; firstTracks?: JamendoTrack[] } | null) => void;
  /** 当剩余可播 ≤2 首时在后台预拉下一批推荐；预拉只追加到列表末尾，不替换、不清除原列表；下一首永远按待播列表顺序往下播 */
  preloadNextRecommendationsIfNeeded: () => void;
  preferencesVersion: number; // 用户偏好版本号，用于检测偏好是否更新
  /** 最近一次偏好更新的原因（如 favorite/rating_confirm），用于推荐请求日志明确展示 */
  lastPreferenceOperation: PreferenceUpdateOperation | undefined;
  lastRecommendationPreferencesVersion: number; // 上次推荐时的偏好版本号
  incrementPreferencesVersion: () => void; // 增加偏好版本号
  consecutivePlayCount: number; // 连续听歌数量
  incrementConsecutivePlayCount: () => void; // 增加连续听歌数量
  resetConsecutivePlayCount: () => void; // 重置连续听歌数量
  /** 当前系统模式：A=无 Seren 小助手，B=融合 Seren 小助手；用于 A/B 实验与 DB 维度 */
  currentSystem: 'A' | 'B';
  setCurrentSystem: (system: 'A' | 'B') => void;
}

// Simple localStorage persistence (按用户隔离)
const loadFromStorage = () => {
  try {
    const storageKey = getUserStorageKey('jamendo-player-storage');
    const stored = localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

const saveToStorage = (favorites: FavoriteTrack[], ratings: TrackRating[], userPreferences: UserPreference, currentTrackIndex: number, history: HistoryRecord[]) => {
  try {
    const storageKey = getUserStorageKey('jamendo-player-storage');
    localStorage.setItem(storageKey, JSON.stringify({
      favorites,
      ratings,
      userPreferences,
      currentTrackIndex,
      history,
    }));
  } catch (e) {
    console.error('Failed to save to storage:', e);
  }
};

const initialState = loadFromStorage();

export const usePlayerStore = create<PlayerStore>()(
    (set, get) => ({
      currentTrack: null,
      currentTrackIndex: initialState.currentTrackIndex || 0,
      isPlaying: false,
      favorites: initialState.favorites || [],
      ratings: (initialState.ratings || []) as TrackRating[],
      userPreferences: initialState.userPreferences || {
        genres: [],
        instruments: [],
        moods: [],
        themes: [],
      },
      history: (initialState.history || []) as HistoryRecord[],
      trackIds: [],
      loading: false,
      error: null,
      currentTime: 0,
      recommendedTrackIds: [],
      recommendedTrackReasons: [],
      recommendedTrackScores: {},
      recommendedTrackRequestedAt: {},
      recommendedTrackIndex: 0,
      recommendedTrackDetails: {}, // 前 N 首曲目详情缓存，用于下一首直接播放
      preloadedNextBatch: null,
      setPreloadedNextBatch: (batch) => set({ preloadedNextBatch: batch }),
      preloadNextRecommendationsIfNeeded: () => {
        const state = get();
        const username = getCurrentUser();
        if (!username || state.preloadedNextBatch !== null || preloadInProgress) return;
        const ids = state.recommendedTrackIds;
        const idx = state.recommendedTrackIndex; // 下一首要播的位置
        const remaining = ids.length - idx; // 待播列表剩余首数（含下一首）
        const PRELOAD_WHEN_REMAINING = 2; // 剩余 ≤2 首时在列表下方补充新推荐
        if (remaining > PRELOAD_WHEN_REMAINING || ids.length === 0) return;
        preloadInProgress = true;
        appendSystemLog(`[推荐] 待播列表剩余 ${remaining} 首，正在后台补充新推荐...`);
        getRecommendations({
          username,
          systemType: state.currentSystem,
          currentTrackId: state.currentTrack?.id,
          explicitPreferences: state.getUserPreferences(),
          count: 10,
          trigger: 'preload_next_batch',
        }).then((result) => {
          preloadInProgress = false;
          const appendIds = result.recommendedTracks || [];
          if (appendIds.length === 0) return;
          const s = get();
          const currentIds = s.recommendedTrackIds;
          const currentScores = s.recommendedTrackScores;
          const currentDetails = s.recommendedTrackDetails;
          // 只追加到末尾，不替换、不清除原列表；下一首仍按 recommendedTrackIndex 顺序往下播
          const mergedIds = [...currentIds, ...appendIds];
          const mergedScores = { ...currentScores };
          appendIds.forEach((id, i) => {
            mergedScores[id] = (result.recommendedScores && result.recommendedScores[i] !== undefined)
              ? result.recommendedScores[i] : 0;
          });
          const mergedDetails = { ...currentDetails };
          (result.firstTracks || []).forEach((t) => {
            if (t?.id) mergedDetails[t.id] = t as JamendoTrack;
          });
          const PRELOAD_REASON = '待播列表剩余不多，预拉下一批';
          const mergedReasons = [...get().recommendedTrackReasons, ...appendIds.map(() => PRELOAD_REASON)];
          const now = Date.now();
          const mergedRequestedAt = { ...get().recommendedTrackRequestedAt, ...Object.fromEntries(appendIds.map((id) => [id, now])) };
          set({
            recommendedTrackIds: mergedIds,
            recommendedTrackReasons: mergedReasons,
            recommendedTrackScores: mergedScores,
            recommendedTrackDetails: mergedDetails,
            recommendedTrackRequestedAt: mergedRequestedAt,
          });
          setPlaylist(username, mergedIds, get().currentSystem).catch(() => {});
          appendSystemLog(`[推荐] 已在列表下方补充 ${appendIds.length} 首，当前共 ${mergedIds.length} 首`);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'store.ts:preload_append_done',message:'preload_append_done',data:{mergedLen:mergedIds.length,appendLen:appendIds.length,firstAppendId:appendIds[0]},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
          // #endregion
        }).catch(() => {
          preloadInProgress = false;
        });
      },
      preferencesVersion: 0,
      lastPreferenceOperation: undefined as PreferenceUpdateOperation | undefined,
      lastRecommendationPreferencesVersion: 0, // 上次推荐时的偏好版本号
      consecutivePlayCount: 0, // 连续听歌数量
      currentSystem: (() => {
        try {
          const v = localStorage.getItem('currentSystem');
          return (v === 'A' || v === 'B') ? v : 'A';
        } catch {
          return 'A';
        }
      })(),
      setCurrentSystem: (system) => {
        set({ currentSystem: system });
        try {
          localStorage.setItem('currentSystem', system);
        } catch {}
        const u = getCurrentUser();
        if (u) {
          fetchUserPreferences(u, system).then((data) => {
            const prefs = data?.preferences;
            if (prefs && typeof prefs === 'object') {
              get().replaceUserPreferences({
                genres: Array.isArray(prefs.genres) ? prefs.genres : [],
                instruments: Array.isArray(prefs.instruments) ? prefs.instruments : [],
                moods: Array.isArray(prefs.moods) ? prefs.moods : [],
                themes: Array.isArray(prefs.themes) ? prefs.themes : [],
                genresWeights: prefs.genres_weights && typeof prefs.genres_weights === 'object' ? prefs.genres_weights : {},
                instrumentsWeights: prefs.instruments_weights && typeof prefs.instruments_weights === 'object' ? prefs.instruments_weights : {},
                moodsWeights: prefs.moods_weights && typeof prefs.moods_weights === 'object' ? prefs.moods_weights : {},
                themesWeights: prefs.themes_weights && typeof prefs.themes_weights === 'object' ? prefs.themes_weights : {},
              });
            }
          }).catch(() => {});
        }
      },

      setCurrentTrack: (track) => {
        set({ currentTrack: track });
        if (!track) return;
        const ids = get().recommendedTrackIds;
        const trackIdStr = String(track.id);
        const norm = (id: string | number) => String(id).replace(/^track_0*/, '');
        const trackNorm = norm(trackIdStr);
        const matchId = (id: string) => norm(id) === trackNorm;
        const removedIndex = ids.findIndex(matchId);
        if (removedIndex < 0) return;
        const newIds = ids.filter((id) => !matchId(id));
        const prevScores = get().recommendedTrackScores;
        const newScores = { ...prevScores };
        const matchedId = ids[removedIndex];
        if (matchedId) delete newScores[matchedId];
        if (track.id) delete newScores[track.id];
        const recIndex = get().recommendedTrackIndex;
        const newIndex = removedIndex <= recIndex ? recIndex : recIndex - 1;
        const clampedIndex = newIds.length === 0 ? 0 : Math.max(0, Math.min(newIds.length - 1, newIndex));
        const currentReasons = get().recommendedTrackReasons;
        const newReasons = currentReasons.length === ids.length ? currentReasons.filter((_, i) => i !== removedIndex) : newIds.map(() => '');
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'store.ts:setCurrentTrack',message:'setCurrentTrack',data:{idsLen:ids.length,removedIndex,recIndex,newIndex,clampedIndex,newIdsLen:newIds.length},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
        set({ recommendedTrackIds: newIds, recommendedTrackReasons: newReasons, recommendedTrackScores: newScores, recommendedTrackIndex: clampedIndex });
        const username = getCurrentUser();
        if (username) setPlaylist(username, newIds, get().currentSystem).catch(() => {});
        // 待播列表剩余 ≤1 首时，后台预拉新推荐并追加到列表末尾，避免用户播完最后一首再等
        if (username && newIds.length <= 1) {
          (async () => {
            try {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'store.ts:preload_start',message:'preload_start',data:{newIdsLen:newIds.length},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
              // #endregion
              appendSystemLog('[推荐] 待播列表即将播完，后台预拉新推荐...');
              const latestPreferences = get().getUserPreferences();
              const result = await getRecommendations({
                username,
                systemType: get().currentSystem,
                currentTrackId: track?.id,
                explicitPreferences: latestPreferences,
                count: 10,
                trigger: 'playlist_finished',
              });
              const appendIds = result.recommendedTracks || [];
              if (appendIds.length === 0) return;
              const state = get();
              const currentIds = state.recommendedTrackIds;
              const currentReasons = state.recommendedTrackReasons;
              const currentScores = state.recommendedTrackScores;
              const currentDetails = state.recommendedTrackDetails;
              const mergedIds = [...currentIds, ...appendIds];
              const appendReason = '待播列表已播完，请求新推荐';
              const mergedReasons = currentReasons.length === currentIds.length
                ? [...currentReasons, ...appendIds.map(() => appendReason)]
                : mergedIds.map(() => appendReason);
              const mergedScores = { ...currentScores };
              appendIds.forEach((id, i) => {
                mergedScores[id] = (result.recommendedScores && result.recommendedScores[i] !== undefined)
                  ? result.recommendedScores[i] : 0;
              });
              const mergedDetails = { ...currentDetails };
              (result.firstTracks || []).forEach((t) => {
                if (t && t.id) mergedDetails[t.id] = t as JamendoTrack;
              });
              const now = Date.now();
              const mergedRequestedAt = { ...state.recommendedTrackRequestedAt, ...Object.fromEntries(appendIds.map((id) => [id, now])) };
              const nextIndex = currentIds.length;
              set({ recommendedTrackIds: mergedIds, recommendedTrackReasons: mergedReasons, recommendedTrackScores: mergedScores, recommendedTrackDetails: mergedDetails, recommendedTrackRequestedAt: mergedRequestedAt, recommendedTrackIndex: nextIndex });
              setPlaylist(getCurrentUser() ?? '', mergedIds, get().currentSystem).catch(() => {});
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'store.ts:preload_done',message:'preload_done',data:{currentIdsLen:currentIds.length,mergedIdsLen:mergedIds.length,nextIndex},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
              // #endregion
              appendSystemLog(`[推荐] 后台预拉完成，待播列表追加 ${appendIds.length} 首，共 ${mergedIds.length} 首`);
            } catch (e) {
              console.warn('待播列表预拉新推荐失败:', e);
              appendSystemLog(`[推荐] 后台预拉失败: ${e instanceof Error ? e.message : String(e)}`);
            }
          })();
        }
      },
      setCurrentTrackIndex: (index) => set({ currentTrackIndex: index }),
      setIsPlaying: (playing) => set({ isPlaying: playing }),
      setTrackIds: (ids) => set({ trackIds: ids }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),

      // 独立的收藏功能，不涉及评分
      addFavorite: async (track) => {
        const favorites = get().favorites;
        const existingIndex = favorites.findIndex(f => f.id === track.id);
        let newFavorites;
        if (existingIndex >= 0) {
          // 已收藏，不做任何操作（或者可以移除收藏）
          return;
        } else {
          // 添加新收藏，使用已有的评分（如果有）
          const existingRating = get().getRating(track.id);
          const favorite: FavoriteTrack = {
            ...track,
            rating: existingRating || 0, // 如果有评分就用评分，没有就是0
            favoritedAt: Date.now(),
          };
          newFavorites = [...favorites, favorite];
        }
        set({ favorites: newFavorites });
        saveToStorage(newFavorites, get().ratings, get().userPreferences, get().currentTrackIndex, get().history);
        
        // 当用户收藏歌曲时，将该歌曲的tags添加到用户偏好中（隐式偏好）
        if (track.tags) {
          const tagsToAdd = {
            genres: track.tags.genres || [],
            instruments: track.tags.instruments || [],
            moods: track.tags.moods || [],
            themes: track.tags.themes || [],
          };
          
          // 添加tags到用户偏好，给予最高权重（通过重复添加来增加权重）
          // 对于刚刚收藏的歌曲，我们添加3次来给予最高权重
          const favOpt = { operation: 'favorite' as const };
          for (let i = 0; i < 3; i++) {
            if (tagsToAdd.genres.length > 0) {
              await get().addUserPreference('genres', tagsToAdd.genres, favOpt);
            }
            if (tagsToAdd.instruments.length > 0) {
              await get().addUserPreference('instruments', tagsToAdd.instruments, favOpt);
            }
            if (tagsToAdd.moods.length > 0) {
              await get().addUserPreference('moods', tagsToAdd.moods, favOpt);
            }
            if (tagsToAdd.themes.length > 0) {
              await get().addUserPreference('themes', tagsToAdd.themes, favOpt);
            }
          }
          
          console.log(`✅ 已收藏歌曲 "${track.name}"，其tags已添加到用户偏好（最高权重）`);
          appendSystemLog(`[用户偏好] 已收藏歌曲 "${track.name}"，其tags已添加到用户偏好（最高权重） 原因: ${getPreferenceOperationLabel('favorite')}`);
        }
      },

      removeFavorite: (trackId) => {
        const newFavorites = get().favorites.filter(f => f.id !== trackId);
        set({ favorites: newFavorites });
        saveToStorage(newFavorites, get().ratings, get().userPreferences, get().currentTrackIndex, get().history);
      },

      // 独立的评分功能，不影响收藏状态
      setRating: (trackId, rating) => {
        const ratings = get().ratings;
        const existingIndex = ratings.findIndex(r => r.trackId === trackId);
        let newRatings;
        if (existingIndex >= 0) {
          const updated = [...ratings];
          updated[existingIndex] = { trackId, rating };
          newRatings = updated;
        } else {
          newRatings = [...ratings, { trackId, rating }];
        }
        set({ ratings: newRatings });
        
        // 如果该歌曲已收藏，同时更新收藏中的评分
        const favorites = get().favorites;
        const favoriteIndex = favorites.findIndex(f => f.id === trackId);
        if (favoriteIndex >= 0) {
          const updatedFavorites = [...favorites];
          updatedFavorites[favoriteIndex] = {
            ...updatedFavorites[favoriteIndex],
            rating,
          };
          set({ favorites: updatedFavorites });
          saveToStorage(updatedFavorites, newRatings, get().userPreferences, get().currentTrackIndex, get().history);
        } else {
          saveToStorage(favorites, newRatings, get().userPreferences, get().currentTrackIndex, get().history);
        }
      },

      getRating: (trackId) => {
        const rating = get().ratings.find(r => r.trackId === trackId);
        return rating ? rating.rating : 0;
      },

      addUserPreference: async (type, items, options) => {
        const preferences = get().userPreferences;
        // 确保 currentItems 是数组
        const currentItems = Array.isArray(preferences[type]) ? preferences[type] : [];
        // 添加新项目，避免重复
        const newItems = [...new Set([...currentItems, ...items])];
        
        // 检查是否有实际更新（避免重复添加导致不必要的清空推荐列表）
        const hasChange = newItems.length !== currentItems.length || 
          items.some(item => !currentItems.includes(item));

        if (hasChange) {
          const weightKey = (type === 'genres' ? 'genresWeights' : type === 'instruments' ? 'instrumentsWeights' : type === 'moods' ? 'moodsWeights' : 'themesWeights') as keyof UserPreference;
          const currentWeights = (preferences[weightKey] as Record<string, number> | undefined) || {};
          const newWeights = { ...currentWeights };
          items.forEach((item) => { newWeights[item] = newWeights[item] ?? 1; });
          const updatedPreferences = {
            ...preferences,
            [type]: newItems,
            [weightKey]: newWeights,
          };
          const op = options?.operation;
          const isConfirmOp = op === 'rating_confirm' || op === 'one_minute_confirm' || op === 'ninety_five_confirm' || op === 'conflict_confirm';
          const keepPlaylist = isConfirmOp || op === 'favorite' || op === 'first_login' || op === 'conversation';
          set({ userPreferences: updatedPreferences });
          saveToStorage(get().favorites, get().ratings, updatedPreferences, get().currentTrackIndex, get().history);

          const newVersion = get().preferencesVersion + 1;
          if (isConfirmOp) {
            // 「是这样的」等确认操作：保留原待播列表，仅增加偏好版本号；后面会拉新推荐插入最前
            set({ preferencesVersion: newVersion });
            console.log(`🔄 用户偏好已更新 (版本: ${newVersion})，保留待播列表，将拉取新推荐插入最前`);
            appendSystemLog(`[用户偏好] 用户偏好已更新 (版本: ${newVersion})，保留待播列表，将拉取新推荐插入最前 原因: ${getPreferenceOperationLabel(op)}`);
          } else if (op === 'favorite') {
            // 收藏：只更新偏好与版本号，不清空待播列表，避免点击收藏后列表立刻被清空
            set({ preferencesVersion: newVersion });
            console.log(`🔄 用户偏好已更新 (版本: ${newVersion})，收藏导致，保留待播列表`);
            appendSystemLog(`[用户偏好] 用户偏好已更新 (版本: ${newVersion})，收藏导致，保留待播列表 原因: ${getPreferenceOperationLabel(op)}`);
          } else if (!keepPlaylist) {
            // 其他非对话/冷启动的偏好更新：清空待播，下次重新拉取
            set({
              preferencesVersion: newVersion,
              recommendedTrackIds: [],
              recommendedTrackIndex: 0,
            });
            console.log(`🔄 用户偏好已更新 (版本: ${newVersion})，已清空推荐列表，下次将根据新偏好重新拉取`);
            appendSystemLog(`[用户偏好] 用户偏好已更新 (版本: ${newVersion})，已清空推荐列表，下次将根据新偏好重新拉取 原因: ${getPreferenceOperationLabel(op)}`);
          } else {
            // 用户主动表达喜欢/澄清风格：不清空待播，仅增加版本号；后面按新 tag 拉推荐插入最前，原列表后移
            set({ preferencesVersion: newVersion });
            console.log(`🔄 用户偏好已更新 (版本: ${newVersion})，保留待播列表，将按新 tag 拉推荐插入最前`);
            appendSystemLog(`[用户偏好] 用户偏好已更新 (版本: ${newVersion})，保留待播列表，将按新 tag 拉推荐插入最前 原因: ${getPreferenceOperationLabel(op)}`);
          }

          const currentUser = getCurrentUser();
          if (currentUser) {
            try {
              await saveUserPreferences(currentUser, updatedPreferences, {
                operation: options?.operation,
                conversationContent: options?.conversationContent,
                systemType: get().currentSystem,
              });
              set({ lastPreferenceOperation: options?.operation });
              const w = updatedPreferences[weightKey] as Record<string, number> | undefined;
              const withWeights = newItems.map((t) => (w && w[t] != null ? `${t}(${w[t]})` : t)).join(', ');
              console.log(`✅ 用户偏好已保存到数据库: ${type} = [${withWeights}]`);
              appendSystemLog(`[用户偏好] 已保存到数据库: ${type} = [${withWeights}] 原因: ${getPreferenceOperationLabel(op)}`);
              if (op === 'first_login' || op === 'conversation') {
                // 用户主动表达喜欢/澄清：仅用该（或该几个）tag 作为第一权重拉推荐，插队到待播最前，原列表后移
                const onlyNewTagPrefs = {
                  genres: type === 'genres' ? items : [],
                  instruments: type === 'instruments' ? items : [],
                  moods: type === 'moods' ? items : [],
                  themes: type === 'themes' ? items : [],
                };
                appendSystemLog('[推荐] 已发送推荐请求（用户表达喜欢/澄清），正在等待推荐接口返回...');
                getRecommendations({
                  username: currentUser,
                  systemType: get().currentSystem,
                  currentTrackId: get().currentTrack?.id ?? undefined,
                  explicitPreferences: onlyNewTagPrefs,
                  count: 5,
                  trigger: 'user_expressed_preference',
                })
                  .then(async (result) => {
                    appendSystemLog(`[推荐] 请求完成，共 ${result.recommendedTracks?.length ?? 0} 首`);
                    if (result.recommendedTracks?.length > 0) {
                      const existing = get().recommendedTrackIds;
                      const existingReasons = get().recommendedTrackReasons;
                      const existingSet = new Set(result.recommendedTracks);
                      const rest = existing.filter((id) => !existingSet.has(id));
                      const newList = [...result.recommendedTracks, ...rest];
                      const insertReason = '用户表达喜欢/澄清，插入待播最前';
                      const newReasons = existingReasons.length === existing.length
                        ? [...result.recommendedTracks.map(() => insertReason), ...rest.map((id) => { const idx = existing.indexOf(id); return idx >= 0 && idx < existingReasons.length ? existingReasons[idx] : ''; })]
                        : newList.map(() => insertReason);
                      const prevScores = get().recommendedTrackScores;
                      const prevRequestedAt = get().recommendedTrackRequestedAt;
                      const newScores: Record<string, number> = {};
                      const scoresArr = result.recommendedScores;
                      newList.forEach((id, i) => {
                        newScores[id] = (Array.isArray(scoresArr) && i < scoresArr.length ? scoresArr[i] : undefined) ?? prevScores[id] ?? 0;
                      });
                      const now = Date.now();
                      const newRequestedAt: Record<string, number> = { ...prevRequestedAt };
                      result.recommendedTracks.forEach((id) => { newRequestedAt[id] = now; });
                      set({ recommendedTrackIds: newList, recommendedTrackReasons: newReasons, recommendedTrackScores: newScores, recommendedTrackRequestedAt: newRequestedAt, recommendedTrackIndex: 0, lastRecommendationPreferencesVersion: newVersion });
                      if (currentUser) setPlaylist(currentUser, newList, get().currentSystem).catch(() => {});
                      console.log(`🔄 已按新 tag [${type}: ${items.join(',')}] 拉取 ${result.recommendedTracks.length} 首并插入待播列表最前，原列表后移`);
                      appendSystemLog(`[推荐] 用户表达喜欢/澄清：拉取 ${result.recommendedTracks.length} 首插入待播最前，原列表后移`);
                    }
                  })
                  .catch((err) => {
                    console.warn('预拉取推荐列表失败:', err);
                    appendSystemLog(`[推荐] 请求失败: ${err instanceof Error ? err.message : String(err)}`);
                  });
              } else if (isConfirmOp) {
                appendSystemLog('[推荐] 已发送推荐请求（确认偏好/是这样的），正在等待推荐接口返回...');
                getRecommendations({
                  username: currentUser,
                  systemType: get().currentSystem,
                  currentTrackId: get().currentTrack?.id ?? undefined,
                  explicitPreferences: updatedPreferences,
                  count: 5,
                  trigger: 'preferences_updated',
                  preferenceUpdateReason: get().lastPreferenceOperation,
                })
                  .then(async (result) => {
                    appendSystemLog(`[推荐] 请求完成，共 ${result.recommendedTracks?.length ?? 0} 首`);
                    if (result.recommendedTracks?.length > 0) {
                      const existing = get().recommendedTrackIds;
                      const existingReasons = get().recommendedTrackReasons;
                      const existingSet = new Set(result.recommendedTracks);
                      const rest = existing.filter((id) => !existingSet.has(id));
                      const newList = [...result.recommendedTracks, ...rest];
                      const insertReason = '确认偏好（是这样的），插入待播最前';
                      const newReasons = existingReasons.length === existing.length
                        ? [...result.recommendedTracks.map(() => insertReason), ...rest.map((id) => { const idx = existing.indexOf(id); return idx >= 0 && idx < existingReasons.length ? existingReasons[idx] : ''; })]
                        : newList.map(() => insertReason);
                      const prevScores = get().recommendedTrackScores;
                      const prevRequestedAt = get().recommendedTrackRequestedAt;
                      const newScores: Record<string, number> = { ...prevScores };
                      const scoresArr = result.recommendedScores;
                      result.recommendedTracks.forEach((id, i) => {
                        newScores[id] = (Array.isArray(scoresArr) && i < scoresArr.length ? scoresArr[i] : undefined) ?? prevScores[id] ?? 0;
                      });
                      const now = Date.now();
                      const newRequestedAt: Record<string, number> = { ...prevRequestedAt };
                      result.recommendedTracks.forEach((id) => { newRequestedAt[id] = now; });
                      set({ recommendedTrackIds: newList, recommendedTrackReasons: newReasons, recommendedTrackScores: newScores, recommendedTrackRequestedAt: newRequestedAt, recommendedTrackIndex: 0, lastRecommendationPreferencesVersion: newVersion });
                      setPlaylist(currentUser, newList, get().currentSystem).catch(() => {});
                      console.log(`🔄 确认偏好（是这样的）后拉取 ${result.recommendedTracks.length} 首并插入待播列表最前，原列表后移`);
                      appendSystemLog(`[推荐] 确认偏好（是这样的）后拉取 ${result.recommendedTracks.length} 首并插入待播列表最前，原列表后移`);
                    }
                  })
                  .catch((err) => {
                    console.warn('确认偏好后拉取推荐失败:', err);
                    appendSystemLog(`[推荐] 请求失败: ${err instanceof Error ? err.message : String(err)}`);
                  });
              }
            } catch (error) {
              console.error('保存用户偏好到数据库失败:', error);
            }
          }
        }
      },

      removeUserPreference: async (type, itemsToRemove, options) => {
        await get().removeUserPreferenceBatch([{ type, items: itemsToRemove }], options);
      },

      removeUserPreferenceBatch: async (removals, options) => {
        if (!removals.length) return;
        const preferences = get().userPreferences;
        const updatedPreferences = { ...preferences };
        let hasChange = false;
        const weightKeys: Record<string, keyof UserPreference> = { genres: 'genresWeights', instruments: 'instrumentsWeights', moods: 'moodsWeights', themes: 'themesWeights' };
        for (const { type, items } of removals) {
          const currentItems = Array.isArray(updatedPreferences[type]) ? updatedPreferences[type] : [];
          const newItems = currentItems.filter((x) => !items.includes(x));
          if (newItems.length !== currentItems.length) {
            updatedPreferences[type] = newItems;
            const wKey = weightKeys[type];
            const currentW = (updatedPreferences[wKey] as Record<string, number> | undefined) || {};
            const newW: Record<string, number> = {};
            newItems.forEach((t) => { if (currentW[t] != null) newW[t] = currentW[t]; });
            (updatedPreferences as Record<string, unknown>)[wKey] = newW;
            hasChange = true;
          }
        }

        const currentUser = getCurrentUser();
        if (!currentUser) return;

        // 只要用户表达了不喜欢（removals 非空），就一定要触发推荐更新并替换列表（排除这些 tag）
        const excludedTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] } = {
          genres: [],
          instruments: [],
          moods: [],
          themes: [],
        };
        for (const { type, items } of removals) {
          excludedTags[type].push(...items);
        }
        for (const k of ['genres', 'instruments', 'moods', 'themes'] as const) {
          excludedTags[k] = [...new Set(excludedTags[k])];
        }

        const newVersion = hasChange ? get().preferencesVersion + 1 : get().preferencesVersion;
        const existingPlaylist = get().recommendedTrackIds;
        if (hasChange) {
          set({ userPreferences: updatedPreferences });
          saveToStorage(get().favorites, get().ratings, updatedPreferences, get().currentTrackIndex, get().history);
          set({ preferencesVersion: newVersion });
          try {
            // 每次偏好更新都写 DB 两表：saveUserPreferences 会令后端同时更新 user_preferences 与 user_preference_updates
            await saveUserPreferences(currentUser, updatedPreferences, {
              operation: options?.operation ?? 'dislike_remove',
              conversationContent: options?.conversationContent ?? undefined,
              systemType: get().currentSystem,
            });
            set({ lastPreferenceOperation: options?.operation ?? 'dislike_remove' });
            console.log(`✅ 用户偏好已更新（移除厌恶 tag）并已保存到数据库`);
            appendSystemLog(`[用户偏好] 用户表达厌恶，已更新偏好并保存 原因: ${getPreferenceOperationLabel(options?.operation ?? 'dislike_remove')}`);
          } catch (error) {
            console.error('保存偏好失败（移除 tag）:', error);
          }
        } else {
          console.log(`✅ 用户表达不喜欢（偏好中无这些 tag），仍排除并重新拉取推荐: ${JSON.stringify(excludedTags)}`);
          appendSystemLog(`[用户偏好] 用户表达不喜欢，排除 tag 并重新拉取推荐: ${JSON.stringify(excludedTags)} 原因: ${getPreferenceOperationLabel(options?.operation ?? 'dislike_remove')}`);
        }

        const prefsForRecommend = hasChange ? updatedPreferences : preferences;
        try {
          appendSystemLog('[推荐] 已发送推荐请求（不喜欢/排除 tag），正在等待推荐接口返回...');
          getRecommendations({
            username: currentUser,
            systemType: get().currentSystem,
            currentTrackId: get().currentTrack?.id ?? undefined,
            explicitPreferences: prefsForRecommend,
            excludedTags,
            currentPlaylist: existingPlaylist,
            count: 10,
            trigger: 'user_dislike_remove',
            preferenceUpdateReason: get().lastPreferenceOperation,
          })
            .then(async (result) => {
              appendSystemLog(`[推荐] 请求完成，共 ${result.recommendedTracks?.length ?? 0} 首`);
              const filtered = result.filteredPlaylist ?? [];
              const newList = [...result.recommendedTracks, ...filtered];
              if (newList.length > 0) {
                const prevScores = get().recommendedTrackScores;
                const scoresArr = result.recommendedScores;
                const newScores = newList.map((id, i) =>
                  (Array.isArray(scoresArr) && i < scoresArr.length && scoresArr[i] != null)
                    ? scoresArr[i]
                    : (prevScores[id] ?? 0)
                );
                get().setRecommendedTrackIds(newList, newScores, result.firstTracks, '用户表达厌恶，重新拉取推荐');
                set({ lastRecommendationPreferencesVersion: get().preferencesVersion });
                setPlaylist(currentUser, newList, get().currentSystem).catch(() => {});
                console.log(`🔄 已按不喜欢排除 tag 拉取 ${result.recommendedTracks.length} 首插入待播最前，原列表中含该 tag 的已移除，其余后移`);
                appendSystemLog(`[推荐] 厌恶偏好：拉取 ${result.recommendedTracks.length} 首插入待播最前，原列表中含厌恶 tag 的曲目已移除，其余后移`);
              }
            })
            .catch((err) => {
              console.warn('移除 tag 后拉取推荐失败:', err);
              appendSystemLog(`[推荐] 请求失败: ${err instanceof Error ? err.message : String(err)}`);
            });
        } catch (_) {}
      },

      incrementPreferencesVersion: () => {
        set((state) => ({ preferencesVersion: state.preferencesVersion + 1 }));
      },

      incrementConsecutivePlayCount: () => {
        set((state) => ({ consecutivePlayCount: state.consecutivePlayCount + 1 }));
      },

      resetConsecutivePlayCount: () => {
        set({ consecutivePlayCount: 0 });
      },

      getUserPreferences: () => {
        return get().userPreferences;
      },

      replaceUserPreferences: (prefs) => {
        set((s) => ({ userPreferences: prefs, preferencesVersion: s.preferencesVersion + 1 }));
        saveToStorage(get().favorites, get().ratings, prefs, get().currentTrackIndex, get().history);
      },

      addHistoryRecord: (track, duration) => {
        const history = get().history;
        const newRecord: HistoryRecord = {
          trackId: track.id,
          name: track.name,
          artist_name: track.artist_name,
          album_name: track.album_name,
          image: track.image,
          audio: track.audio,
          playedAt: Date.now(),
          duration: duration,
        };
        // 添加到数组开头（最新的在上面）
        const updatedHistory = [newRecord, ...history];
        set({ history: updatedHistory });
        saveToStorage(get().favorites, get().ratings, get().userPreferences, get().currentTrackIndex, updatedHistory);
      },

      getHistory: () => {
        return get().history;
      },

      loadRandomTrack: async () => {
        const { setLoading, setError, setCurrentTrack, setIsPlaying, currentTrack, recommendedTrackIds, recommendedTrackIndex, setRecommendedTrackIds, setRecommendedTrackIndex } = get();
        const username = getCurrentUser();
        // 要播的歌必须来自待播列表：有待播则按序播，无则需登录后请求推荐，不依赖后端 trackIds
        if (!username && recommendedTrackIds.length === 0) return;

        setError(null);
        // 不在此处 setLoading(true)，仅当待播列表无剩余可播、需要请求推荐时才显示加载态
        const listEmpty = recommendedTrackIds.length === 0;
        appendSystemLog(listEmpty ? '[推荐] 已点击推荐下一首，待播列表为空，正在请求推荐…' : '[推荐] 已点击推荐下一首，正在处理…');
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'store.ts:loadRandomTrack_start',message:'loadRandomTrack_start',data:{recommendedTrackIdsLen:recommendedTrackIds.length,recommendedTrackIndex},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
        // #endregion

        try {
          /** 本次若请求了推荐且后端返回了首曲详情，则直接用于播放，避免再请求 Jamendo */
          let lastFirstTrackFromApi = null as Awaited<ReturnType<typeof getRecommendations>>['firstTrack'];
          let currentRecommendedIds = recommendedTrackIds;
          let currentIndex = recommendedTrackIndex;

          // 下一首永远按待播列表顺序往下播：从 currentIndex 起按序尝试播放；若下一首在历史记录里则跳过
          const detailsCache = get().recommendedTrackDetails;
          const normIdForSkip = (id: string | number) => String(id).replace(/^track_0*/, '');
          const currentTrackNorm = currentTrack?.id ? normIdForSkip(currentTrack.id) : '';
          const history = get().history;
          const historyIdSet = new Set(history.map((r) => normIdForSkip(r.trackId)));
          const maxTry = Math.min(currentRecommendedIds.length - currentIndex, 15);
          for (let offset = 0; offset < maxTry; offset++) {
            const idx = currentIndex + offset;
            if (idx >= currentRecommendedIds.length) break;
            const selectedTrackId = currentRecommendedIds[idx];
            if (!selectedTrackId) continue;
            if (currentTrackNorm && normIdForSkip(selectedTrackId) === currentTrackNorm) continue;
            if (historyIdSet.has(normIdForSkip(selectedTrackId))) continue;
            let track = detailsCache[selectedTrackId] || null;
            if (!track) {
              try {
                track = await jamendoApi.getTrackById(selectedTrackId);
              } catch {
                continue;
              }
            }
            if (track) {
              setRecommendedTrackIndex(idx + 1);
              setCurrentTrack(track);
              set({ currentTrackIndex: idx });
              saveToStorage(get().favorites, get().ratings, get().userPreferences, idx, get().history);
              setIsPlaying(true);
              setLoading(false);
              if (currentRecommendedIds.length - (idx + 1) <= 2) {
                get().preloadNextRecommendationsIfNeeded();
              }
              // 播放中不以 getPlaylist 覆盖客户端列表，避免服务端顺序/含已播曲导致跳播；待播列表以客户端为准，只通过 setPlaylist 同步到服务端
              return;
            }
          }

          // 待播列表无剩余可直接播放的歌曲，需要请求推荐/待播列表，此时才显示加载态
          setLoading(true);
          // 列表已耗尽时直接走推荐接口，不等待 GET 待播列表（后端扩展会阻塞），保证「推荐下一首」快
          const isExhausted = currentRecommendedIds.length === 0 || currentIndex >= currentRecommendedIds.length;
          if (username && !isExhausted) {
            const oldLength = currentRecommendedIds.length;
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'store.ts:getPlaylist_call',message:'getPlaylist_call',data:{currentIndex,currentRecommendedIdsLen:currentRecommendedIds.length},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
            // #endregion
            appendSystemLog('[待播列表] 已发送请求，正在等待后端返回待播列表...');
            const playlistRes = await getPlaylist(username, currentIndex, get().currentSystem);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'store.ts:getPlaylist_done',message:'getPlaylist_done',data:{playlistTrackIdsLen:playlistRes.trackIds?.length??0,success:playlistRes.success},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
            // #endregion
            appendSystemLog(playlistRes.success && playlistRes.trackIds.length > 0
              ? `[待播列表] 请求完成，共 ${playlistRes.trackIds.length} 首`
              : '[待播列表] 请求完成，列表为空');
            // 有待播列表时不以服务端列表覆盖客户端，保证严格按当前待播列表顺序播
            if (playlistRes.success && playlistRes.trackIds.length > 0) {
              currentRecommendedIds = get().recommendedTrackIds;
              const exhausted = currentIndex >= oldLength || currentIndex >= currentRecommendedIds.length;
              if (exhausted) {
                currentIndex = 0;
                setRecommendedTrackIndex(0);
              }
            }
          } else if (username && isExhausted) {
            currentIndex = 0;
            setRecommendedTrackIndex(0);
          }
          
          const timestamp = new Date().toLocaleString('zh-CN', { 
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
          
          // 检查用户偏好是否已更新
          const currentPreferencesVersion = get().preferencesVersion;
          const lastRecommendationVersion = get().lastRecommendationPreferencesVersion || 0;
          const preferencesUpdated = currentPreferencesVersion > lastRecommendationVersion;
          
          // 用户偏好已更新：用推荐接口拿新列表并同步到后台待播列表（并清空旧预拉，避免用到过期下一批）
          if (preferencesUpdated && username) {
            set({ preloadedNextBatch: null });
            console.log(`🔄 [${timestamp}] 检测到用户偏好已更新，重新获取推荐列表...`);
            appendSystemLog(`[用户偏好] 检测到用户偏好已更新，重新获取推荐列表... 原因: 偏好版本变化触发重新拉取`);
            try {
              const latestPreferences = get().getUserPreferences();
              appendSystemLog('[推荐] 已发送推荐请求（偏好更新），正在等待推荐接口返回...');
              const result = await getRecommendations({
                username,
                systemType: get().currentSystem,
                currentTrackId: currentTrack?.id,
                explicitPreferences: latestPreferences,
                count: 10,
                trigger: 'preferences_updated',
                preferenceUpdateReason: get().lastPreferenceOperation,
              });
              appendSystemLog(`[推荐] 请求完成，共 ${result.recommendedTracks.length} 首`);
              currentRecommendedIds = result.recommendedTracks;
              lastFirstTrackFromApi = result.firstTrack ?? null;
              setRecommendedTrackIds(currentRecommendedIds, result.recommendedScores, result.firstTracks, '用户偏好已更新');
              setRecommendedTrackIndex(0);
              set({ lastRecommendationPreferencesVersion: currentPreferencesVersion });
              currentIndex = 0;
              setPlaylist(username, currentRecommendedIds, get().currentSystem).catch(() => {});
              console.log(`✅ [${timestamp}] 已更新推荐列表并同步待播列表，共 ${currentRecommendedIds.length} 首`);
              appendSystemLog(`[推荐] 已更新推荐列表并同步待播列表，共 ${currentRecommendedIds.length} 首`);
            } catch (e) {
              console.warn(`⚠️ [${timestamp}] 推荐API调用失败:`, e);
              appendSystemLog(`[推荐] 请求失败: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
          // 待播列表为空或已播到最后一首时：优先用预拉结果，无则再请求推荐接口
          if ((currentRecommendedIds.length === 0 || currentIndex >= currentRecommendedIds.length) && username) {
            const preloaded = get().preloadedNextBatch;
            if (preloaded && preloaded.trackIds.length > 0) {
              set({ preloadedNextBatch: null });
              currentRecommendedIds = preloaded.trackIds;
              lastFirstTrackFromApi = preloaded.firstTracks?.[0] ?? null;
              setRecommendedTrackIds(currentRecommendedIds, preloaded.scores, preloaded.firstTracks, '使用预拉下一批');
              setRecommendedTrackIndex(0);
              currentIndex = 0;
              setPlaylist(username, currentRecommendedIds, get().currentSystem).catch(() => {});
              appendSystemLog(`[推荐] 使用预拉下一批，共 ${currentRecommendedIds.length} 首，无需等待`);
            } else {
              try {
                const listEmpty = currentRecommendedIds.length === 0;
                appendSystemLog(listEmpty ? '[推荐] 待播列表为空，正在请求推荐...' : '[推荐] 已播到列表最后一首，正在请求新推荐...');
                const latestPreferences = get().getUserPreferences();
                const result = await getRecommendations({
                  username,
                  systemType: get().currentSystem,
                  currentTrackId: currentTrack?.id,
                  explicitPreferences: latestPreferences,
                  count: 10,
                  trigger: 'playlist_finished',
                });
                if (result.recommendedTracks && result.recommendedTracks.length > 0) {
                  const existingIds = get().recommendedTrackIds;
                  if (existingIds.length > result.recommendedTracks.length) {
                    currentRecommendedIds = existingIds;
                    currentIndex = get().recommendedTrackIndex;
                    appendSystemLog(`[推荐] 使用预拉合并列表，共 ${currentRecommendedIds.length} 首`);
                  } else {
                    currentRecommendedIds = result.recommendedTracks;
                    lastFirstTrackFromApi = result.firstTrack ?? null;
                    setRecommendedTrackIds(currentRecommendedIds, result.recommendedScores ?? [], result.firstTracks, '待播列表已播完，请求新推荐');
                    setRecommendedTrackIndex(0);
                    currentIndex = 0;
                    setPlaylist(username, currentRecommendedIds, get().currentSystem).catch(() => {});
                    appendSystemLog(`[推荐] 待播列表已更新，共 ${currentRecommendedIds.length} 首`);
                  }
                }
              } catch (e) {
                console.warn(`⚠️ [${timestamp}] 待播列表用尽时推荐请求失败:`, e);
                appendSystemLog(`[推荐] 请求失败: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
            // 不随机选歌：待播列表为空时保持为空，下方会 setError 提示用户
          }
          if (currentRecommendedIds.length > 0 && currentIndex < currentRecommendedIds.length) {
            console.log(`📋 [${timestamp}] 使用待播列表，当前索引: ${currentIndex}/${currentRecommendedIds.length}`);
            console.log(`   下一首: ${currentRecommendedIds[currentIndex] || '无'}`);
          }

          // 从推荐列表中取下一首；优先用缓存的曲目详情（后端返回的 firstTracks），无缓存再请求 Jamendo
          const normId = (id: string | number) => String(id).replace(/^track_0*/, '');
          let track = null;
          let selectedTrackId = '';
          const trackDetailsCache = get().recommendedTrackDetails;
          if (lastFirstTrackFromApi && currentIndex === 0 && currentRecommendedIds.length > 0 && normId(currentRecommendedIds[0]) === normId(lastFirstTrackFromApi.id)) {
            track = lastFirstTrackFromApi;
            selectedTrackId = lastFirstTrackFromApi.id;
            setRecommendedTrackIndex(1);
          }
          let attempts = track ? 1 : 0;
          const maxAttempts = Math.min(currentRecommendedIds.length - currentIndex, 10);
          let lastRecommendError: unknown = null;

          const getCachedTrack = (id: string) => trackDetailsCache[id] ?? trackDetailsCache[normId(id)] ?? null;
          while (!track && attempts < maxAttempts) {
            const nextIndex = currentIndex + attempts;
            if (nextIndex >= currentRecommendedIds.length) break;
            selectedTrackId = currentRecommendedIds[nextIndex];
            if (!selectedTrackId) {
              attempts++;
              continue;
            }
            const cached = getCachedTrack(selectedTrackId);
            if (cached) {
              track = cached;
              setRecommendedTrackIndex(nextIndex + 1);
              const ts = new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
              console.log(`✅ [${ts}] 使用缓存曲目 - track_id: ${selectedTrackId}，索引: ${nextIndex + 1}/${currentRecommendedIds.length}`);
              appendSystemLog(`[推荐] 使用缓存曲目 - track_id: ${selectedTrackId}，索引: ${nextIndex + 1}/${currentRecommendedIds.length}`);
              break;
            }
            try {
              track = await jamendoApi.getTrackById(selectedTrackId);
              setRecommendedTrackIndex(nextIndex + 1);
              const timestamp = new Date().toLocaleString('zh-CN', { 
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
              });
              console.log(`✅ [${timestamp}] 成功加载推荐歌曲 - track_id: ${selectedTrackId}，索引: ${nextIndex + 1}/${currentRecommendedIds.length}`);
              appendSystemLog(`[推荐] 成功加载推荐歌曲 - track_id: ${selectedTrackId}，索引: ${nextIndex + 1}/${currentRecommendedIds.length}`);
              break;
            } catch (error) {
              lastRecommendError = error;
              console.warn(`Track ${selectedTrackId} not found, trying next...`);
              setRecommendedTrackIndex(nextIndex + 1);
              attempts++;
            }
          }

          if (!track && currentRecommendedIds.length > 0) {
            const reason = lastRecommendError instanceof Error ? lastRecommendError.message : (typeof lastRecommendError === 'string' ? lastRecommendError : '推荐曲目无法获取');
            const errMsg = `推荐列表加载失败：${reason}。请检查网络或稍后重试。`;
            console.warn('推荐列表都失败:', errMsg);
            appendSystemLog('[推荐] 推荐列表都失败，' + reason);
            setError(errMsg);
          }

          if (track) {
            const listIndex = get().recommendedTrackIndex - 1;
            setCurrentTrack(track);
            set({ currentTrackIndex: listIndex >= 0 ? listIndex : 0 });
            saveToStorage(get().favorites, get().ratings, get().userPreferences, listIndex >= 0 ? listIndex : 0, get().history);
            setIsPlaying(true); // 自动播放新歌曲
            // 剩余 ≤2 首时在列表下方补充新推荐
            const nextIdx = get().recommendedTrackIndex;
            const total = get().recommendedTrackIds.length;
            if (total - nextIdx <= 2) {
              get().preloadNextRecommendationsIfNeeded();
            }
          } else if (currentRecommendedIds.length === 0) {
            setError('无法找到可播放的歌曲，请检查网络连接或稍后重试');
          }
        } catch (error) {
          console.error('加载推荐歌曲失败:', error);
          setError('加载推荐歌曲失败: ' + (error instanceof Error ? error.message : '未知错误'));
        }

        setLoading(false);
      },

      playNextFromList: async () => {
        const { recommendedTrackIds, recommendedTrackIndex, recommendedTrackDetails, setCurrentTrack, setIsPlaying, history } = get();
        if (recommendedTrackIds.length === 0 || recommendedTrackIndex >= recommendedTrackIds.length) return false;
        const normId = (id: string | number) => String(id).replace(/^track_0*/, '');
        const historyIdSet = new Set(history.map((r) => normId(r.trackId)));
        // 从当前下一首位置起，跳过已在历史记录中的曲目，选第一首未听过的播
        let idx = recommendedTrackIndex;
        while (idx < recommendedTrackIds.length && historyIdSet.has(normId(recommendedTrackIds[idx]))) idx++;
        if (idx >= recommendedTrackIds.length) return false;
        const selectedTrackId = recommendedTrackIds[idx];
        if (!selectedTrackId) return false;
        const cached = recommendedTrackDetails[selectedTrackId];
        let track = cached || null;
        if (!track) {
          try {
            track = await jamendoApi.getTrackById(selectedTrackId);
          } catch {
            return false;
          }
        }
        if (track) {
          setCurrentTrack(track); // 会从待播列表移除该曲并更新 recommendedTrackIndex
          setIsPlaying(true);
          return true;
        }
        return false;
      },

      togglePlayPause: () => {
        const newState = !get().isPlaying;
        set({ isPlaying: newState });
      },

      setCurrentTime: (time) => {
        set({ currentTime: time });
      },

      setRecommendedTrackIds: (ids, scores, detailsCache, reason) => {
        // #region agent log
        const prevLen = get().recommendedTrackIds.length;
        fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'store.ts:setRecommendedTrackIds',message:'setRecommendedTrackIds',data:{idsLen:ids.length,prevLen},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
        // #endregion
        const prev = get().recommendedTrackScores;
        const recommendedTrackScores: Record<string, number> = {};
        ids.forEach((id, i) => {
          recommendedTrackScores[id] = (Array.isArray(scores) && scores.length === ids.length && scores[i] !== undefined)
            ? scores[i] : (prev[id] ?? 0);
        });
        const recommendedTrackDetails = Array.isArray(detailsCache) && detailsCache.length > 0
          ? Object.fromEntries(detailsCache.map((t) => [t.id, t]))
          : get().recommendedTrackDetails;
        const recommendedTrackReasons = (reason != null && reason !== '') ? ids.map(() => reason) : ids.map(() => '');
        const now = Date.now();
        const recommendedTrackRequestedAt: Record<string, number> = {};
        ids.forEach((id) => { recommendedTrackRequestedAt[id] = now; });
        set({ recommendedTrackIds: ids, recommendedTrackReasons, recommendedTrackScores, recommendedTrackRequestedAt, recommendedTrackIndex: 0, recommendedTrackDetails });
      },

      setRecommendedTrackIndex: (index) => {
        set({ recommendedTrackIndex: index });
      },

      syncLastRecommendationVersion: () => {
        set({ lastRecommendationPreferencesVersion: get().preferencesVersion });
      },

      clearAllUserData: () => {
        // 清除所有用户数据
        const emptyFavorites: FavoriteTrack[] = [];
        const emptyRatings: TrackRating[] = [];
        const emptyPreferences: UserPreference = {
          genres: [],
          instruments: [],
          moods: [],
          themes: [],
          genresWeights: {},
          instrumentsWeights: {},
          moodsWeights: {},
          themesWeights: {},
        };
        const emptyHistory: HistoryRecord[] = [];
        
        set({
          favorites: emptyFavorites,
          ratings: emptyRatings,
          userPreferences: emptyPreferences,
          history: emptyHistory,
          currentTrackIndex: 0,
          recommendedTrackIds: [],
          recommendedTrackReasons: [],
          recommendedTrackScores: {},
          recommendedTrackRequestedAt: {},
          recommendedTrackIndex: 0,
          recommendedTrackDetails: {},
          currentTrack: null,
          isPlaying: false,
          consecutivePlayCount: 0,
        });
        
        // 保存到localStorage（清空状态）
        saveToStorage(emptyFavorites, emptyRatings, emptyPreferences, 0, emptyHistory);
      },

      hydrateFromStorage: () => {
        const raw = loadFromStorage();
        const favorites = Array.isArray(raw.favorites) ? raw.favorites : [];
        const ratings = Array.isArray(raw.ratings) ? (raw.ratings as TrackRating[]) : [];
        const wp = raw.userPreferences;
        const userPreferences = wp && typeof wp === 'object'
          ? {
              genres: Array.isArray(wp.genres) ? wp.genres : [],
              instruments: Array.isArray(wp.instruments) ? wp.instruments : [],
              moods: Array.isArray(wp.moods) ? wp.moods : [],
              themes: Array.isArray(wp.themes) ? wp.themes : [],
              genresWeights: wp.genresWeights && typeof wp.genresWeights === 'object' ? wp.genresWeights : {},
              instrumentsWeights: wp.instrumentsWeights && typeof wp.instrumentsWeights === 'object' ? wp.instrumentsWeights : {},
              moodsWeights: wp.moodsWeights && typeof wp.moodsWeights === 'object' ? wp.moodsWeights : {},
              themesWeights: wp.themesWeights && typeof wp.themesWeights === 'object' ? wp.themesWeights : {},
            }
          : { genres: [], instruments: [], moods: [], themes: [], genresWeights: {}, instrumentsWeights: {}, moodsWeights: {}, themesWeights: {} };
        const history = Array.isArray(raw.history) ? (raw.history as HistoryRecord[]) : [];
        const currentTrackIndex = typeof raw.currentTrackIndex === 'number' ? raw.currentTrackIndex : 0;
        set({
          favorites,
          ratings,
          userPreferences,
          history,
          currentTrackIndex,
          currentTrack: null,
          recommendedTrackIds: [],
          recommendedTrackReasons: [],
          recommendedTrackScores: {},
          recommendedTrackRequestedAt: {},
          recommendedTrackIndex: 0,
          recommendedTrackDetails: {},
          isPlaying: false,
          preferencesVersion: 0,
          lastPreferenceOperation: undefined,
          lastRecommendationPreferencesVersion: 0,
          consecutivePlayCount: 0,
        });
      },

    })
  );
