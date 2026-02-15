import { useState, useMemo } from 'react';
import { usePlayerStore } from '../store';
import { jamendoApi } from '../api';
import { saveUserPreferences } from '../api/preferences';
import { setPlaylist } from '../api/playlist';
import { getRecommendations } from '../api/recommend';
import { getCurrentUser } from '../utils/storage';
import { tagToChinese, tagWithChinese } from '../utils/tagToChinese';
import { getReportDistinctTags } from '../data/reportDistinctTags';

type TagCategory = 'genres' | 'instruments' | 'moods' | 'themes';

interface SelectedTag {
  category: TagCategory;
  tag: string;
}

interface ColdStartTagSelectProps {
  onComplete: () => void;
  /** 可选：点击右上角关闭时回调（不完成推荐直接关闭弹窗） */
  onClose?: () => void;
  /** 可选：预填已选标签（如再次打开修改偏好时从 getUserPreferences 传入） */
  initialSelected?: SelectedTag[];
}

const THEME_GRADIENT = 'linear-gradient(135deg, #D8CECF 0%, #91738B 100%)';

/** 每类标签的主题色（区分类别） */
const CATEGORY_COLORS: Record<TagCategory, string> = {
  genres: '#91738B',      // 风格 紫
  instruments: '#8B7765', // 乐器 棕
  moods: '#788296',       // 情绪 蓝灰
  themes: '#6B7B8C',      // 主题 深蓝灰
};

const CATEGORY_LABELS: Record<TagCategory, string> = {
  genres: '风格',
  instruments: '乐器',
  moods: '情绪',
  themes: '主题',
};

export default function ColdStartTagSelect({ onComplete, onClose, initialSelected }: ColdStartTagSelectProps) {
  const { getUserPreferences, setError, currentSystem } = usePlayerStore();
  /** 标签选项严格与 详细Tags分析报告.md 中 distinct tags 一致，不得编造 */
  const [tagOptions] = useState(() => getReportDistinctTags());
  const [selected, setSelected] = useState<SelectedTag[]>(initialSelected ?? []);
  const [loading, setLoading] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [search, setSearch] = useState<Record<TagCategory, string>>({
    genres: '',
    instruments: '',
    moods: '',
    themes: '',
  });

  const addTag = (category: TagCategory, tag: string) => {
    if (selected.some((s) => s.category === category && s.tag === tag)) return;
    setSelected((prev) => [...prev, { category, tag }]);
  };

  const removeTag = (index: number) => {
    setSelected((prev) => prev.filter((_, i) => i !== index));
  };

  const setSearchFor = (cat: TagCategory, value: string) => {
    setSearch((prev) => ({ ...prev, [cat]: value }));
  };

  const filteredOptions = useMemo(() => {
    const out: Record<TagCategory, string[]> = { genres: [], instruments: [], moods: [], themes: [] };
    (Object.keys(CATEGORY_LABELS) as TagCategory[]).forEach((cat) => {
      const list = tagOptions[cat] || [];
      const q = (search[cat] || '').trim().toLowerCase();
      out[cat] = q ? list.filter((t) => t.toLowerCase().includes(q) || tagToChinese(t).toLowerCase().includes(q)) : list;
    });
    return out;
  }, [tagOptions, search]);

  /** 三列：风格 | 乐器 | 情绪/主题（moods + themes 合并） */
  const columnDefs: { key: 'genres' | 'instruments' | 'moods_themes'; label: string; color: string; tags: string[] }[] = useMemo(() => {
    const moodsThemes = [...new Set([...(filteredOptions.moods || []), ...(filteredOptions.themes || [])])].sort();
    return [
      { key: 'genres', label: '风格', color: CATEGORY_COLORS.genres, tags: filteredOptions.genres || [] },
      { key: 'instruments', label: '乐器', color: CATEGORY_COLORS.instruments, tags: filteredOptions.instruments || [] },
      { key: 'moods_themes', label: '情绪/主题', color: CATEGORY_COLORS.moods, tags: moodsThemes },
    ];
  }, [filteredOptions]);

  const addTagByColumn = (key: 'genres' | 'instruments' | 'moods_themes', tag: string) => {
    const category: TagCategory = key === 'moods_themes' ? (tagOptions.moods?.includes(tag) ? 'moods' : 'themes') : key;
    addTag(category, tag);
  };

  const handleComplete = async () => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ColdStartTagSelect.tsx:handleComplete:entry',message:'handleComplete invoked',data:{currentSystem,selectedCount:selected.length},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    const username = getCurrentUser();
    if (!username) {
      setError('请先登录');
      return;
    }
    const prefs = {
      genres: selected.filter((s) => s.category === 'genres').map((s) => s.tag),
      instruments: selected.filter((s) => s.category === 'instruments').map((s) => s.tag),
      moods: selected.filter((s) => s.category === 'moods').map((s) => s.tag),
      themes: selected.filter((s) => s.category === 'themes').map((s) => s.tag),
    };
    if (prefs.genres.length === 0 && prefs.instruments.length === 0 && prefs.moods.length === 0 && prefs.themes.length === 0) {
      setError('请至少选择一个偏好标签');
      return;
    }
    setLoading(true);
    setError(null);
    setCompleteError(null);

    const OVERALL_TIMEOUT_MS = 50000;
    const TRACK_FETCH_TIMEOUT_MS = 8000;
    const TRACK_FETCH_MAX_TRY = 3;

    const timeoutPromise = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('请求超时')), ms));

    const run = async () => {
      console.log('[冷启动] 1/3 保存偏好...');
      await saveUserPreferences(username, prefs, { operation: 'first_login', systemType: currentSystem });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ColdStartTagSelect.tsx:run:afterSave',message:'saveUserPreferences ok',data:{currentSystem},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      console.log('[冷启动] 2/3 偏好已保存，请求推荐...');
      usePlayerStore.getState().replaceUserPreferences(prefs);
      const result = await getRecommendations({
        username,
        systemType: currentSystem,
        explicitPreferences: { ...getUserPreferences(), ...prefs },
        count: 10,
        trigger: 'user_expressed_preference',
      });
      if (result.recommendedTracks?.length === 0) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ColdStartTagSelect.tsx:run:emptyResult',message:'getRecommendations returned empty',data:{currentSystem},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        console.warn('[冷启动] 推荐接口返回空列表');
        const errMsg = '暂无推荐，请检查后端是否正常或稍后再试';
        setError(errMsg);
        setCompleteError(errMsg);
        return;
      }
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ColdStartTagSelect.tsx:run:afterRecommend',message:'getRecommendations ok',data:{currentSystem,resultLength:result.recommendedTracks.length},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      console.log('[冷启动] 3/3 推荐已返回，共', result.recommendedTracks.length, '首');
      usePlayerStore.getState().setRecommendedTrackIds(result.recommendedTracks, result.recommendedScores, result.firstTracks);
      usePlayerStore.getState().setRecommendedTrackIndex(0);
      setPlaylist(username, result.recommendedTracks, currentSystem).catch(() => {});
      usePlayerStore.getState().syncLastRecommendationVersion?.();

      type JamendoTrackLike = { id: string; name: string; artist_name: string; album_name: string; image: string; audio: string; duration: number; releasedate: string; tags?: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] } };
      let firstTrack: JamendoTrackLike | null = result.firstTrack
        ? { id: result.firstTrack.id, name: result.firstTrack.name, artist_name: result.firstTrack.artist_name, album_name: result.firstTrack.album_name || '', image: result.firstTrack.image || '', audio: result.firstTrack.audio || '', duration: result.firstTrack.duration || 0, releasedate: result.firstTrack.releasedate || '', tags: result.firstTrack.tags }
        : null;
      if (!firstTrack && result.firstTracks?.[0]) {
        const t = result.firstTracks[0];
        firstTrack = { id: t.id, name: t.name, artist_name: t.artist_name, album_name: t.album_name || '', image: t.image || '', audio: t.audio || '', duration: t.duration || 0, releasedate: t.releasedate || '', tags: t.tags };
      }
      if (!firstTrack) {
        const ids = result.recommendedTracks;
        const maxTry = Math.min(ids.length, TRACK_FETCH_MAX_TRY);
        for (let i = 0; i < maxTry; i++) {
          try {
            const track = await Promise.race([
              jamendoApi.getTrackById(ids[i]),
              timeoutPromise(TRACK_FETCH_TIMEOUT_MS),
            ]);
            if (track) {
              firstTrack = track as JamendoTrackLike;
              usePlayerStore.getState().setRecommendedTrackIndex(i + 1);
              break;
            }
          } catch {
            // skip
          }
        }
      }
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ColdStartTagSelect.tsx:run:beforeOnComplete',message:'about to call onComplete',data:{hasFirstTrack:!!firstTrack,currentSystem},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      if (firstTrack) {
        usePlayerStore.getState().setCurrentTrack(firstTrack);
        usePlayerStore.getState().setIsPlaying(true);
      } else {
        const errMsg = '首曲加载失败，请点击「推荐下一首」重试';
        setError(errMsg);
        setCompleteError(errMsg);
      }
      onComplete();
    };

    try {
      await Promise.race([run(), timeoutPromise(OVERALL_TIMEOUT_MS)]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存偏好失败';
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ColdStartTagSelect.tsx:handleComplete:catch',message:'handleComplete error',data:{message:msg,currentSystem},timestamp:Date.now(),hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      console.error('[冷启动] 失败:', msg, e);
      // 失败时仍写入本地 store，便于重试时保持选择
      usePlayerStore.getState().replaceUserPreferences(prefs);
      const errMsg = msg === '请求超时' ? '请求超时，请检查网络或后端是否启动' : msg;
      setError(errMsg);
      setCompleteError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-white/95 rounded-xl border border-gray-200 shadow-sm max-w-4xl mx-auto mt-4 w-full relative">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-800 mb-1">选择你喜欢的标签（可多选）</h3>
          <p className="text-xs text-gray-500">系统将根据你的选择推荐歌曲</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded shrink-0"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* 三列：风格 | 乐器 | 情绪/主题 */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {columnDefs.map((col) => (
          <div key={col.key} className="flex flex-col rounded-lg bg-gray-50/80 border border-gray-100 overflow-hidden">
            <div className="flex items-center gap-2 p-2 border-b border-gray-100 shrink-0">
              <span className="text-sm font-medium shrink-0" style={{ color: col.color }}>
                {col.label}
              </span>
              <input
                type="text"
                placeholder="搜索…"
                value={col.key === 'moods_themes' ? (search.moods || search.themes || '') : search[col.key]}
                onChange={(e) => {
                  if (col.key === 'moods_themes') {
                    setSearch((prev) => ({ ...prev, moods: e.target.value, themes: e.target.value }));
                  } else {
                    setSearchFor(col.key, e.target.value);
                  }
                }}
                className="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-gray-300 focus:border-gray-400 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1.5 p-2 max-h-[26rem] overflow-y-auto">
              {col.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => addTagByColumn(col.key, tag)}
                  className="px-2 py-0.5 text-xs rounded-full border transition-colors whitespace-nowrap"
                  style={{
                    borderColor: col.color,
                    color: col.color,
                    backgroundColor: 'rgba(255,255,255,0.9)',
                  }}
                >
                  + {tagWithChinese(tag)}
                </button>
              ))}
              {col.tags.length === 0 && (
                <span className="text-xs text-gray-400">
                  {col.key === 'moods_themes'
                    ? (tagOptions.moods?.length || 0) + (tagOptions.themes?.length || 0) === 0
                      ? '加载中…'
                      : '无匹配'
                    : (tagOptions[col.key]?.length || 0) === 0
                      ? '加载中…'
                      : '无匹配'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 我的偏好区域常驻 */}
      <div className="mt-3 pt-3 border-t border-gray-200">
        <span className="text-sm font-medium text-gray-600">我的偏好</span>
        <div className="flex flex-wrap gap-1.5 mt-1 min-h-[2rem]">
          {selected.length > 0 ? (
            selected.map((s, i) => (
              <button
                key={`${s.category}-${s.tag}-${i}`}
                type="button"
                onClick={() => removeTag(i)}
                className="inline-flex items-center gap-0.5 px-2 py-0.5 text-xs rounded border transition-colors"
                style={{
                  borderColor: CATEGORY_COLORS[s.category],
                  color: CATEGORY_COLORS[s.category],
                  backgroundColor: `${CATEGORY_COLORS[s.category]}14`,
                }}
              >
                {tagWithChinese(s.tag)} ×
              </button>
            ))
          ) : (
            <span className="text-xs text-gray-400">点击上方标签添加偏好</span>
          )}
        </div>
      </div>

      {completeError && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm text-red-600" role="alert">{completeError}</p>
          <button
            type="button"
            onClick={() => { setCompleteError(null); setError(null); handleComplete(); }}
            disabled={loading}
            className="self-start px-3 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300"
          >
            重试
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={handleComplete}
        disabled={loading || selected.length === 0}
        className="mt-4 w-full py-[0.45rem] px-4 rounded-lg text-sm text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: selected.length > 0 ? THEME_GRADIENT : '#ccc',
        }}
      >
        {loading ? '保存中…' : '完成并开始推荐'}
      </button>
    </div>
  );
}
