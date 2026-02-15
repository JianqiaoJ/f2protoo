import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerStore } from '../store';
import { JamendoTrack } from '../types';
import { logListeningBehavior } from '../api/behavior';
import { getCurrentUser, getUserStorageKey } from '../utils/storage';
import { ChatMessage, aiAssistantApi } from '../api/aiAssistant';
import { getDiversityRecommendation } from '../api/diversity';
import { jamendoApi } from '../api';
import { appendSystemLog } from '../api/logs';
import { getRecommendWhy } from '../api/recommend';

interface MusicPlayerProps {
  isAssistantVisible?: boolean;
  onToggleAssistant?: () => void;
}

/** 流式显示文字：从左到右逐字出现；onComplete 在全文显示完后调用一次 */
function StreamingText({ text, charPerMs = 28, onComplete }: { text: string; charPerMs?: number; onComplete?: () => void }) {
  const [visibleLength, setVisibleLength] = useState(0);
  const onCompleteCalledRef = useRef(false);
  useEffect(() => {
    if (!text) {
      setVisibleLength(0);
      onCompleteCalledRef.current = false;
      return;
    }
    setVisibleLength(0);
    onCompleteCalledRef.current = false;
    const len = text.length;
    const t = setInterval(() => {
      setVisibleLength((prev) => {
        if (prev >= len) {
          clearInterval(t);
          return len;
        }
        return prev + 1;
      });
    }, charPerMs);
    return () => clearInterval(t);
  }, [text, charPerMs]);
  useEffect(() => {
    if (text && visibleLength >= text.length && onComplete && !onCompleteCalledRef.current) {
      onCompleteCalledRef.current = true;
      onComplete();
    }
  }, [text, visibleLength, onComplete]);
  return <>{text.slice(0, visibleLength)}</>;
}

export default function MusicPlayer({ isAssistantVisible = false, onToggleAssistant }: MusicPlayerProps) {
  const {
    currentTrack,
    isPlaying,
    loading,
    error,
    togglePlayPause,
    loadRandomTrack,
    playNextFromList,
    addFavorite,
    removeFavorite,
    setRating,
    getRating,
    favorites,
    addHistoryRecord,
    getUserPreferences,
    consecutivePlayCount,
    incrementConsecutivePlayCount,
    resetConsecutivePlayCount,
    recommendedTrackIds,
    recommendedTrackIndex,
    currentSystem,
  } = usePlayerStore();

  const audioRef = useRef<HTMLAudioElement>(null);
  const ratingRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showRatingTip, setShowRatingTip] = useState(false);
  const [recommendationTip, setRecommendationTip] = useState<string | null>(null); // 推荐解释气泡（主句）
  const [recommendationTipSuffix, setRecommendationTipSuffix] = useState<string | null>(null); // 1s 后追加「点击和我聊聊吧~」
  const [whyThisTrackTip, setWhyThisTrackTip] = useState<string | null>(null); // 「这首歌的感觉」气泡（推荐气泡消失 3s 后展示）
  const [ratingFeedbackTip, setRatingFeedbackTip] = useState<{ text: string; rating: number; trackId: string } | null>(null); // 评分反馈气泡
  const lastRatingForFeedbackRef = useRef<{ trackId: string; rating: number } | null>(null); // 记录上次触发反馈的评分
  const [oneMinuteFeedbackTip, setOneMinuteFeedbackTip] = useState<{ text: string; trackId: string } | null>(null); // 1分钟反馈气泡
  const hasTriggeredOneMinuteFeedbackRef = useRef<{ trackId: string } | null>(null); // 记录是否已触发1分钟反馈
  const [ninetyFivePercentTip, setNinetyFivePercentTip] = useState<{ text: string; trackId: string } | null>(null); // 95%进度反馈气泡
  const hasTriggeredNinetyFivePercentRef = useRef<{ trackId: string } | null>(null); // 记录是否已触发95%反馈
  const hasAddedConfirmMessageForTrackRef = useRef<string | null>(null); // 同一首歌只加一条「确认」类消息，避免连续多条让用户确认
  const [quickSkipTip, setQuickSkipTip] = useState<string | null>(null); // 快速切换提示气泡
  const quickSkipCountRef = useRef<number>(0); // 记录连续快速切换的次数
  const hasTriggeredQuickSkipTipRef = useRef<boolean>(false); // 记录是否已触发快速切换提示
  const [diversityTip, setDiversityTip] = useState<string | null>(null); // 多样性推荐提示气泡
  const hasTriggeredDiversityRef = useRef<boolean>(false); // 记录是否已触发多样性推荐
  const loadRandomTrackInProgressRef = useRef<boolean>(false); // 推荐下一首请求进行中时，仍可从待播列表播下一首
  const [bubbleQueueIndex, setBubbleQueueIndex] = useState(0); // 当前展示的气泡在队列中的下标，实现「一个加载完再加载下一个」
  const bubbleQueueFirstKeyRef = useRef<string | null>(null); // 用于队列首项变化时重置下标
  /** 仅当本次切歌来自「推荐下一首」时显示推荐气泡，避免其它切歌方式（如双击待播）也弹出 */
  const showRecommendationBubbleForNextTrackRef = useRef(false);
  const [volume, setVolume] = useState(1); // 音量，范围 0-1
  const [isMuted, setIsMuted] = useState(false); // 是否静音
  const [showVolumeSlider, setShowVolumeSlider] = useState(false); // 是否显示音量滑块
  const [showTags, setShowTags] = useState(false); // 歌曲下方 tag 默认隐藏，双击封面切换
  const playStartTimeRef = useRef<number>(0); // 记录开始播放的时间
  const lastTrackIdRef = useRef<string>(''); // 记录上一首歌曲ID
  const lastTrackRef = useRef<JamendoTrack | null>(null); // 记录上一首歌曲的完整信息
  const { setCurrentTime: setStoreCurrentTime } = usePlayerStore();

  // 进度条气泡有序队列：同一时间只展示一个，当前气泡流式完成后再展示下一个
  type BubbleItem = { key: string; text: string; type: 'recommendation' | 'whyThisTrack' | 'ratingFeedback' | 'oneMinute' | 'ninetyFive' | 'quickSkip' | 'diversity'; onClick?: () => void; onClose?: () => void; showCloseButton?: boolean };
  const bubbleQueue = useMemo((): BubbleItem[] => {
    const list: BubbleItem[] = [];
    if (recommendationTip) list.push({ key: 'recommendation', text: recommendationTip, type: 'recommendation', onClick: onToggleAssistant });
    if (whyThisTrackTip) list.push({ key: 'whyThisTrack', text: whyThisTrackTip, type: 'whyThisTrack', onClick: onToggleAssistant });
    if (ratingFeedbackTip) list.push({ key: 'ratingFeedback', text: ratingFeedbackTip.text, type: 'ratingFeedback', onClick: onToggleAssistant });
    if (oneMinuteFeedbackTip) list.push({ key: 'oneMinute', text: oneMinuteFeedbackTip.text, type: 'oneMinute', onClick: onToggleAssistant });
    if (ninetyFivePercentTip) list.push({ key: 'ninetyFive', text: ninetyFivePercentTip.text, type: 'ninetyFive', onClick: onToggleAssistant });
    if (quickSkipTip) list.push({ key: 'quickSkip', text: quickSkipTip, type: 'quickSkip', onClick: onToggleAssistant, onClose: () => setQuickSkipTip(null), showCloseButton: true });
    if (diversityTip) list.push({ key: 'diversity', text: diversityTip, type: 'diversity', onClick: onToggleAssistant, onClose: () => setDiversityTip(null), showCloseButton: true });
    return list;
  }, [recommendationTip, whyThisTrackTip, ratingFeedbackTip, oneMinuteFeedbackTip, ninetyFivePercentTip, quickSkipTip, diversityTip, onToggleAssistant]);

  const bubbleQueueLengthRef = useRef(0);
  bubbleQueueLengthRef.current = bubbleQueue.length;

  useEffect(() => {
    const firstKey = bubbleQueue[0]?.key ?? null;
    if (bubbleQueueFirstKeyRef.current !== firstKey) {
      bubbleQueueFirstKeyRef.current = firstKey;
      setBubbleQueueIndex(0);
    }
  }, [bubbleQueue]);

  const isFavorited = currentTrack ? favorites.some(f => f.id === currentTrack.id) : false;
  const currentRating = currentTrack ? getRating(currentTrack.id) : 0;

  // 当歌曲切换时，清除评分反馈气泡和1分钟反馈和95%反馈
  useEffect(() => {
    if (currentTrack) {
      setRatingFeedbackTip(null);
      setOneMinuteFeedbackTip(null);
      setNinetyFivePercentTip(null);
      setDiversityTip(null); // 清除多样性推荐气泡
      lastRatingForFeedbackRef.current = null;
      hasTriggeredOneMinuteFeedbackRef.current = null;
      hasTriggeredNinetyFivePercentRef.current = null;
      hasAddedConfirmMessageForTrackRef.current = null; // 新歌允许一条确认消息
      
      // 重置快速切换计数器（新歌曲开始播放时重置）
      // 注意：这里不重置，因为我们要跟踪连续5次快速切换
      // 只有当用户听完一首歌超过10秒时，才重置计数器
      
      // 注意：不重置hasTriggeredDiversityRef，因为多样性推荐是一次性的，触发后需要等待下次达到20首
    }
  }, [currentTrack?.id]);

  // 当Seren打开时，清除评分反馈气泡和1分钟反馈和95%反馈和快速切换提示和多样性推荐提示
  useEffect(() => {
    if (isAssistantVisible) {
      setRatingFeedbackTip(null);
      setOneMinuteFeedbackTip(null);
      setNinetyFivePercentTip(null);
      setQuickSkipTip(null);
      setDiversityTip(null);
    }
  }, [isAssistantVisible]);

  // 监听播放时长，当达到1分钟时触发反馈
  useEffect(() => {
    if (!currentTrack || !isPlaying || currentTime < 60) {
      return;
    }

    // 检查是否已经触发过1分钟反馈（避免重复触发）
    if (hasTriggeredOneMinuteFeedbackRef.current?.trackId === currentTrack.id) {
      return;
    }
    // 同一首歌只加一条「确认」类消息，若已加过（1分钟/95%/评分任一）则不再加
    if (hasAddedConfirmMessageForTrackRef.current === currentTrack.id) {
      return;
    }

    // 标记已触发
    hasTriggeredOneMinuteFeedbackRef.current = { trackId: currentTrack.id };

    // 生成1分钟反馈
    const generateFeedback = async () => {
      try {
        const feedbackText = await aiAssistantApi.generateOneMinuteFeedback({
          name: currentTrack.name,
          artist: currentTrack.artist_name,
          tags: currentTrack.tags,
        });

        if (feedbackText) {
          if (hasAddedConfirmMessageForTrackRef.current === currentTrack.id) return;
          hasAddedConfirmMessageForTrackRef.current = currentTrack.id;
          // 添加消息到聊天记录（对歌曲的解析 + 确认喜好按钮，与收藏/打五星一致）
          const feedbackMessage: ChatMessage = {
            role: 'assistant',
            content: feedbackText,
            fromSeren: true,
            buttons: [
              { label: '是这样的！', action: 'confirm_one_minute_feedback' },
              { label: '说的不对', action: 'reject_one_minute_feedback' },
            ],
          };
          const storageKey = getUserStorageKey('ai-assistant-messages');
          const stored = localStorage.getItem(storageKey);
          const messages: ChatMessage[] = stored ? JSON.parse(stored) : [];
          messages.push(feedbackMessage);
          localStorage.setItem(storageKey, JSON.stringify(messages));
          // Seren 未打开时在进度条上弹出气泡，点击可打开 Seren 进行确认（与评分反馈一致）
          if (!isAssistantVisible) {
            setOneMinuteFeedbackTip({
              text: feedbackText,
              trackId: currentTrack.id,
            });
          }
        }
      } catch (error) {
        console.error('生成1分钟反馈失败:', error);
      }
    };

    generateFeedback();
  }, [currentTime, currentTrack, isPlaying, isAssistantVisible]);

  // 监听播放进度，当达到95%时触发反馈（如果标签不在用户偏好中）
  useEffect(() => {
    if (!currentTrack || !isPlaying || progress < 95) {
      return;
    }

    // 检查是否已经触发过95%反馈（避免重复触发）
    if (hasTriggeredNinetyFivePercentRef.current?.trackId === currentTrack.id) {
      return;
    }
    // 同一首歌只加一条「确认」类消息
    if (hasAddedConfirmMessageForTrackRef.current === currentTrack.id) {
      return;
    }

    // 检查歌曲标签是否在用户偏好中
    const userPrefs = getUserPreferences();
    const trackTags = currentTrack.tags || { genres: [], instruments: [], moods: [], themes: [] };
    
    // 检查是否有标签不在用户偏好中
    const hasNewTags = 
      (trackTags.genres.length > 0 && trackTags.genres.some(g => !userPrefs.genres.includes(g))) ||
      (trackTags.instruments.length > 0 && trackTags.instruments.some(i => !userPrefs.instruments.includes(i))) ||
      (trackTags.moods.length > 0 && trackTags.moods.some(m => !userPrefs.moods.includes(m))) ||
      (trackTags.themes.length > 0 && trackTags.themes.some(t => !userPrefs.themes.includes(t)));

    // 如果所有标签都在用户偏好中，不触发反馈
    if (!hasNewTags) {
      return;
    }

    // 标记已触发
    hasTriggeredNinetyFivePercentRef.current = { trackId: currentTrack.id };

    // 生成95%反馈
    const generateFeedback = async () => {
      try {
        const feedbackText = await aiAssistantApi.generateNinetyFivePercentFeedback({
          name: currentTrack.name,
          artist: currentTrack.artist_name,
          tags: currentTrack.tags,
        });

        if (feedbackText) {
          if (hasAddedConfirmMessageForTrackRef.current === currentTrack.id) return;
          hasAddedConfirmMessageForTrackRef.current = currentTrack.id;
          const feedbackMessage: ChatMessage = {
            role: 'assistant',
            content: feedbackText,
            fromSeren: true,
            buttons: [
              { label: '是这样的！', action: 'confirm_ninety_five_percent_feedback' },
              { label: '说的不对', action: 'reject_ninety_five_percent_feedback' },
            ],
          };
          const storageKey = getUserStorageKey('ai-assistant-messages');
          const stored = localStorage.getItem(storageKey);
          const messages: ChatMessage[] = stored ? JSON.parse(stored) : [];
          messages.push(feedbackMessage);
          localStorage.setItem(storageKey, JSON.stringify(messages));
          if (!isAssistantVisible) {
            setNinetyFivePercentTip({
              text: feedbackText,
              trackId: currentTrack.id,
            });
          }
        }
      } catch (error) {
        console.error('生成95%反馈失败:', error);
      }
    };

    generateFeedback();
  }, [progress, currentTrack, isPlaying, isAssistantVisible, getUserPreferences]);

  // 音量控制
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateProgress = () => {
      if (audio.duration) {
        setProgress((audio.currentTime / audio.duration) * 100);
        setCurrentTime(audio.currentTime);
        setStoreCurrentTime(audio.currentTime); // 同步到store
      }
    };

    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', () => {
      setCurrentTime(0);
      setProgress(0);
    });

    return () => {
      audio.removeEventListener('timeupdate', updateProgress);
    };
  }, [currentTrack]);

  // 仅当切歌时加载/重置音频，收藏、评分等不触发重新播放
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    const isNewTrack = lastTrackIdRef.current !== currentTrack.id;
    if (!isNewTrack) return; // 同一首歌（例如只点了收藏），不重新加载

    // 切换歌曲：保存上一首历史并重置播放
    if (lastTrackRef.current && lastTrackIdRef.current && playStartTimeRef.current > 0) {
      const playDuration = Math.floor((Date.now() - playStartTimeRef.current) / 1000);
      const lastTrack = lastTrackRef.current;
      if (playDuration > 0 && lastTrack) {
        addHistoryRecord(lastTrack, playDuration);
        const username = getCurrentUser();
        if (username) {
          const lastRating = getRating(lastTrack.id);
          const currentFavorites = usePlayerStore.getState().favorites;
          const lastFavorited = currentFavorites.some((f: { id: string }) => f.id === lastTrack.id);
          logListeningBehavior({
            username,
            system_type: currentSystem,
            track_name: lastTrack.name,
            artist_name: lastTrack.artist_name,
            track_id: lastTrack.id,
            listen_duration: playDuration,
            is_favorited: lastFavorited,
            rating: lastRating,
          }).catch(err => console.error('记录切换歌曲行为失败:', err));
        }
      }
    }

    audio.load();
    setProgress(0);
    setCurrentTime(0);
    setStoreCurrentTime(0);
    setShowRatingTip(false);

    lastTrackRef.current = currentTrack;
    lastTrackIdRef.current = currentTrack.id;
    playStartTimeRef.current = 0;
  }, [currentTrack, setStoreCurrentTime, addHistoryRecord, getRating]);

  // 仅根据 isPlaying / currentTrack 控制播放，评分、收藏变化不重新执行，避免从头播放
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      if (playStartTimeRef.current === 0 && currentTrack) {
        playStartTimeRef.current = Date.now();
        lastTrackRef.current = currentTrack;
        lastTrackIdRef.current = currentTrack.id;
        const username = getCurrentUser();
        if (username && currentTrack) {
          const state = usePlayerStore.getState();
          const isFav = state.favorites.some((f: { id: string }) => f.id === currentTrack.id);
          const rating = state.getRating(currentTrack.id);
          logListeningBehavior({
            username,
            system_type: currentSystem,
            track_name: currentTrack.name,
            artist_name: currentTrack.artist_name,
            track_id: currentTrack.id,
            listen_duration: 0,
            is_favorited: isFav,
            rating,
          }).catch(err => console.error('记录播放行为失败:', err));
        }
      }
      audio.play().catch(err => {
        console.error('Play failed:', err);
        usePlayerStore.getState().setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, currentTrack]);

  const handlePlayPause = () => {
    togglePlayPause();
  };

  // 生成推荐解释文本
  const generateRecommendationExplanation = (track: JamendoTrack | null): string | null => {
    if (!track || !track.tags) return null;
    
    const userPrefs = getUserPreferences();
    const matchedTags: string[] = [];
    
    // 检查匹配的风格
    if (track.tags.genres && track.tags.genres.length > 0 && userPrefs.genres.length > 0) {
      const matchedGenres = track.tags.genres.filter(g => userPrefs.genres.includes(g));
      if (matchedGenres.length > 0) {
        matchedTags.push(`风格${matchedGenres.join('、')}`);
      }
    }
    
    // 检查匹配的乐器
    if (track.tags.instruments && track.tags.instruments.length > 0 && userPrefs.instruments.length > 0) {
      const matchedInstruments = track.tags.instruments.filter(i => userPrefs.instruments.includes(i));
      if (matchedInstruments.length > 0) {
        matchedTags.push(`器乐${matchedInstruments.join('、')}`);
      }
    }
    
    // 检查匹配的情绪
    if (track.tags.moods && track.tags.moods.length > 0 && userPrefs.moods.length > 0) {
      const matchedMoods = track.tags.moods.filter(m => userPrefs.moods.includes(m));
      if (matchedMoods.length > 0) {
        matchedTags.push(`情绪${matchedMoods.join('、')}`);
      }
    }
    
    // 检查匹配的主题
    if (track.tags.themes && track.tags.themes.length > 0 && userPrefs.themes.length > 0) {
      const matchedThemes = track.tags.themes.filter(t => userPrefs.themes.includes(t));
      if (matchedThemes.length > 0) {
        matchedTags.push(`主题${matchedThemes.join('、')}`);
      }
    }
    
    if (matchedTags.length === 0) return null;
    
    return `根据你偏好的${matchedTags.join('和')}为您推荐`;
  };

  // 添加消息到聊天记录
  const addMessageToChat = (content: string) => {
    try {
      const storageKey = getUserStorageKey('ai-assistant-messages');
      const stored = localStorage.getItem(storageKey);
      const messages: ChatMessage[] = stored ? JSON.parse(stored) : [];
      
      const newMessage: ChatMessage = {
        role: 'assistant',
        content,
      };
      
      messages.push(newMessage);
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch (error) {
      console.error('保存推荐解释消息失败:', error);
    }
  };

  // 记录上一次的trackId，用于判断是否是新的推荐
  const previousTrackIdForExplanationRef = useRef<string>('');
  const recommendationTipTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const whyThisTrackClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // 分割线消息只在 AIAssistant 内根据 currentTrack 添加一次，此处不再重复添加
  
  // 监听 currentTrack 变化，生成推荐解释（仅当本次切歌来自「点击推荐下一首」时显示气泡）
  useEffect(() => {
    if (!currentTrack) {
      previousTrackIdForExplanationRef.current = '';
      return;
    }
    
    // 只有点击「推荐下一首」触发的切歌才显示推荐气泡，其它切歌（双击待播、冷启动等）不弹
    const shouldShowBubble = showRecommendationBubbleForNextTrackRef.current;
    showRecommendationBubbleForNextTrackRef.current = false;

    const isNewRecommendation = (previousTrackIdForExplanationRef.current !== '' && 
                                 previousTrackIdForExplanationRef.current !== currentTrack.id) && shouldShowBubble;
    
    if (isNewRecommendation) {
      const explanation = generateRecommendationExplanation(currentTrack);
      
      if (explanation) {
        setWhyThisTrackTip(null); // 新推荐时先清掉上一首的「感觉」气泡
        // 无论Seren是否展开，都保存到聊天框
        addMessageToChat(explanation);
        // 始终设置推荐解释气泡内容；Seren 收起时由渲染条件 recommendationTip && !isAssistantVisible 显示
        setRecommendationTip(explanation);
        setRecommendationTipSuffix(null);
        const timeouts: ReturnType<typeof setTimeout>[] = [];
        const trackForWhy = currentTrack;
        // 10 秒后关闭「根据…推荐」气泡，再在 3s 后请求「这首歌的感觉」并作为气泡展示（着重强调感觉）
        const t2 = setTimeout(() => {
          setRecommendationTip(null);
          setRecommendationTipSuffix(null);
          const t3 = setTimeout(async () => {
            const stillCurrent = usePlayerStore.getState().currentTrack?.id === trackForWhy.id;
            if (!stillCurrent) return;
            const username = getCurrentUser();
            if (!username) return;
            try {
              const whyData = await getRecommendWhy(username, trackForWhy.id, trackForWhy.tags);
              const text = whyData
                ? await aiAssistantApi.generateWhyThisTrackEmphasizeFeeling(whyData, trackForWhy.name, trackForWhy.artist_name)
                : await aiAssistantApi.generateWhyThisTrackFallbackEmphasizeFeeling(trackForWhy.name, trackForWhy.artist_name, trackForWhy.tags);
              if (usePlayerStore.getState().currentTrack?.id === trackForWhy.id) {
                if (whyThisTrackClearRef.current) clearTimeout(whyThisTrackClearRef.current);
                setWhyThisTrackTip(text);
                whyThisTrackClearRef.current = setTimeout(() => {
                  setWhyThisTrackTip(null);
                  whyThisTrackClearRef.current = null;
                }, 10000);
              }
            } catch (e) {
              console.warn('获取「这首歌的感觉」气泡失败:', e);
            }
          }, 3000); // 推荐气泡消失后 3s
          timeouts.push(t3);
        }, 10000);
        timeouts.push(t2);
        recommendationTipTimeoutsRef.current = timeouts;
      }
    }
    
    // 更新previousTrackIdForExplanationRef
    previousTrackIdForExplanationRef.current = currentTrack.id;
    return () => {
      recommendationTipTimeoutsRef.current.forEach(clearTimeout);
      recommendationTipTimeoutsRef.current = [];
      if (whyThisTrackClearRef.current) {
        clearTimeout(whyThisTrackClearRef.current);
        whyThisTrackClearRef.current = null;
      }
      setWhyThisTrackTip(null);
    };
  }, [currentTrack]);

  const handleNext = async () => {
    console.log('handleNext 被调用:', { currentTrack: !!currentTrack, currentRating, loading });
    
    if (!currentTrack) {
      console.warn('handleNext: 没有当前歌曲');
      return;
    }

    const hasMoreInList = recommendedTrackIds.length > 0 && recommendedTrackIndex < recommendedTrackIds.length;
    const hasRated = currentRating !== 0;

    // 系统 A/B 均要求：未评分不能切到下一首，仅提示
    if (!hasRated) {
      setShowRatingTip(true);
      setTimeout(() => setShowRatingTip(false), 3000);
      return;
    }
    console.log('handleNext: 开始推荐下一首，currentRating =', currentRating, 'hasMoreInList =', hasMoreInList);
    appendSystemLog(`[推荐] 开始推荐下一首，currentRating=${currentRating}，hasMoreInList=${hasMoreInList}`);
    
    // 保存当前歌曲的历史记录
    if (currentTrack && playStartTimeRef.current > 0) {
      const playDuration = Math.floor((Date.now() - playStartTimeRef.current) / 1000);
      if (playDuration > 0) {
        addHistoryRecord(currentTrack, playDuration);
        
        // 记录播放结束行为（更新听歌时长）
        const username = getCurrentUser();
        if (username) {
          logListeningBehavior({
            username,
            system_type: currentSystem,
            track_name: currentTrack.name,
            artist_name: currentTrack.artist_name,
            track_id: currentTrack.id,
            listen_duration: playDuration,
            is_favorited: isFavorited,
            rating: currentRating,
          }).catch(err => console.error('记录播放结束行为失败:', err));
        }
      }
      
      // 检查播放时长是否小于10秒
      if (playDuration < 10) {
        // 增加快速切换计数器
        quickSkipCountRef.current += 1;
        console.log(`⚠️ 快速切换检测: 当前歌曲播放时长 ${playDuration}秒 < 10秒，连续快速切换次数: ${quickSkipCountRef.current}`);
        
          // 如果连续5次快速切换，且未触发过提示，显示气泡
          if (quickSkipCountRef.current >= 5 && !hasTriggeredQuickSkipTipRef.current) {
            hasTriggeredQuickSkipTipRef.current = true;
            const tipMessage = '你似乎对推荐的歌曲都不太满意呢。来聊聊你的喜好，让我更好地为你推荐吧！';
            
            // 如果Seren未展开，显示气泡；如果已展开，直接添加到聊天记录
            if (!isAssistantVisible) {
              setQuickSkipTip(tipMessage);
              // 气泡显示10秒后自动隐藏
              setTimeout(() => {
                setQuickSkipTip(null);
              }, 10000);
            } else {
              // Seren已展开，直接添加到聊天记录
              const storageKey = getUserStorageKey('ai-assistant-messages');
              const stored = localStorage.getItem(storageKey);
              const messages = stored ? JSON.parse(stored) : [];
              const newMessage: ChatMessage = {
                role: 'assistant',
                content: tipMessage,
              };
              messages.push(newMessage);
              localStorage.setItem(storageKey, JSON.stringify(messages));
              // 触发storage事件，让AIAssistant组件重新加载消息
              window.dispatchEvent(new Event('storage'));
            }
          }
      } else {
        // 播放时长 >= 10秒，重置快速切换计数器
        if (quickSkipCountRef.current > 0) {
          console.log(`✅ 播放时长 ${playDuration}秒 >= 10秒，重置快速切换计数器`);
          quickSkipCountRef.current = 0;
          hasTriggeredQuickSkipTipRef.current = false; // 重置提示标记，允许下次再次触发
        }
      }
      
      playStartTimeRef.current = 0;
    }
    
    // 增加连续听歌数量
    incrementConsecutivePlayCount();
    const newCount = consecutivePlayCount + 1;
    console.log(`📊 连续听歌数量: ${newCount}`);
    
    // 检查是否达到20首，触发多样性推荐
    if (newCount >= 20 && !hasTriggeredDiversityRef.current) {
      hasTriggeredDiversityRef.current = true;
      resetConsecutivePlayCount(); // 重置计数，允许下次再次触发
      appendSystemLog('[推荐] 触发多样性推荐（连续听歌达20首）');
      
      // 获取多样性推荐
      const username = getCurrentUser();
      if (username) {
        try {
          const diversityTrackId = await getDiversityRecommendation({ username });
          if (diversityTrackId) {
            // 获取歌曲信息
            const diversityTrack = await jamendoApi.getTrackById(diversityTrackId);
            if (diversityTrack) {
              // 使用LLM生成介绍文字
              const introduction = await aiAssistantApi.generateDiversityIntroduction({
                name: diversityTrack.name,
                artist: diversityTrack.artist_name,
                tags: diversityTrack.tags,
              });
              
              // 如果Seren未展开，显示气泡；如果已展开，直接添加到聊天记录
              if (!isAssistantVisible) {
                setDiversityTip(introduction);
                // 气泡显示10秒后自动隐藏
                setTimeout(() => {
                  setDiversityTip(null);
                }, 10000);
              } else {
                // Seren已展开，直接添加到聊天记录（LLM 产出，标记 Seren）
                const storageKey = getUserStorageKey('ai-assistant-messages');
                const stored = localStorage.getItem(storageKey);
                const messages = stored ? JSON.parse(stored) : [];
                const newMessage: ChatMessage = {
                  role: 'assistant',
                  content: introduction,
                  fromSeren: true,
                };
                messages.push(newMessage);
                localStorage.setItem(storageKey, JSON.stringify(messages));
                // 触发storage事件，让AIAssistant组件重新加载消息
                window.dispatchEvent(new Event('storage'));
              }
              
              // 加载多样性推荐歌曲
              appendSystemLog(`[推荐] 多样性推荐成功 - track_id: ${diversityTrack.id}《${diversityTrack.name}》`);
              const { setCurrentTrack, setIsPlaying } = usePlayerStore.getState();
              showRecommendationBubbleForNextTrackRef.current = true;
              setCurrentTrack(diversityTrack);
              setIsPlaying(true);
              return; // 直接返回，不继续执行loadRandomTrack
            }
          }
        } catch (error) {
          console.error('获取多样性推荐失败:', error);
          appendSystemLog(`[推荐] 获取多样性推荐失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    
    // 有评分，正常加载下一首
    // 若正在拉取推荐结果且待播列表还有内容，直接播待播列表下一首，不等待接口
    if (loadRandomTrackInProgressRef.current && hasMoreInList) {
      showRecommendationBubbleForNextTrackRef.current = true;
      await playNextFromList();
      return;
    }
    // 记录当前trackId，用于判断是否是新的推荐
    const currentTrackIdBeforeLoad = currentTrack?.id || '';
    previousTrackIdForExplanationRef.current = currentTrackIdBeforeLoad;
    loadRandomTrackInProgressRef.current = true;
    showRecommendationBubbleForNextTrackRef.current = true;
    try {
      await loadRandomTrack();
    } finally {
      loadRandomTrackInProgressRef.current = false;
    }
  };

  // 独立的收藏功能，不影响评分
  const handleFavorite = () => {
    if (currentTrack) {
      const username = getCurrentUser();
      if (isFavorited) {
        removeFavorite(currentTrack.id);
        // 记录取消收藏行为
        if (username) {
          logListeningBehavior({
            username,
            system_type: currentSystem,
            track_name: currentTrack.name,
            artist_name: currentTrack.artist_name,
            track_id: currentTrack.id,
            listen_duration: 0,
            is_favorited: false,
            rating: currentRating,
          }).catch(err => console.error('记录取消收藏行为失败:', err));
        }
      } else {
        addFavorite(currentTrack);
        // 记录收藏行为
        if (username) {
          logListeningBehavior({
            username,
            system_type: currentSystem,
            track_name: currentTrack.name,
            artist_name: currentTrack.artist_name,
            track_id: currentTrack.id,
            listen_duration: 0,
            is_favorited: true,
            rating: currentRating,
          }).catch(err => console.error('记录收藏行为失败:', err));
        }
      }
    }
  };

  // 独立的评分功能，不影响收藏状态
  const handleRating = async (newRating: number) => {
    if (currentTrack) {
      setRating(currentTrack.id, newRating);
      // 评分后隐藏提示
      setShowRatingTip(false);
      
      // 记录评分行为
      const username = getCurrentUser();
      if (username) {
        logListeningBehavior({
          username,
          system_type: currentSystem,
          track_name: currentTrack.name,
          artist_name: currentTrack.artist_name,
          track_id: currentTrack.id,
          listen_duration: 0,
          is_favorited: isFavorited,
          rating: newRating,
        }).catch(err => console.error('记录评分行为失败:', err));
      }

      // 如果评分为1-2星或4-5星，生成反馈（同一首歌只加一条确认消息，若 1分钟/95% 已加过则不再加）
      if ((newRating <= 2 || newRating >= 4) && 
          (!lastRatingForFeedbackRef.current || 
           lastRatingForFeedbackRef.current.trackId !== currentTrack.id ||
           lastRatingForFeedbackRef.current.rating !== newRating)) {
        lastRatingForFeedbackRef.current = { trackId: currentTrack.id, rating: newRating };
        if (hasAddedConfirmMessageForTrackRef.current === currentTrack.id) return;
        try {
          const feedbackText = await aiAssistantApi.generateRatingFeedback(newRating, {
            name: currentTrack.name,
            artist: currentTrack.artist_name,
            tags: currentTrack.tags,
          });

          if (feedbackText) {
            hasAddedConfirmMessageForTrackRef.current = currentTrack.id;
            const feedbackMessage: ChatMessage = {
              role: 'assistant',
              content: feedbackText,
              fromSeren: true,
              buttons: [
                { label: '是这样的！', action: 'confirm_rating_feedback' },
                { label: '说的不对', action: 'reject_rating_feedback' },
              ],
            };
            const storageKey = getUserStorageKey('ai-assistant-messages');
            const stored = localStorage.getItem(storageKey);
            const messages: ChatMessage[] = stored ? JSON.parse(stored) : [];
            messages.push(feedbackMessage);
            localStorage.setItem(storageKey, JSON.stringify(messages));
            if (!isAssistantVisible) {
              setRatingFeedbackTip({
                text: feedbackText,
                rating: newRating,
                trackId: currentTrack.id,
              });
            }
          }
        } catch (error) {
          console.error('生成评分反馈失败:', error);
        }
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleVolumeToggle = () => {
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  // 进度条拖动：跳转到指定位置
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const p = parseFloat(e.target.value);
    const audio = audioRef.current;
    const dur = audio?.duration ?? currentTrack?.duration ?? 0;
    if (audio && isFinite(dur) && dur > 0) {
      const newTime = (p / 100) * dur;
      audio.currentTime = newTime;
      setProgress(p);
      setCurrentTime(newTime);
      setStoreCurrentTime(newTime);
    }
  };

  // 优先用 audio 的 duration，未加载时用曲目信息的 duration，避免进度条被误判为不可用
  const totalDuration = (audioRef.current?.duration != null && isFinite(audioRef.current.duration) && audioRef.current.duration > 0)
    ? audioRef.current.duration
    : (currentTrack?.duration ?? 0);

  if (loading && !currentTrack) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  if (error && !currentTrack) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={handleNext}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!currentTrack) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100 p-8 relative">
        {/* 仅系统 B 显示唤起小助手按钮 */}
        {currentSystem === 'B' && onToggleAssistant && !isAssistantVisible && (
          <button
            onClick={onToggleAssistant}
            className="absolute top-4 right-4 flex items-center px-3 py-2 text-sm transition-all awaken-seren-button"
          >
            <span style={{
              background: 'linear-gradient(135deg, #D8CECF 0%, #91738B 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              唤起Seren&gt;&gt;
            </span>
          </button>
        )}
        {/* 黑胶封面占位符 */}
        <div className="mb-8">
          <div className="w-80 h-80 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center shadow-2xl relative overflow-hidden">
            {/* 黑胶中心圆 */}
            <div className="w-24 h-24 rounded-full bg-gray-300 z-10 border-4 border-gray-400"></div>
            {/* 黑胶纹理 */}
            <div className="absolute inset-0 opacity-20" style={{
              backgroundImage: 'radial-gradient(circle at 50% 50%, transparent 20%, rgba(255,255,255,0.1) 20%, rgba(255,255,255,0.1) 21%, transparent 21%)',
              backgroundSize: '40px 40px'
            }}></div>
          </div>
        </div>
        
        {/* 骨架屏占位符 */}
        <div className="text-center mb-6 w-full max-w-2xl">
          {/* 歌名骨架屏 */}
          <div className="h-8 bg-gray-300 rounded-lg mb-3 mx-auto w-64 animate-pulse"></div>
          {/* 歌手骨架屏 */}
          <div className="h-6 bg-gray-300 rounded-lg mb-4 mx-auto w-48 animate-pulse"></div>
          {/* Tag骨架屏 */}
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            <div className="h-6 bg-gray-300 rounded-full w-20 animate-pulse"></div>
            <div className="h-6 bg-gray-300 rounded-full w-24 animate-pulse"></div>
            <div className="h-6 bg-gray-300 rounded-full w-16 animate-pulse"></div>
          </div>
        </div>
        
        {/* 进度条骨架屏 */}
        <div className="w-full max-w-2xl mb-6">
          <div className="flex items-center gap-1.5 mb-2">
            <div className="h-4 bg-gray-300 rounded w-12 animate-pulse"></div>
            <div className="flex-1 h-2 bg-gray-300 rounded-full animate-pulse"></div>
            <div className="h-4 bg-gray-300 rounded w-12 animate-pulse"></div>
          </div>
        </div>
        
        {/* 按钮骨架屏 */}
        <div className="flex items-center justify-center gap-6 w-full max-w-2xl">
          <div className="h-8 bg-gray-300 rounded-lg w-20 animate-pulse"></div>
          <div className="h-8 bg-gray-300 rounded-lg w-32 animate-pulse"></div>
          <div className="h-8 bg-gray-300 rounded-lg w-24 animate-pulse"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100 p-8 relative">
      {/* 仅系统 B 显示唤起小助手按钮 */}
      {currentSystem === 'B' && onToggleAssistant && !isAssistantVisible && (
        <button
          onClick={onToggleAssistant}
          className="absolute top-4 right-4 flex items-center px-3 py-2 text-sm transition-all awaken-seren-button"
        >
          <span style={{
            background: 'linear-gradient(135deg, #D8CECF 0%, #91738B 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            唤起Seren&gt;&gt;
          </span>
        </button>
      )}
      {/* 专辑 + 音乐信息区域（加载时仅显示骨架屏，不保留原专辑） */}
      <div className="relative mb-6">
        {loading && currentTrack ? (
          /* 正在为您加速推荐：仅骨架屏 + 旋转圆环与文案，不渲染原专辑 */
          <div className="flex flex-col items-center pt-8 pb-8">
            <div className="w-80 h-80 rounded-2xl bg-gray-200 animate-pulse shrink-0" />
            <div className="w-64 h-8 bg-gray-200 rounded animate-pulse mt-6 shrink-0" />
            <div className="w-48 h-6 bg-gray-200 rounded animate-pulse mt-2 shrink-0" />
            <div className="flex flex-col items-center gap-4 mt-6">
              <div className="animate-spin rounded-full h-14 w-14 border-2 border-[#D8CECF] border-t-[#91738B]" />
              <p className="text-sm font-medium" style={{ color: '#5c4d60' }}>正在为您加速推荐</p>
            </div>
          </div>
        ) : (
          <>
            {/* Album Art - 双击展开/隐藏下方 tag */}
            <div
              className="mb-8 cursor-pointer select-none"
              onDoubleClick={() => setShowTags((s) => !s)}
              title={showTags ? '双击隐藏标签' : '双击显示标签'}
            >
              {currentTrack.image ? (
                <img
                  src={currentTrack.image}
                  alt={currentTrack.album_name}
                  className="w-80 h-80 rounded-2xl shadow-2xl object-cover object-center"
                />
              ) : (
                <div className="w-80 h-80 rounded-2xl shadow-2xl bg-gray-300 flex items-center justify-center">
                  <span className="text-gray-500 text-xl">无封面</span>
                </div>
              )}
            </div>

            {/* Song Info */}
            <div className="text-center mb-6">
              <h2 className="text-3xl font-bold text-gray-800 mb-2">{currentTrack.name}</h2>
              <p className="text-xl text-gray-600 mb-4">
                {currentTrack.artist_name}
                {currentTrack.releasedate && (
                  <span className="text-lg text-gray-500 ml-2">
                    ({currentTrack.releasedate.split('-')[0] || currentTrack.releasedate})
                  </span>
                )}
              </p>
        
              {/* Tags - 默认隐藏，双击封面展开/隐藏 */}
              {showTags && (
              <div className="flex flex-col items-center gap-3 mt-4 max-w-2xl">
                <p className="text-xs text-gray-500 font-mono">track_id: {currentTrack.id}</p>
                {currentTrack.tags && (
              <>
                {/* 风格：去重后展示 */}
                {currentTrack.tags.genres.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="text-xs text-gray-500 shrink-0">风格</span>
                    {[...new Set(currentTrack.tags.genres)].slice(0, 5).map((genre, idx) => (
                      <span
                        key={`genre-${genre}-${idx}`}
                        className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                )}
                {/* 乐器：去重后展示 */}
                {currentTrack.tags.instruments.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="text-xs text-gray-500 shrink-0">乐器</span>
                    {[...new Set(currentTrack.tags.instruments)].slice(0, 5).map((instrument, idx) => (
                      <span
                        key={`instrument-${instrument}-${idx}`}
                        className="px-3 py-1 text-gray-700 rounded-full text-sm font-normal"
                        style={{ backgroundColor: '#D8CECF' }}
                      >
                        {instrument}
                      </span>
                    ))}
                  </div>
                )}
                {/* 情绪/主题：合并为一类，去重后展示（同一标签不写两遍） */}
                {(() => {
                  const moodsThemes = [...new Set([...(currentTrack.tags.moods || []), ...(currentTrack.tags.themes || [])])];
                  if (moodsThemes.length === 0) return null;
                  return (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <span className="text-xs text-gray-500 shrink-0">情绪/主题</span>
                      {moodsThemes.slice(0, 5).map((tag, idx) => (
                        <span
                          key={`mood-theme-${tag}-${idx}`}
                          className="px-3 py-1 text-white rounded-full text-sm font-normal"
                          style={{ backgroundColor: '#91738B' }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </>
                )}
              </div>
            )}
            </div>
          </>
        )}
      </div>

      {/* Progress Bar with Play Button */}
      <div className="w-full max-w-2xl mb-6 relative">
        {/* 进度条气泡：非评分触发的（推荐理由、快速切换、多样性）仍显示在进度条上方 */}
        {currentSystem === 'B' && !isAssistantVisible && bubbleQueue.length > 0 && bubbleQueueIndex < bubbleQueue.length && (() => {
          const item = bubbleQueue[bubbleQueueIndex];
          const isRatingTriggered = item.type === 'ratingFeedback' || item.type === 'oneMinute' || item.type === 'ninetyFive';
          if (isRatingTriggered) return null; // 评分触发的气泡改在评分下方渲染
          const baseStyle: React.CSSProperties = {
            background: 'linear-gradient(135deg, #D8CECF 0%, #91738B 100%)',
            maxWidth: '100%',
            whiteSpace: 'normal',
          };
          const withGlow = item.type === 'quickSkip' || item.type === 'diversity';
          return (
            <div
              key={item.key}
              className={`recommendation-tip absolute bottom-full left-0 mb-2 px-3 py-2 text-white text-xs rounded-lg shadow-lg z-50 break-words w-fit max-w-full min-w-0 ${item.onClick ? 'cursor-pointer' : ''} ${withGlow ? 'animate-recommendation-glow' : ''}`}
              style={baseStyle}
              onClick={item.onClick}
            >
              {(item.showCloseButton && item.onClose) ? (
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <StreamingText
                      text={item.text}
                      onComplete={() => {
                        setTimeout(() => {
                          setBubbleQueueIndex((i) => (i + 1 < bubbleQueueLengthRef.current ? i + 1 : i));
                        }, 3000);
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      item.onClose?.();
                      if (item.onClick) item.onClick();
                    }}
                    className="text-white/80 hover:text-white transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <>
                  <StreamingText
                    text={item.text}
                    onComplete={() => {
                      if (item.type === 'recommendation') setRecommendationTipSuffix('点击和我聊聊吧~');
                      setTimeout(() => {
                        setBubbleQueueIndex((i) => (i + 1 < bubbleQueueLengthRef.current ? i + 1 : i));
                      }, 3000);
                    }}
                  />
                  {item.type === 'recommendation' && recommendationTipSuffix && <span className="block mt-1">{recommendationTipSuffix}</span>}
                </>
              )}
            </div>
          );
        })()}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handlePlayPause}
            disabled={loading}
            className="w-8 h-8 bg-transparent text-gray-700 flex items-center justify-center hover:bg-transparent disabled:opacity-50 transition-colors flex-shrink-0 rounded-full border-none outline-none focus:outline-none focus:ring-0"
            style={{ border: 'none', boxShadow: 'none' }}
          >
            {isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
              </svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={progress}
            onChange={handleSeek}
            disabled={loading || !currentTrack || totalDuration <= 0}
            className="progress-bar-range flex-1 min-h-0 rounded-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
            style={{ ['--progress-percent' as string]: `${progress}%` }}
          />
          <div 
            className="relative flex items-center"
            onMouseEnter={() => setShowVolumeSlider(true)}
            onMouseLeave={(e) => {
              // 检查鼠标是否移动到滑块上
              const relatedTarget = e.relatedTarget as HTMLElement;
              if (relatedTarget) {
                // 如果鼠标移动到滑块容器或其子元素上，保持显示
                if (relatedTarget.closest('.volume-slider-container')) {
                  return;
                }
              }
              setShowVolumeSlider(false);
            }}
          >
            <button
              onClick={handleVolumeToggle}
              className="w-8 h-8 bg-transparent text-gray-700 flex items-center justify-center hover:bg-transparent disabled:opacity-50 transition-colors flex-shrink-0 rounded-full border-none outline-none focus:outline-none focus:ring-0"
              style={{ border: 'none', boxShadow: 'none' }}
            >
              {isMuted || volume === 0 ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.793L4.383 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.383l4-3.617a1 1 0 011.617.793zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                </svg>
              ) : volume < 0.5 ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.793L4.383 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.383l4-3.617a1 1 0 011.617.793zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.793L4.383 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.383l4-3.617a1 1 0 011.617.793zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            {showVolumeSlider && (
              <div 
                className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 flex flex-col items-center volume-slider-container pointer-events-auto"
                onMouseEnter={() => setShowVolumeSlider(true)}
                onMouseLeave={(e) => {
                  // 检查鼠标是否移动到音量按钮上
                  const relatedTarget = e.relatedTarget as HTMLElement;
                  if (relatedTarget) {
                    // 如果鼠标移动到音量按钮容器上，保持显示
                    if (relatedTarget.closest('[class*="relative"]') && relatedTarget.closest('[class*="flex"]')) {
                      return;
                    }
                  }
                  setShowVolumeSlider(false);
                }}
                style={{ position: 'absolute', zIndex: 1000 }}
              >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="volume-slider-vertical"
                  style={{
                    background: `linear-gradient(to right, black 0%, black ${(isMuted ? 0 : volume) * 100}%, #9ca3af ${(isMuted ? 0 : volume) * 100}%, #9ca3af 100%)`,
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              </div>
            )}
          </div>
        </div>
        {/* Time Display */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <div className="w-8"></div>
          <div className="flex-1 flex items-center justify-between">
            <span className="text-sm text-gray-600">{formatTime(currentTime)}</span>
            <span className="text-sm text-gray-600">{formatTime(totalDuration)}</span>
          </div>
          <div className="w-8"></div>
        </div>
      </div>

      {/* Audio Element */}
      <audio
        ref={audioRef}
        src={currentTrack.audio}
        onEnded={handleNext}
        preload="metadata"
      />

      {/* Actions */}
      <div className="flex flex-row items-center justify-center gap-6 w-full max-w-2xl flex-wrap">
        {/* Favorite Button */}
        <button
          onClick={handleFavorite}
          className="px-3 py-1.5 rounded-lg bg-white text-gray-700 hover:bg-gray-50 text-sm transition-all"
        >
          <span className="flex items-center gap-1.5">
            {isFavorited ? (
              <>
                <svg className="w-4 h-4" fill="black" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                </svg>
                已收藏
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                收藏
              </>
            )}
          </span>
        </button>

        {/* Rating */}
        <div ref={ratingRef} className="flex items-center gap-1.5 relative">
          <span className="text-sm text-gray-700">评分：</span>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => handleRating(star)}
              className={`transition-all ${
                star <= currentRating
                  ? 'text-orange-500'
                  : 'text-gray-300'
              } hover:scale-110`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            </button>
          ))}
          {/* 评分提示气泡 - 系统 A/B 未评分点下一首时均显示 */}
          {showRatingTip && (
            <div className="absolute top-full left-0 mt-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg shadow-lg z-50 animate-pulse min-w-[8rem]">
              必须先给当前歌曲评分才能推荐下一首哦
              <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-800 transform rotate-45"></div>
            </div>
          )}
        </div>

        {/* Next Song Button */}
        <button
          onClick={handleNext}
          disabled={!currentTrack}
          className="px-3 py-1.5 rounded-lg bg-white text-gray-700 hover:bg-gray-50 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed relative z-10"
        >
          推荐下一首&gt;
        </button>
      </div>

      {/* 评分触发的气泡：显示在评分下方 */}
      {currentSystem === 'B' && !isAssistantVisible && bubbleQueue.length > 0 && bubbleQueueIndex < bubbleQueue.length && (() => {
        const item = bubbleQueue[bubbleQueueIndex];
        const isRatingTriggered = item.type === 'ratingFeedback' || item.type === 'oneMinute' || item.type === 'ninetyFive';
        if (!isRatingTriggered) return null;
        const baseStyle: React.CSSProperties = {
          background: 'linear-gradient(135deg, #D8CECF 0%, #91738B 100%)',
          maxWidth: '100%',
          whiteSpace: 'normal',
        };
        return (
          <div className="w-full max-w-2xl mt-3 flex justify-center">
            <div
              key={item.key}
              className={`recommendation-tip px-3 py-2 text-white text-xs rounded-lg shadow-lg z-50 break-words w-full max-w-full min-w-0 ${item.onClick ? 'cursor-pointer' : ''}`}
              style={baseStyle}
              onClick={item.onClick}
            >
              <StreamingText
                text={item.text}
                onComplete={() => {
                  setTimeout(() => {
                    setBubbleQueueIndex((i) => (i + 1 < bubbleQueueLengthRef.current ? i + 1 : i));
                  }, 3000);
                }}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
