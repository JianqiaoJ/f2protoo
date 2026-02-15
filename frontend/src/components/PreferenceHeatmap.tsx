import { useEffect, useState } from 'react';
import { getCurrentUser } from '../utils/storage';
import { getPreferenceHeatmap, TagWeight } from '../api/preferenceHeatmap';
import { aiAssistantApi } from '../api/aiAssistant';

interface PreferenceHeatmapProps {
  onClose?: () => void;
}

export default function PreferenceHeatmap({ onClose }: PreferenceHeatmapProps) {
  const [heatmapData, setHeatmapData] = useState<any>(null);
  const [explanation, setExplanation] = useState<string>('正在生成偏好解释...');
  const [loading, setLoading] = useState(true);
  const currentUser = getCurrentUser();

  useEffect(() => {
    const fetchHeatmap = async () => {
      if (!currentUser) {
        setExplanation('请先登录以查看您的偏好热力图。');
        setLoading(false);
        return;
      }

      try {
        console.log('🔍 开始获取热力图数据，用户:', currentUser);
        const data = await getPreferenceHeatmap({ username: currentUser });
        console.log('🔍 获取到的热力图数据:', data);
        setHeatmapData(data);

        if (data) {
          // 检查是否有任何数据
          const hasData = data.genres?.length > 0 || 
                          data.instruments?.length > 0 || 
                          data.moods?.length > 0 || 
                          data.themes?.length > 0;
          
          console.log('🔍 数据检查结果:', {
            hasData,
            genres: data.genres?.length || 0,
            instruments: data.instruments?.length || 0,
            moods: data.moods?.length || 0,
            themes: data.themes?.length || 0,
          });
          
          if (hasData) {
            // 使用LLM生成热力图解释
            const exp = await aiAssistantApi.generateHeatmapExplanation(data);
            setExplanation(exp);
          } else {
            setExplanation('暂无足够的听歌记录来生成偏好热力图。请多听一些歌曲并评分，系统会学习您的偏好。');
          }
        } else {
          console.warn('⚠️ 热力图数据为 null');
          setExplanation('暂无足够的听歌记录来生成偏好热力图。请多听一些歌曲并评分，系统会学习您的偏好。');
        }
      } catch (error) {
        console.error('获取偏好热力图数据失败:', error);
        setExplanation('获取偏好热力图失败，请稍后再试。');
      } finally {
        setLoading(false);
      }
    };
    fetchHeatmap();
  }, [currentUser]);

  // 计算所有类别的最大和最小权重，用于归一化
  const getAllWeights = () => {
    if (!heatmapData) return { max: 10, min: -10 };
    const allWeights: number[] = [];
    ['genres', 'instruments', 'moods', 'themes'].forEach(category => {
      heatmapData[category]?.forEach((item: TagWeight) => {
        allWeights.push(item.weight);
      });
    });
    if (allWeights.length === 0) return { max: 10, min: -10 };
    return {
      max: Math.max(...allWeights, 10),
      min: Math.min(...allWeights, -10)
    };
  };

  const getColor = (weight: number, maxWeight: number, minWeight: number) => {
    // 负数权重（不偏好）：使用浅灰色系
    if (weight < 0) {
      const absWeight = Math.abs(weight);
      const maxAbs = Math.max(Math.abs(minWeight), 1);
      const intensity = Math.min(absWeight / maxAbs, 1);
      // 从浅灰到中灰：rgb(240, 240, 240) 到 rgb(200, 200, 200)
      const gray = Math.round(240 - 40 * intensity);
      return `rgb(${gray}, ${gray}, ${gray})`;
    }
    
    // 正数权重（偏好）：使用主题色渐变 D8CECF (浅) 到 91738B (深)
    const range = maxWeight;
    if (range === 0) return 'rgb(216, 206, 207)'; // 默认浅色
    
    const normalizedWeight = Math.min(weight / range, 1);
    
    const startColor = { r: 216, g: 206, b: 207 }; // D8CECF (浅色)
    const endColor = { r: 145, g: 115, b: 139 };   // 91738B (深色)

    const r = Math.round(startColor.r + (endColor.r - startColor.r) * normalizedWeight);
    const g = Math.round(startColor.g + (endColor.g - startColor.g) * normalizedWeight);
    const b = Math.round(startColor.b + (endColor.b - startColor.b) * normalizedWeight);

    return `rgb(${r}, ${g}, ${b})`;
  };

  const renderHeatmapGrid = (title: string, tags: TagWeight[]) => {
    if (tags.length === 0) {
      return (
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">{title}</h3>
          <p className="text-gray-500 text-sm">暂无相关偏好</p>
        </div>
      );
    }

    const { max, min } = getAllWeights();
    const gridCols = Math.min(tags.length, 6); // 每行最多6个格子

    return (
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">{title}</h3>
        <div 
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}
        >
          {tags.map((item, index) => {
            const bgColor = getColor(item.weight, max, min);
            const isPositive = item.weight > 0;
            const textColor = isPositive ? 'text-white' : 'text-gray-800';
            
            return (
              <div
                key={index}
                className="relative rounded-lg p-4 shadow-md transition-all hover:scale-105 hover:shadow-lg cursor-pointer"
                style={{ backgroundColor: bgColor }}
              >
                <div className={`text-center ${textColor}`}>
                  <div className="font-semibold text-sm mb-1">{item.tag}</div>
                  <div className={`text-xs font-medium ${textColor} opacity-90`}>
                    {item.weight > 0 ? '+' : ''}{item.weight.toFixed(1)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-600">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-t-4 border-gray-400 border-t-transparent mb-4"></div>
        <p>正在加载您的偏好热力图...</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl bg-white rounded-lg shadow-xl p-8 relative overflow-y-auto max-h-full">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 transition-colors"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      
      <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">您的听歌偏好热力图</h2>

      <div className="mb-8 p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg">
        <p className="font-medium text-gray-800 mb-2">Seren解读：</p>
        <p className="text-gray-700 leading-relaxed">{explanation}</p>
      </div>

      {heatmapData ? (
        <div>
          {renderHeatmapGrid('风格 (Genres)', heatmapData.genres)}
          {renderHeatmapGrid('乐器 (Instruments)', heatmapData.instruments)}
          {renderHeatmapGrid('情绪 (Moods)', heatmapData.moods)}
          {renderHeatmapGrid('主题 (Themes)', heatmapData.themes)}
        </div>
      ) : (
        <p className="text-gray-600 text-center">{explanation}</p>
      )}

      <div className="mt-6 pt-6 border-t border-gray-200">
        <div className="mb-3">
          <p className="text-sm font-semibold text-gray-700 mb-2 text-center">颜色图例：</p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded" style={{ backgroundColor: 'rgb(216, 206, 207)' }}></div>
              <span className="text-xs text-gray-600">低偏好</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded" style={{ backgroundColor: 'rgb(145, 115, 139)' }}></div>
              <span className="text-xs text-gray-600">高偏好</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded" style={{ backgroundColor: 'rgb(220, 220, 220)' }}></div>
              <span className="text-xs text-gray-600">不偏好</span>
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-500 text-center">
          权重说明：正数表示偏好，负数表示不偏好。数值越大，偏好程度越高。
        </p>
      </div>
    </div>
  );
}
