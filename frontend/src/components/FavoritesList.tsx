import { useState, useEffect, useRef } from 'react';
import { usePlayerStore } from '../store';
import { FavoriteTrack, HistoryRecord, type TrackTags } from '../types';
import { jamendoApi } from '../api';
import { fetchLogsFromServer } from '../api/logs';

export default function FavoritesList() {
  const { favorites, history, setCurrentTrack, setIsPlaying, removeFavorite, recommendedTrackIds, recommendedTrackReasons, recommendedTrackScores, recommendedTrackRequestedAt, recommendedTrackDetails, currentTrack, getRating } = usePlayerStore();
  const [activeTab, setActiveTab] = useState<'favorites' | 'history' | 'playlist' | 'log'>('favorites');
  /** 默认不展示待播列表；双击历史记录 tab 展开/收起 */
  const [showPlaylistTab, setShowPlaylistTab] = useState(false);
  /** 默认不展开日志 tab；双击收藏列表展开/收起 */
  const [showLogTab, setShowLogTab] = useState(false);
  const logContentRef = useRef<HTMLDivElement>(null);
  const [hoveredTrackId, setHoveredTrackId] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  // 待播列表曲目详情（id -> { name, artist_name, image?, tags? }），用于展示
  const [playlistDetails, setPlaylistDetails] = useState<Record<string, { name: string; artist_name: string; image?: string; tags?: TrackTags }>>({});
  const [playlistLoading, setPlaylistLoading] = useState(false);
  /** 日志 tab：从 GET /api/logs 拉取的全文，与该页面返回内容一致 */
  const [apiLogContent, setApiLogContent] = useState('');
  const [apiLogLoading, setApiLogLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== 'playlist' || recommendedTrackIds.length === 0) {
      setPlaylistDetails({});
      return;
    }
    setPlaylistLoading(true);
    const limit = Math.min(recommendedTrackIds.length, 10);
    const ids = recommendedTrackIds.slice(0, limit);
    Promise.all(ids.map((id) => jamendoApi.getTrackById(id).catch(() => null)))
      .then((tracks) => {
        const next: Record<string, { name: string; artist_name: string; image?: string; tags?: TrackTags }> = {};
        tracks.forEach((t, i) => {
          if (t && ids[i]) next[ids[i]] = { name: t.name, artist_name: t.artist_name, image: t.image, tags: t.tags };
        });
        setPlaylistDetails(next);
      })
      .finally(() => setPlaylistLoading(false));
  }, [activeTab, recommendedTrackIds.join(',')]);

  useEffect(() => {
    if (activeTab !== 'log') return;
    setApiLogLoading(true);
    fetchLogsFromServer()
      .then(setApiLogContent)
      .finally(() => setApiLogLoading(false));
  }, [activeTab]);

  const handlePlayTrack = (track: FavoriteTrack | HistoryRecord) => {
    // 将FavoriteTrack或HistoryRecord转换为JamendoTrack格式
    const trackId = 'trackId' in track ? track.trackId : track.id;
    const jamendoTrack = {
      id: trackId,
      name: track.name,
      artist_name: track.artist_name,
      album_name: track.album_name,
      image: track.image,
      audio: track.audio,
      duration: 0, // 使用默认值
      releasedate: '', // 使用默认值
    };
    setCurrentTrack(jamendoTrack);
    setIsPlaying(true);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  /** 将曲目标签格式化为一行：风格 / 乐器 / 情绪 / 主题 */
  const formatTags = (tags: TrackTags | undefined): string => {
    if (!tags) return '—';
    const parts: string[] = [];
    if (tags.genres?.length) parts.push(`风格: ${tags.genres.slice(0, 3).join('、')}`);
    if (tags.instruments?.length) parts.push(`乐器: ${tags.instruments.slice(0, 3).join('、')}`);
    if (tags.moods?.length) parts.push(`情绪: ${tags.moods.slice(0, 3).join('、')}`);
    if (tags.themes?.length) parts.push(`主题: ${tags.themes.slice(0, 3).join('、')}`);
    return parts.length ? parts.join('；') : '—';
  };

  /** 被请求时间展示：时间戳 -> 可读时间 */
  const formatRequestedAt = (ts: number | undefined): string => {
    if (ts == null || !Number.isFinite(ts)) return '—';
    return new Date(ts).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
  };

  const handleRemoveFavorite = (trackId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeFavorite(trackId);
  };

  return (
    <div className="w-full h-full flex flex-col bg-white min-h-0">
      {/* Header with Tabs */}
          <div className="p-3 border-b border-gray-200 bg-white">
            <div className="flex gap-2 flex-wrap items-center">
              <button
                onClick={() => setActiveTab('favorites')}
                onDoubleClick={() => {
                  setShowLogTab((prev) => {
                    const next = !prev;
                    if (!next && activeTab === 'log') setActiveTab('favorites');
                    return next;
                  });
                }}
                className={`px-3 py-1 text-sm font-medium transition-all ${
                  activeTab === 'favorites'
                    ? 'text-black'
                    : 'text-gray-400'
                }`}
                title="双击展开/收起日志"
              >
                收藏列表
              </button>
              {showLogTab && (
                <button
                  onClick={() => setActiveTab('log')}
                  className={`px-3 py-1 text-sm font-medium transition-all ${
                    activeTab === 'log'
                      ? 'text-black'
                      : 'text-gray-400'
                  }`}
                >
                  日志
                </button>
              )}
              <button
                onClick={() => setActiveTab('history')}
                onDoubleClick={() => {
                  setShowPlaylistTab((prev) => {
                    const next = !prev;
                    if (!next && activeTab === 'playlist') setActiveTab('history');
                    return next;
                  });
                }}
                className={`px-3 py-1 text-sm font-medium transition-all ${
                  activeTab === 'history'
                    ? 'text-black'
                    : 'text-gray-400'
                }`}
                title="双击展开/收起待播列表"
              >
                历史记录
              </button>
              {showPlaylistTab && (
                <button
                  onClick={() => setActiveTab('playlist')}
                  className={`px-3 py-1 text-sm font-medium transition-all ${
                    activeTab === 'playlist'
                      ? 'text-black'
                      : 'text-gray-400'
                  }`}
                >
                  待播列表
                </button>
              )}
            </div>
          </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'playlist' ? (
          /* 待播列表：顺序与马上要播一致，只显示下一首及之后；每首旁显示请求原因 */
          (() => {
            const currentIndex = currentTrack ? recommendedTrackIds.indexOf(currentTrack.id) : -1;
            const visibleTrackIds = currentIndex >= 0 ? recommendedTrackIds.slice(currentIndex + 1) : recommendedTrackIds;
            const visibleReasons = visibleTrackIds.map((id) => {
              const idx = recommendedTrackIds.indexOf(id);
              return idx >= 0 && idx < recommendedTrackReasons.length ? recommendedTrackReasons[idx] : '';
            });
            if (visibleTrackIds.length === 0) {
              return (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <p>暂无待播列表</p>
                </div>
              );
            }
            if (playlistLoading && Object.keys(playlistDetails).length === 0) {
              return (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <p>加载中...</p>
                </div>
              );
            }
            return (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 mb-2">以下顺序即播放顺序</p>
              {visibleTrackIds.map((trackId, index) => {
                const detail = playlistDetails[trackId];
                const isNext = index === 0;
                const score = recommendedTrackScores[trackId];
                const reason = visibleReasons[index];
                const tags = recommendedTrackDetails[trackId]?.tags ?? detail?.tags;
                const requestedAt = recommendedTrackRequestedAt[trackId];
                return (
                  <div
                    key={`${trackId}-${index}`}
                    onDoubleClick={async () => {
                      try {
                        const track = await jamendoApi.getTrackById(trackId);
                        if (track) {
                          setCurrentTrack(track);
                          setIsPlaying(true);
                        }
                      } catch (e) {
                        console.warn('加载曲目失败:', e);
                      }
                    }}
                    onMouseEnter={() => setHoveredTrackId(trackId)}
                    onMouseLeave={() => {
                      setHoveredTrackId(null);
                      setMousePosition(null);
                    }}
                    onMouseMove={(e) => {
                      if (hoveredTrackId === trackId) setMousePosition({ x: e.clientX, y: e.clientY });
                    }}
                    className={`flex items-center gap-3 p-3 rounded-lg hover:bg-orange-50 cursor-pointer transition-all border relative ${
                      isNext ? 'border-orange-300 bg-orange-50' : 'border-transparent hover:border-orange-200'
                    }`}
                  >
                    <div className="flex-shrink-0 w-8 text-sm text-gray-500 font-medium">
                      {index + 1}
                    </div>
                    <div className="flex-shrink-0">
                      {detail?.image ? (
                        <img src={detail.image} alt="" className="w-16 h-16 rounded-lg object-cover" />
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-gray-200 flex items-center justify-center">
                          <span className="text-gray-400 text-xs">{detail ? '无封面' : '…'}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-800 truncate">{detail?.name ?? `ID: ${trackId}`}</h3>
                      <p className="text-sm text-gray-600 truncate">{detail?.artist_name ?? '加载中...'}</p>
                      {isNext && <span className="text-xs text-orange-500 mt-0.5">下一首</span>}
                      {reason && (
                        <p className="text-xs text-gray-500 mt-0.5" title={reason}>请求原因: {reason}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-0.5" title={formatTags(tags)}>标签: {formatTags(tags)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">被请求时间: {formatRequestedAt(requestedAt)}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <svg
                            key={star}
                            className={`w-3 h-3 ${star <= getRating(trackId) ? 'text-orange-500' : 'text-gray-300'}`}
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                        ))}
                      </div>
                      {typeof score === 'number' && (
                        <p className="text-xs text-gray-500 mt-0.5">召回分: {score.toFixed(3)}</p>
                      )}
                    </div>
                    {hoveredTrackId === trackId && mousePosition && (
                      <div
                        className="fixed px-3 py-2 bg-gray-800 text-white text-xs rounded-lg shadow-lg whitespace-nowrap z-50 animate-pulse pointer-events-none"
                        style={{ left: `${mousePosition.x + 10}px`, top: `${mousePosition.y + 10}px` }}
                      >
                        双击播放
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            );
          })()
        ) : activeTab === 'favorites' ? (
          /* Favorites List */
          favorites.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              <p>暂无收藏</p>
            </div>
          ) : (
            <div className="space-y-3">
              {favorites.map((track) => (
                <div
                  key={track.id}
                  onDoubleClick={() => handlePlayTrack(track)}
                  onMouseEnter={() => setHoveredTrackId(track.id)}
                  onMouseLeave={() => {
                    setHoveredTrackId(null);
                    setMousePosition(null);
                  }}
                  onMouseMove={(e) => {
                    if (hoveredTrackId === track.id) {
                      setMousePosition({ x: e.clientX, y: e.clientY });
                    }
                  }}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-orange-50 cursor-pointer transition-all border border-transparent hover:border-orange-200 relative"
                >
                  {/* Album Art */}
                  <div className="flex-shrink-0">
                    {track.image ? (
                      <img
                        src={track.image}
                        alt={track.album_name}
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-gray-200 flex items-center justify-center">
                        <span className="text-gray-400 text-xs">无封面</span>
                      </div>
                    )}
                  </div>

                  {/* Track Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-800 truncate">{track.name}</h3>
                    <p className="text-sm text-gray-600 truncate">{track.artist_name}</p>
                    <div className="flex items-center gap-1 mt-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <svg
                          key={star}
                          className={`w-3 h-3 ${
                            star <= track.rating ? 'text-orange-500' : 'text-gray-300'
                          }`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      ))}
                    </div>
                  </div>

                  {/* Favorite Icon */}
                  <button
                    onClick={(e) => handleRemoveFavorite(track.id, e)}
                    className="flex-shrink-0 text-orange-500 hover:text-orange-600 transition-all"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                    </svg>
                  </button>
                  
                  {/* Double Click Tooltip */}
                  {hoveredTrackId === track.id && mousePosition && (
                    <div
                      className="fixed px-3 py-2 bg-gray-800 text-white text-xs rounded-lg shadow-lg whitespace-nowrap z-50 animate-pulse pointer-events-none"
                      style={{
                        left: `${mousePosition.x + 10}px`,
                        top: `${mousePosition.y + 10}px`,
                      }}
                    >
                      双击播放
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : activeTab === 'log' ? (
          /* 日志：与 http://localhost:3000/api/logs 页面全部内容一致 */
          <div ref={logContentRef} className="h-full flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">与 GET /api/logs 返回内容一致，可刷新</span>
              <button
                type="button"
                onClick={() => {
                  setApiLogLoading(true);
                  fetchLogsFromServer().then(setApiLogContent).finally(() => setApiLogLoading(false));
                }}
                className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
              >
                {apiLogLoading ? '加载中...' : '刷新'}
              </button>
            </div>
            <div className="flex-1 overflow-auto rounded border border-gray-200 bg-gray-50 p-3">
              {apiLogLoading && !apiLogContent ? (
                <p className="text-gray-400 text-sm">加载中...</p>
              ) : (
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono break-all m-0">
                  {apiLogContent || '(暂无日志)'}
                </pre>
              )}
            </div>
          </div>
        ) : (
          /* History List */
          history.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              <p>暂无历史记录</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((record, index) => {
                const recordKey = `${record.trackId}-${record.playedAt}-${index}`;
                return (
                <div
                  key={recordKey}
                  onDoubleClick={() => handlePlayTrack(record)}
                  onMouseEnter={() => setHoveredTrackId(recordKey)}
                  onMouseLeave={() => {
                    setHoveredTrackId(null);
                    setMousePosition(null);
                  }}
                  onMouseMove={(e) => {
                    if (hoveredTrackId === recordKey) {
                      setMousePosition({ x: e.clientX, y: e.clientY });
                    }
                  }}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-orange-50 cursor-pointer transition-all border border-transparent hover:border-orange-200 relative"
                >
                  {/* Album Art */}
                  <div className="flex-shrink-0">
                    {record.image ? (
                      <img
                        src={record.image}
                        alt={record.album_name}
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-gray-200 flex items-center justify-center">
                        <span className="text-gray-400 text-xs">无封面</span>
                      </div>
                    )}
                  </div>

                  {/* Track Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-800 truncate">{record.name}</h3>
                    <p className="text-sm text-gray-600 truncate">{record.artist_name}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                      <span>{formatDate(record.playedAt)}</span>
                      <span>•</span>
                      <span>听了 {formatDuration(record.duration)}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1" title="评分">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <svg
                          key={star}
                          className={`w-3 h-3 ${star <= getRating(record.trackId) ? 'text-orange-500' : 'text-gray-300'}`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      ))}
                    </div>
                  </div>
                  
                  {/* Double Click Tooltip */}
                  {hoveredTrackId === recordKey && mousePosition && (
                    <div
                      className="fixed px-3 py-2 bg-gray-800 text-white text-xs rounded-lg shadow-lg whitespace-nowrap z-50 animate-pulse pointer-events-none"
                      style={{
                        left: `${mousePosition.x + 10}px`,
                        top: `${mousePosition.y + 10}px`,
                      }}
                    >
                      双击播放
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
