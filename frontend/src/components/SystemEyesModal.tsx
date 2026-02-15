import { useEffect, useState, useRef } from 'react';
import { getCurrentUser } from '../utils/storage';
import { getPreferenceHeatmap, type PreferenceHeatmapData, type TagWeight } from '../api/preferenceHeatmap';
import { aiAssistantApi } from '../api/aiAssistant';
import { tagToChinese } from '../utils/tagToChinese';

const THEME_GRADIENT = 'linear-gradient(135deg, #D8CECF 0%, #91738B 100%)';
const CATEGORY_COLORS: Record<string, string> = {
  genres: '#91738B',
  instruments: '#8B7765',
  moods: '#788296',
  themes: '#6B7B8C',
};

interface SystemEyesModalProps {
  onClose: () => void;
}

/** 流式显示：逐字出现 */
function StreamText({ text, charPerMs = 24 }: { text: string; charPerMs?: number }) {
  const [visibleLength, setVisibleLength] = useState(0);
  useEffect(() => {
    if (!text) {
      setVisibleLength(0);
      return;
    }
    setVisibleLength(0);
    const len = text.length;
    const t = setInterval(() => {
      setVisibleLength((prev) => (prev >= len ? len : prev + 1));
    }, charPerMs);
    return () => clearInterval(t);
  }, [text, charPerMs]);
  return <>{text.slice(0, visibleLength)}</>;
}

export default function SystemEyesModal({ onClose }: SystemEyesModalProps) {
  const [explanation, setExplanation] = useState<string>('');
  const [heatmapData, setHeatmapData] = useState<PreferenceHeatmapData | null>(null);
  const [showTreemap, setShowTreemap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugError, setDebugError] = useState<{ message: string; status?: number; name?: string } | null>(null);
  const explanationSetAt = useRef<number>(0);

  useEffect(() => {
    const run = async () => {
      const currentUser = getCurrentUser();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SystemEyesModal.tsx:run',message:'SystemEyes run start',data:{hasUser:!!currentUser},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      if (!currentUser) {
        setExplanation('请先登录以查看系统眼中的你。');
        return;
      }
      try {
        const data = await getPreferenceHeatmap({ username: currentUser });
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SystemEyesModal.tsx:afterHeatmap',message:'Heatmap OK',data:{hasData:!!data},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        setHeatmapData(data ?? null);
        const hasData = data && (
          (data.genres?.length ?? 0) + (data.instruments?.length ?? 0) +
          (data.moods?.length ?? 0) + (data.themes?.length ?? 0)
        ) > 0;
        if (hasData && data) {
          const text = await aiAssistantApi.generateHeatmapExplanation(data);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SystemEyesModal.tsx:afterLLM',message:'LLM explanation OK',data:{textLen:text?.length},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          setExplanation(text);
          explanationSetAt.current = Date.now();
        } else {
          setExplanation('暂无足够的听歌记录。多与系统聊天、多听多评，让 Seren 更了解你哦～');
        }
      } catch (e: any) {
        // #region agent log
        const errMsg = e?.message ?? String(e);
        const errStatus = e?.response?.status;
        const errName = e?.name;
        setDebugError({ message: errMsg, status: errStatus, name: errName });
        fetch('http://127.0.0.1:7242/ingest/9e395332-8d6d-48d4-bf70-0af1889bd542',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SystemEyesModal.tsx:catch',message:'Load failed',data:{errMsg,errStatus,errName},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        console.error('系统眼中的你加载失败:', e);
        const isNetworkOrBackend =
          errStatus == null &&
          (typeof errMsg === 'string' && (errMsg.includes('fetch') || errMsg.includes('Network') || errMsg === 'Load failed'));
        const userMessage = isNetworkOrBackend
          ? '无法连接后端。请确认后端已启动（http://localhost:3000）后刷新重试。'
          : '加载失败，请稍后再试。';
        setError(userMessage);
        setExplanation(userMessage);
      }
    };
    run();
  }, []);

  useEffect(() => {
    if (!explanation) return;
    const timer = setTimeout(() => setShowTreemap(true), 2000);
    return () => clearTimeout(timer);
  }, [explanation]);

  const treemapItems: { tag: string; weight: number; category: string }[] = [];
  if (heatmapData) {
    const push = (cat: string, list: TagWeight[]) => {
      (list || []).forEach((item) => {
        if (item.weight > 0) treemapItems.push({ tag: item.tag, weight: item.weight, category: cat });
      });
    };
    push('genres', heatmapData.genres);
    push('instruments', heatmapData.instruments);
    push('moods', heatmapData.moods);
    push('themes', heatmapData.themes);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-gray-800">系统眼中的你</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-500 hover:text-gray-700 rounded"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 flex-1 min-h-0">
          {/* 1. 流式阐述 + 主题色四角星 */}
          <div
            className="flex items-start gap-2 text-sm leading-relaxed mb-6"
            style={{ color: '#5c4d60' }}
          >
            <span className="inline-block w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden>
              <svg viewBox="0 0 24 24" className="w-full h-full">
                <defs>
                  <linearGradient id="system-eyes-star" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#91738B" stopOpacity="1" />
                    <stop offset="100%" stopColor="#D8CECF" stopOpacity="0.9" />
                  </linearGradient>
                </defs>
                <path
                  d="M12 2 L14.5 9.5 L22 12 L14.5 14.5 L12 22 L9.5 14.5 L2 12 L9.5 9.5 Z"
                  fill="url(#system-eyes-star)"
                />
              </svg>
            </span>
            <div className="flex-1 min-w-0">
              {explanation ? (
                <StreamText text={explanation} charPerMs={24} />
              ) : (
                <span className="text-gray-400">正在生成...</span>
              )}
            </div>
          </div>

          {/* 2. Treemap：2s 后展开，弹开感 */}
          {showTreemap && treemapItems.length > 0 && (
            <div
              className="rounded-lg overflow-hidden border border-gray-200"
              style={{
                animation: 'system-eyes-treemap-in 0.4s ease-out forwards',
              }}
            >
              <style>{`
                @keyframes system-eyes-treemap-in {
                  from { opacity: 0; transform: scale(0.92); }
                  to { opacity: 1; transform: scale(1); }
                }
              `}</style>
              <div className="flex flex-wrap gap-0.5 p-2" style={{ minHeight: 120 }}>
                {treemapItems.map((item, i) => {
                  const color = CATEGORY_COLORS[item.category] || '#91738B';
                  return (
                    <div
                      key={`${item.category}-${item.tag}-${i}`}
                      className="rounded inline-flex items-center justify-center text-white text-xs font-medium truncate px-1.5 py-1.5 transition-transform hover:scale-105"
                      style={{
                        flex: `${item.weight} 1 0`,
                        minWidth: 56,
                        maxWidth: '100%',
                        backgroundColor: color,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                      }}
                      title={`${tagToChinese(item.tag)} ${item.tag} (${item.weight > 0 ? '+' : ''}${item.weight.toFixed(1)})`}
                    >
                      {tagToChinese(item.tag) || item.tag}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {error && explanation !== error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          {debugError && (
            <p className="mt-2 text-xs text-gray-400 font-mono" title="调试用，确认根因后可移除">
              err: {debugError.message}{debugError.status != null ? ` | status: ${debugError.status}` : ''}{debugError.name ? ` | ${debugError.name}` : ''}
            </p>
          )}
        </div>

        {/* 3. 底部提示 */}
        <div className="p-4 border-t border-gray-100 text-center">
          <p className="text-sm text-gray-500">多与系统聊天让 Seren 更了解你哦～</p>
        </div>
      </div>
    </div>
  );
}
