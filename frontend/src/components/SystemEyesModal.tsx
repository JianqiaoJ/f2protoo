import { useEffect, useState, useRef } from 'react';
import { getCurrentUser } from '../utils/storage';
import { getPreferenceHeatmap, logSystemEyesRequest, type PreferenceHeatmapData, type TagWeight } from '../api/preferenceHeatmap';

/** 情绪与主题合并为「情绪/主题」：同 tag 只保留一条，权重相加 */
function mergeMoodsThemes(moods: TagWeight[], themes: TagWeight[]): TagWeight[] {
  const byTag = new Map<string, number>();
  [...moods, ...themes].forEach(({ tag, weight }) => {
    byTag.set(tag, (byTag.get(tag) ?? 0) + weight);
  });
  return Array.from(byTag.entries()).map(([tag, weight]) => ({ tag, weight })).filter((t) => t.weight > 0);
}
import { aiAssistantApi } from '../api/aiAssistant';
import { tagToChinese } from '../utils/tagToChinese';
import { usePlayerStore } from '../store';
import { TextWithBoldTags } from './TextWithBoldTags';

/** 类别基础色，用 rgba 提高透明度（整体更透明）；情绪与主题合并为「情绪/主题」一类 */
const CATEGORY_COLORS: Record<string, string> = {
  genres: 'rgba(145, 115, 139, 0.72)',
  instruments: 'rgba(139, 119, 101, 0.72)',
  moods_themes: 'rgba(120, 130, 150, 0.72)', // 情绪/主题 合并，不重复展示
};

/** Treemap 布局：权重越高面积越大。strip 按行填充，每行高度 ∝ 该行权重和 */
function computeTreemapLayout(
  items: { tag: string; weight: number; category: string }[],
  width: number,
  height: number
): { item: typeof items[0]; x: number; y: number; w: number; h: number }[] {
  if (items.length === 0) return [];
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  if (totalWeight <= 0) return [];
  const sorted = [...items].sort((a, b) => b.weight - a.weight);
  const numRows = Math.max(1, Math.min(sorted.length, Math.round(Math.sqrt(sorted.length * 2))));
  const chunkSize = Math.ceil(sorted.length / numRows);
  const rows: typeof sorted[] = [];
  for (let i = 0; i < sorted.length; i += chunkSize) {
    rows.push(sorted.slice(i, i + chunkSize));
  }
  const result: { item: typeof items[0]; x: number; y: number; w: number; h: number }[] = [];
  let currentY = 0;
  for (const row of rows) {
    const rowSum = row.reduce((s, i) => s + i.weight, 0);
    const rowHeight = (rowSum / totalWeight) * height;
    let currentX = 0;
    for (const item of row) {
      const w = (item.weight / rowSum) * width;
      result.push({ item, x: currentX, y: currentY, w, h: rowHeight });
      currentX += w;
    }
    currentY += rowHeight;
  }
  return result;
}

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
  return <TextWithBoldTags text={text.slice(0, visibleLength)} as="span" />;
}

export default function SystemEyesModal({ onClose }: SystemEyesModalProps) {
  const [explanation, setExplanation] = useState<string>('');
  const [heatmapData, setHeatmapData] = useState<PreferenceHeatmapData | null>(null);
  const [showTreemap, setShowTreemap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugError, setDebugError] = useState<{ message: string; status?: number; name?: string } | null>(null);
  const explanationSetAt = useRef<number>(0);

  const currentSystem = usePlayerStore((s) => s.currentSystem);

  useEffect(() => {
    const run = async () => {
      const currentUser = getCurrentUser();
      if (!currentUser) {
        setExplanation('请先登录以查看系统眼中的你痴迷于…。');
        return;
      }
      setError(null);
      setExplanation('正在加载偏好数据…');
      try {
        const data = await getPreferenceHeatmap({ username: currentUser, system_type: currentSystem });
        setHeatmapData(data ?? null);
        const moodsThemesUniqueCount = new Set([
          ...(data?.moods ?? []).map((t) => t.tag),
          ...(data?.themes ?? []).map((t) => t.tag),
        ]).size;
        const hasData = data && (
          (data.genres?.length ?? 0) + (data.instruments?.length ?? 0) + moodsThemesUniqueCount
        ) > 0;
        if (hasData && data) {
          // 先让用户看到「正在生成」和树状图，不阻塞在 LLM 上
          setExplanation('正在生成描述…');
          const text = await aiAssistantApi.generateHeatmapExplanation(data);
          setExplanation(text);
          explanationSetAt.current = Date.now();
          // 记录到 DB：请求时间、返回文字、treemap tag 与权重
          logSystemEyesRequest({
            username: currentUser,
            system_type: currentSystem,
            explanation_text: text,
            treemap_data: data,
          }).catch(() => {});
        } else {
          setExplanation('暂无足够的听歌记录。至少完成一次「听完并评分」或「收藏」后才会产生听歌记录；多听多评，让 Seren 更了解你哦～');
        }
      } catch (e: any) {
        const errMsg = e?.message ?? String(e);
        const errStatus = e?.response?.status;
        const errName = e?.name;
        setDebugError({ message: errMsg, status: errStatus, name: errName });
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
  }, [currentSystem]);

  // 有偏好数据后尽快显示树状图（不等待 LLM 描述），避免「迟迟不能生成」的空白感；情绪/主题已合并计数
  useEffect(() => {
    if (!heatmapData) return;
    const merged = mergeMoodsThemes(heatmapData.moods ?? [], heatmapData.themes ?? []);
    const totalTags = (heatmapData.genres?.length ?? 0) + (heatmapData.instruments?.length ?? 0) + merged.length;
    if (totalTags === 0) return;
    const timer = setTimeout(() => setShowTreemap(true), 400);
    return () => clearTimeout(timer);
  }, [heatmapData]);

  // 生成 treemap 时输出详细 tags 与权重到控制台（情绪/主题已合并）
  useEffect(() => {
    if (!heatmapData) return;
    const merged = mergeMoodsThemes(heatmapData.moods ?? [], heatmapData.themes ?? []);
    const fmt = (list: TagWeight[]) =>
      (list || []).map((item) => `${item.tag}: ${item.weight > 0 ? '+' : ''}${item.weight.toFixed(2)}`).join(', ') || '（无）';
    console.log('[Treemap] 偏好 tags 与权重:', {
      风格_genres: fmt(heatmapData.genres ?? []),
      乐器_instruments: fmt(heatmapData.instruments ?? []),
      '情绪/主题_moods_themes': fmt(merged),
    });
  }, [heatmapData]);

  const treemapItems: { tag: string; weight: number; category: string }[] = [];
  if (heatmapData) {
    const push = (cat: string, list: TagWeight[]) => {
      (list || []).forEach((item) => {
        if (item.weight > 0) treemapItems.push({ tag: item.tag, weight: item.weight, category: cat });
      });
    };
    push('genres', heatmapData.genres);
    push('instruments', heatmapData.instruments);
    push('moods_themes', mergeMoodsThemes(heatmapData.moods ?? [], heatmapData.themes ?? []));
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-2 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-xs font-semibold text-gray-800">系统眼中的你痴迷于…</h2>
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

          {/* 2. Treemap：权重越高面积越大；2s 后展开，窗口内弹开感；颜色更透明 */}
          {showTreemap && treemapItems.length > 0 && (() => {
            const layout = computeTreemapLayout(treemapItems, 100, 100);
            return (
              <div
                className="rounded-lg overflow-hidden border border-gray-200 relative"
                style={{
                  height: 200,
                  animation: 'system-eyes-treemap-pop 0.5s cubic-bezier(0.34, 1.4, 0.64, 1) forwards',
                }}
              >
                <style>{`
                  @keyframes system-eyes-treemap-pop {
                    from { opacity: 0; transform: scale(0.88); }
                    70% { opacity: 1; transform: scale(1.02); }
                    to { opacity: 1; transform: scale(1); }
                  }
                `}</style>
                <div className="absolute inset-0 w-full h-full p-0.5 box-border">
                  {layout.map(({ item, x, y, w, h }, i) => {
                    const color = CATEGORY_COLORS[item.category] || 'rgba(145, 115, 139, 0.72)';
                    const zh = tagToChinese(item.tag);
                    const labelText = zh && zh !== item.tag ? `${zh} ${item.tag}` : item.tag;
                    return (
                      <div
                        key={`${item.category}-${item.tag}-${i}`}
                        className="absolute rounded-none flex items-center justify-center text-white text-xs font-bold truncate transition-transform hover:scale-[1.03] border border-white/90 box-border"
                        style={{
                          left: `${x}%`,
                          top: `${y}%`,
                          width: `${w}%`,
                          height: `${h}%`,
                          backgroundColor: color,
                          boxShadow: 'none',
                        }}
                        title={`${labelText} (${item.weight > 0 ? '+' : ''}${item.weight.toFixed(1)})`}
                      >
                        {labelText}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          {error && explanation !== error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          {debugError && (
            <p className="mt-2 text-xs text-gray-400 font-mono" title="调试用，确认根因后可移除">
              err: {debugError.message}{debugError.status != null ? ` | status: ${debugError.status}` : ''}{debugError.name ? ` | ${debugError.name}` : ''}
            </p>
          )}
        </div>

        {/* 3. 底部提示 */}
        <div className="p-4 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-500">多与系统聊天让 Seren 更了解你哦～</p>
        </div>
      </div>
    </div>
  );
}
