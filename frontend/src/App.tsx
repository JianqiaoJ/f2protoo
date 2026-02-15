import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from './store';
import { jamendoApi } from './api';
import MusicPlayer from './components/MusicPlayer';
import FavoritesList from './components/FavoritesList';
import AIAssistant from './components/AIAssistant';
import ColdStartTagSelect from './components/ColdStartTagSelect';
import Login from './components/Login';
import SerenSettingsModal from './components/SerenSettingsModal';
import { getCurrentUser, clearCurrentUserData } from './utils/storage';
import { clearAllUserDataOnServer } from './api/user';
import { setPlaylist } from './api/playlist';
import { getRecommendations } from './api/recommend';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    // 检查是否已登录
    return localStorage.getItem('isLoggedIn') === 'true';
  });
  const {
    trackIds,
    setTrackIds,
    currentTrackIndex,
    setCurrentTrack,
    setLoading,
    setError,
    clearAllUserData,
    getUserPreferences,
    currentTrack,
    currentSystem,
    setCurrentSystem,
    isPlaying,
    loading,
  } = usePlayerStore();
  const toggleSystem = () => setCurrentSystem(currentSystem === 'A' ? 'B' : 'A');
  const [showSerenSettings, setShowSerenSettings] = useState(false);
  /** 系统 A：双击「欢迎使用音乐推荐系统」可再次调出/隐藏标签选择窗口 */
  const [showTagSelectInA, setShowTagSelectInA] = useState(false);

  // 右侧面板（收藏/日志/历史）宽度百分比，可拖动中间分隔条调整
  const RIGHT_PANEL_STORAGE_KEY = 'rightPanelWidthPercent';
  const [rightPanelWidthPercent, setRightPanelWidthPercent] = useState(() => {
    const v = localStorage.getItem(RIGHT_PANEL_STORAGE_KEY);
    const n = Number(v);
    if (Number.isFinite(n) && n >= 15 && n <= 60) return n;
    return 25;
  });
  const latestPercentRef = useRef(rightPanelWidthPercent);
  latestPercentRef.current = rightPanelWidthPercent;

  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      const w = window.innerWidth;
      const x = ev.clientX;
      let p = ((w - x) / w) * 100;
      p = Math.min(60, Math.max(15, p));
      setRightPanelWidthPercent(p);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, String(latestPercentRef.current));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // 从第一首歌开始播放时开始计时（冷启动设置时间不算）；刷新不重置，仅退出登录/清除记录后重置；加载推荐时不计时（净听歌时间）
  const SESSION_START_KEY = (user: string) => `sessionStartTime-${user}`;
  const sessionStartTimeRef = useRef<number>(0);
  const loadingStartRef = useRef<number>(0);
  const totalPausedMsRef = useRef<number>(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // 刷新后从 localStorage 恢复计时起点
  useEffect(() => {
    const user = localStorage.getItem('currentUser');
    if (!user) return;
    const raw = localStorage.getItem(SESSION_START_KEY(user));
    if (raw) {
      const t = Number(raw);
      if (Number.isFinite(t) && t > 0) sessionStartTimeRef.current = t;
    }
  }, []);
  useEffect(() => {
    if (currentTrack && isPlaying && sessionStartTimeRef.current === 0) {
      const start = Date.now();
      sessionStartTimeRef.current = start;
      const user = localStorage.getItem('currentUser');
      if (user) localStorage.setItem(SESSION_START_KEY(user), String(start));
    }
  }, [currentTrack, isPlaying]);
  // 加载推荐期间不计时：进入 loading 时记录起点，离开时累加暂停时长
  useEffect(() => {
    if (loading) {
      loadingStartRef.current = Date.now();
    } else {
      if (loadingStartRef.current > 0) {
        totalPausedMsRef.current += Date.now() - loadingStartRef.current;
        loadingStartRef.current = 0;
      }
    }
  }, [loading]);
  
  // 检查是否是首次登录（没有用户偏好）
  const checkIsFirstLogin = () => {
    const prefs = getUserPreferences();
    return prefs.genres.length === 0 && 
           prefs.instruments.length === 0 && 
           prefs.moods.length === 0 && 
           prefs.themes.length === 0;
  };
  
  const [isAssistantVisible, setIsAssistantVisible] = useState(() => {
    // 首次登录时自动打开小助手
    return checkIsFirstLogin();
  });
  
  // 跟踪是否已经完成首次登录流程（一旦首次推荐完成，就不再使用蒙版模式）
  const [hasCompletedFirstLogin, setHasCompletedFirstLogin] = useState(() => {
    // 检查localStorage中是否有标记
    const currentUser = localStorage.getItem('currentUser');
    if (currentUser) {
      return localStorage.getItem(`hasCompletedFirstLogin-${currentUser}`) === 'true';
    }
    return false;
  });

  // 清除记录时递增，使小助手 remount 并重新从空 storage 加载，立刻回到冷启动对话
  const [assistantClearKey, setAssistantClearKey] = useState(0);

  // 首次推荐完成的回调
  const handleFirstRecommendation = () => {
    setIsAssistantVisible(false);
    setHasCompletedFirstLogin(true);
    // 保存标记到localStorage
    const currentUser = localStorage.getItem('currentUser');
    if (currentUser) {
      localStorage.setItem(`hasCompletedFirstLogin-${currentUser}`, 'true');
    }
  };

  useEffect(() => {
    // Load track IDs from TSV file；拿到 id 列表后立刻结束 loading，首曲在后台加载，登录不卡
    const loadTracks = async () => {
      if (trackIds.length > 0) return;

      setLoading(true);
      try {
        const ids = await jamendoApi.loadTrackIdsFromTSV();
        setTrackIds(ids);
        setLoading(false); // 立刻结束 loading，主界面先出来

        // 首次登录时不自动加载歌曲，等待用户输入偏好后推荐；有偏好时在后台加载首曲
        const userPrefs = usePlayerStore.getState().getUserPreferences();
        const hasPreferences = userPrefs.genres.length > 0 ||
          userPrefs.instruments.length > 0 ||
          userPrefs.moods.length > 0 ||
          userPrefs.themes.length > 0;

        if (hasPreferences && ids.length > 0) {
          let attempts = 0;
          const maxAttempts = Math.min(ids.length, 10);
          let index = currentTrackIndex;
          let track = null;
          while (attempts < maxAttempts && !track) {
            try {
              track = await jamendoApi.getTrackById(ids[index]);
              break;
            } catch (error) {
              console.warn(`Track ${ids[index]} not found, trying next...`);
              index = (index + 1) % ids.length;
              attempts++;
            }
          }
          if (track) {
            setCurrentTrack(track);
            usePlayerStore.getState().setCurrentTrackIndex(index);
          }
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : '加载失败');
        console.error('Failed to load tracks:', error);
        setLoading(false);
      }
    };

    loadTracks();
  }, [trackIds.length, currentTrackIndex, setTrackIds, setCurrentTrack, setLoading, setError]);

  // 每次浏览器刷新：已登录时重新请求一次推荐，更新待播列表
  useEffect(() => {
    if (!isLoggedIn) return;
    const username = getCurrentUser();
    if (!username) return;
    const sys = usePlayerStore.getState().currentSystem;
    const prefs = usePlayerStore.getState().getUserPreferences();
    getRecommendations({
      username,
      systemType: sys,
      explicitPreferences: prefs,
      count: 10,
      trigger: 'preferences_updated',
    })
      .then((result) => {
        if (result.recommendedTracks?.length > 0) {
          usePlayerStore.getState().setRecommendedTrackIds(result.recommendedTracks, result.recommendedScores, result.firstTracks);
          setPlaylist(username, result.recommendedTracks, sys).catch(() => {});
        }
      })
      .catch(() => {});
  }, [isLoggedIn]);

  // 清除记录：无论当前在系统 A 还是 B，立刻清除数据并回到冷启动阶段
  const handleClearData = () => {
    if (!window.confirm('确定要清除所有记录吗？将清除偏好、对话历史、听歌行为、收藏与播放历史，并回到冷启动阶段，小助手也不会再记得您之前的任何行为。')) return;
    const currentUser = localStorage.getItem('currentUser');

    // 1. 立刻清除本地与 store，界面立即回到冷启动
    clearAllUserData();
    clearCurrentUserData();
    if (currentUser) {
      localStorage.removeItem(`hasCompletedFirstLogin-${currentUser}`);
    }
    setHasCompletedFirstLogin(false);
    setIsAssistantVisible(true);
    setAssistantClearKey((k) => k + 1);
    sessionStartTimeRef.current = 0;
    if (currentUser) localStorage.removeItem(SESSION_START_KEY(currentUser));

    // 2. 后台清除服务端数据（A/B 的待播列表与服务端记录都清）
    if (currentUser) {
      (async () => {
        try {
          await clearAllUserDataOnServer(currentUser);
        } catch (e) {
          console.error('清除服务端用户数据失败:', e);
        }
        for (const system of ['A', 'B'] as const) {
          try {
            await setPlaylist(currentUser, [], system);
          } catch (e) {
            console.error(`清空待播列表(${system})失败:`, e);
          }
        }
      })();
    }
  };

  // 退出登录
  const handleLogout = () => {
    const currentUser = localStorage.getItem('currentUser');
    if (currentUser) {
      localStorage.removeItem(SESSION_START_KEY(currentUser));
    }
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('currentUser');
    setIsLoggedIn(false);
  };

  // 获取当前用户名
  const currentUser = localStorage.getItem('currentUser') || '';

  // 如果未登录，显示登录界面
  if (!isLoggedIn) {
    return <Login onLoginSuccess={() => setIsLoggedIn(true)} />;
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header with Buttons */}
      <div className="bg-white border-b border-gray-200 px-6 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm font-semibold text-gray-600">
          {currentSystem === 'B' && (
            <div
              role="button"
              tabIndex={0}
              onDoubleClick={() => setShowSerenSettings(true)}
              className="cursor-pointer select-none"
              title="双击打开 Seren 设置"
            >
              <img 
                src="/slogo.png" 
                alt="Seren Logo" 
                className="w-5 h-5 object-contain scale-110"
              />
            </div>
          )}
          <span>
            {currentSystem === 'A'
              ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onDoubleClick={() => setShowTagSelectInA((v) => !v)}
                    className="cursor-pointer select-none"
                    title="双击显示/隐藏标签选择"
                  >
                    欢迎使用音乐推荐系统，<span className="font-semibold text-gray-800">{currentUser}</span>
                  </span>
                )
              : <>欢迎使用Seren音乐推荐小助手，<span className="font-semibold text-gray-800">{currentUser}</span></>
            }
          </span>
          <button
            type="button"
            onClick={toggleSystem}
            title="点击切换 A/B 系统（A=无小助手，B=Seren 小助手）"
            className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all border border-gray-300"
          >
            切换至系统 {currentSystem === 'A' ? 'B' : 'A'}
          </button>
        </div>
        <div className="flex items-center gap-3">
          {/* 计时：净听歌时间（从首次播放起算，加载推荐期间不计时），满 20 分钟停止并闪烁 */}
          {(() => {
            const started = sessionStartTimeRef.current > 0;
            const rawElapsedMs = started ? now - sessionStartTimeRef.current : 0;
            const pausedMs = loading ? (now - loadingStartRef.current) + totalPausedMsRef.current : totalPausedMsRef.current;
            const elapsedSeconds = started ? Math.max(0, (rawElapsedMs - pausedMs) / 1000) : 0;
            const displaySeconds = Math.min(Math.floor(elapsedSeconds), 1200);
            const sessionReached20Min = displaySeconds >= 1200;
            const m = Math.floor(displaySeconds / 60);
            const s = displaySeconds % 60;
            const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            return (
              <span
                className={`text-sm font-mono font-semibold tabular-nums ${
                  sessionReached20Min ? 'session-timer-flash text-orange-600' : 'text-gray-600'
                }`}
                title={sessionReached20Min ? '已满 20 分钟' : (started ? '净听歌时间（加载推荐时不计时）' : '未开始播放，计时未开始')}
              >
                {timeStr}
                {sessionReached20Min && <span className="ml-1 text-xs">(已满 20 分钟)</span>}
              </span>
            );
          })()}
          <button
            onClick={handleClearData}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            清除记录
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            退出登录
          </button>
        </div>
      </div>

      {showSerenSettings && <SerenSettingsModal onClose={() => setShowSerenSettings(false)} />}

      {/* Main Content：左侧区域 + 可拖动分隔条 + 右侧收藏/日志/历史 */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* 左侧：播放器 + 可选小助手 */}
        <div className="flex-1 flex min-w-0">
          <div className="flex-1 flex flex-col min-w-0 relative">
            <MusicPlayer 
              isAssistantVisible={currentSystem === 'B' ? isAssistantVisible : false}
              onToggleAssistant={() => setIsAssistantVisible(!isAssistantVisible)}
            />

            {/* 冷启动：仅系统 A 显示标签选择浮层；系统 B 下永不出现 */}
            {currentSystem === 'A' && checkIsFirstLogin() && !hasCompletedFirstLogin && (
              <div className="absolute inset-0 z-40 overflow-y-auto bg-white/95 flex flex-col items-center pt-4 pb-8">
                <ColdStartTagSelect
                  onComplete={() => {
                    setHasCompletedFirstLogin(true);
                    const u = localStorage.getItem('currentUser');
                    if (u) localStorage.setItem(`hasCompletedFirstLogin-${u}`, 'true');
                  }}
                  onClose={() => {
                    setHasCompletedFirstLogin(true);
                    const u = localStorage.getItem('currentUser');
                    if (u) localStorage.setItem(`hasCompletedFirstLogin-${u}`, 'true');
                  }}
                />
              </div>
            )}

            {/* 系统 A：双击「欢迎使用音乐推荐系统」再次调出标签选择，修改偏好；再次双击或完成可隐藏 */}
            {currentSystem === 'A' && showTagSelectInA && (
              <div className="absolute inset-0 z-40 overflow-y-auto bg-white/95 flex flex-col items-center pt-4 pb-8">
                <ColdStartTagSelect
                  initialSelected={(() => {
                    const p = getUserPreferences();
                    const sel: { category: 'genres' | 'instruments' | 'moods' | 'themes'; tag: string }[] = [];
                    (p.genres || []).forEach((tag) => sel.push({ category: 'genres', tag }));
                    (p.instruments || []).forEach((tag) => sel.push({ category: 'instruments', tag }));
                    (p.moods || []).forEach((tag) => sel.push({ category: 'moods', tag }));
                    (p.themes || []).forEach((tag) => sel.push({ category: 'themes', tag }));
                    return sel;
                  })()}
                  onComplete={() => setShowTagSelectInA(false)}
                  onClose={() => setShowTagSelectInA(false)}
                />
              </div>
            )}

            {/* 系统 B：冷启动时小助手覆盖播放器 */}
            {currentSystem === 'B' && isAssistantVisible && checkIsFirstLogin() && !currentTrack && !hasCompletedFirstLogin && (
              <>
                <div
                  className="absolute inset-0 bg-white/30 backdrop-blur-sm z-20 pointer-events-none"
                  style={{ right: '25%' }}
                />
                <div
                  className="absolute inset-0 h-full overflow-hidden z-30"
                  style={{ right: '25%' }}
                >
                  <AIAssistant
                    key={`coldstart-${assistantClearKey}`}
                    onToggleAssistant={() => setIsAssistantVisible(false)}
                    onFirstRecommendation={handleFirstRecommendation}
                  />
                </div>
              </>
            )}
          </div>

          {/* 系统 B：AI 小助手区域 */}
          {currentSystem === 'B' && isAssistantVisible && (hasCompletedFirstLogin || currentTrack || !checkIsFirstLogin()) && (
            <div className="w-1/3 flex-shrink-0 h-full overflow-hidden">
              <AIAssistant
                key={`normal-${assistantClearKey}`}
                onToggleAssistant={() => setIsAssistantVisible(false)}
                onFirstRecommendation={handleFirstRecommendation}
              />
            </div>
          )}
        </div>

        {/* 可拖动分隔条：改变左右两侧宽度 */}
        <div
          role="separator"
          aria-label="拖动调整左右宽度"
          className="flex-shrink-0 w-1.5 cursor-col-resize select-none bg-gray-300 hover:bg-orange-300 active:bg-orange-400 transition-colors"
          onMouseDown={onDividerMouseDown}
          style={{ minWidth: 6 }}
        />

        {/* 右侧：收藏列表 / 日志 / 历史 */}
        <div
          className="flex-shrink-0 flex flex-col overflow-hidden bg-white border-l border-gray-200"
          style={{ width: `${rightPanelWidthPercent}%`, minWidth: 200, borderLeftWidth: '0.5px' }}
        >
          <FavoritesList />
        </div>
      </div>
    </div>
  );
}

export default App;
