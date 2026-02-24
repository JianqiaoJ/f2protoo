import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerStore } from '../store';
import { JamendoTrack } from '../types';
import { logListeningBehavior } from '../api/behavior';
import { logBubbleShow, logBubbleClick } from '../api/bubbleLog';
import { getCurrentUser, getUserStorageKey } from '../utils/storage';
import { ChatMessage, aiAssistantApi } from '../api/aiAssistant';
import { getDiversityRecommendation } from '../api/diversity';
import { getRecommendations } from '../api/recommend';
import { setPlaylist } from '../api/playlist';
import { jamendoApi } from '../api';
import { appendSystemLog } from '../api/logs';
import { getRecommendWhy } from '../api/recommend';
import { tagWithChinese } from '../utils/tagToChinese';
import { TextWithBoldTags } from './TextWithBoldTags';
import SystemEyesModal from './SystemEyesModal';

/** 多样性推荐触发：连续听满 6 首歌后触发（不要求每首播放时长） */
const DIVERSITY_TRIGGER_AFTER_SONGS = 6;

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
  return <TextWithBoldTags text={text.slice(0, visibleLength)} as="span" />;
}

export default function MusicPlayer({ isAssistantVisible = false, onToggleAssistant }: MusicPlayerProps) {
  const {
    currentTrack,
    isPlaying,
    setIsPlaying,
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
    incrementConsecutivePlayCount,
    resetConsecutivePlayCount,
    recommendedTrackIds,
    recommendedTrackIndex,
    currentSystem,
    setLoading,
    setRecommendedTrackIds,
    setRecommendedTrackIndex,
    syncLastRecommendationVersion,
    weightPlusOneQueue,
    pushWeightPlusOneMessages,
    shiftWeightPlusOneQueue,
    addUserPreference,
    removeUserPreferenceBatch,
    addFavoriteArtistAndAlbum,
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
  const [ratingRejectTip, setRatingRejectTip] = useState<string | null>(null); // 评分气泡点「说的不对」后短暂文案
  const lastRatingForFeedbackRef = useRef<{ trackId: string; rating: number } | null>(null); // 记录上次触发反馈的评分
  const [oneMinuteFeedbackTip, setOneMinuteFeedbackTip] = useState<{ text: string; trackId: string } | null>(null); // 1分钟反馈气泡
  const hasTriggeredOneMinuteFeedbackRef = useRef<{ trackId: string } | null>(null); // 记录是否已触发1分钟反馈
  const oneMinuteRequestInProgressRef = useRef(false); // 防止 1 分钟反馈请求未返回时 effect 再次触发导致重复加载
  const oneMinuteTipSetForTrackIdRef = useRef<string | null>(null); // 已设置过 1 分钟气泡的 trackId，避免多次 setTip 导致气泡反复加载
  const lastCurrentTimeForOneMinuteRef = useRef(0); // 上一帧的 currentTime，用于仅在「从 <60s 跨到 ≥60s」时触发一次
  const [ninetyFivePercentTip, setNinetyFivePercentTip] = useState<{ text: string; trackId: string } | null>(null); // 95%进度反馈气泡
  const hasTriggeredNinetyFivePercentRef = useRef<{ trackId: string } | null>(null); // 记录是否已触发95%反馈
  const lastProgressFor95Ref = useRef<number>(-1); // 用于仅在实际跨越 95% 时触发，避免切歌后残留 progress 或首帧误触发
  const hasAddedConfirmMessageForTrackRef = useRef<string | null>(null); // 同一首歌只加一条「确认」类消息，避免连续多条让用户确认
  const [quickSkipTip, setQuickSkipTip] = useState<string | null>(null); // 快速切换提示气泡
  const quickSkipCountRef = useRef<number>(0); // 记录连续快速切换的次数
  const consecutiveLowRatingCountRef = useRef<number>(0); // 记录连续评分 ≤2 星的数量（满 3 触发不满意气泡）
  const hasTriggeredQuickSkipTipRef = useRef<boolean>(false); // 记录是否已触发快速切换提示
  const [diversityTip, setDiversityTip] = useState<string | null>(null); // 多样性推荐提示气泡
  const [diversityChoiceHandlers, setDiversityChoiceHandlers] = useState<{ onFamiliar: () => void; onExplore: () => void } | null>(null); // 多样性气泡的两个选项回调
  const [quickSkipChoiceHandlers, setQuickSkipChoiceHandlers] = useState<{ onFamiliar: () => void; onExplore: () => void } | null>(null); // 「你似乎对推荐都不太满意」气泡的两个选项回调
  const [favoriteTip, setFavoriteTip] = useState<string | null>(null); // 收藏后弹出的黄色气泡文案（风格部分）
  /** 权重+1 提示在进度条气泡上方展示：当前条 1 秒后向上渐隐，再展示下一条 */
  const [weightTipExiting, setWeightTipExiting] = useState(false);
  const weightTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSystemEyesModal, setShowSystemEyesModal] = useState(false); // 我的偏好图 / 系统眼中的你 弹窗
  const hasTriggeredDiversityRef = useRef<boolean>(false); // 记录是否已触发多样性推荐
  const loadRandomTrackInProgressRef = useRef<boolean>(false); // 推荐下一首请求进行中时，仍可从待播列表播下一首
  const bubbleQueueFirstKeyRef = useRef<string | null>(null); // 用于队列首项变化时重置下标
  /** 仅当本次切歌来自「推荐下一首」时显示推荐气泡，避免其它切歌方式（如双击待播）也弹出 */
  const showRecommendationBubbleForNextTrackRef = useRef(false);
  /** 每首歌每类气泡只弹出一次：记录当前 track 下已展示过的气泡类型，切歌时重置 */
  const bubblesShownForTrackRef = useRef<{ trackId: string; recommendation: boolean; whyThisTrack: boolean; ratingFeedback: boolean; oneMinute: boolean }>({ trackId: '', recommendation: false, whyThisTrack: false, ratingFeedback: false, oneMinute: false });
  /** 已为当前 track 调度过推荐气泡的 10s/3s 定时器，避免同首歌多次调度导致气泡重复弹 */
  const hasScheduledRecommendationForTrackIdRef = useRef<string | null>(null);
  const [volume, setVolume] = useState(1); // 音量，范围 0-1
  const [isMuted, setIsMuted] = useState(false); // 是否静音
  const [showVolumeSlider, setShowVolumeSlider] = useState(false); // 是否显示音量滑块
  const [showTags, setShowTags] = useState(false); // 歌曲下方 tag 默认隐藏，双击封面切换
  const playStartTimeRef = useRef<number>(0); // 记录开始播放的时间
  const lastTrackIdRef = useRef<string>(''); // 记录上一首歌曲ID
  const lastTrackRef = useRef<JamendoTrack | null>(null); // 记录上一首歌曲的完整信息
  const { setCurrentTime: setStoreCurrentTime } = usePlayerStore();

  // 进度条气泡有序队列：同一时间只展示一个，当前气泡流式完成后再展示下一个；评分气泡也显示在进度条上方，排队等待
  type BubbleItem = { key: string; text: string; type: 'recommendation' | 'whyThisTrack' | 'ratingFeedback' | 'oneMinute' | 'ninetyFive' | 'quickSkip' | 'diversity'; onClick?: () => void; onClose?: () => void; showCloseButton?: boolean; diversityChoice?: { onFamiliar: () => void; onExplore: () => void }; quickSkipChoice?: { onFamiliar: () => void; onExplore: () => void }; ratingChoice?: { onConfirm: () => void; onReject: () => void } };
  const [bubbleQueueIndex, setBubbleQueueIndex] = useState(0); // 当前展示的气泡在队列中的下标
  const bubbleQueue = useMemo((): BubbleItem[] => {
    const list: BubbleItem[] = [];
    // 快速切换 / 多样性气泡（含按钮）优先队首，保证「你似乎对推荐都不太满意」等带按钮的气泡立即弹出
    if (quickSkipTip) list.push({ key: 'quickSkip', text: quickSkipTip, type: 'quickSkip', onClick: onToggleAssistant, onClose: () => { setQuickSkipTip(null); setQuickSkipChoiceHandlers(null); }, showCloseButton: true, quickSkipChoice: quickSkipChoiceHandlers ?? undefined });
    if (diversityTip) list.push({ key: 'diversity', text: diversityTip, type: 'diversity', onClick: onToggleAssistant, onClose: () => { setDiversityTip(null); setDiversityChoiceHandlers(null); }, showCloseButton: true, diversityChoice: diversityChoiceHandlers ?? undefined });
    if (recommendationTip) list.push({ key: 'recommendation', text: recommendationTip, type: 'recommendation', onClick: onToggleAssistant });
    if (whyThisTrackTip) list.push({ key: 'whyThisTrack', text: whyThisTrackTip, type: 'whyThisTrack', onClick: onToggleAssistant });
    if (ratingFeedbackTip) {
      const tip = ratingFeedbackTip;
      list.push({
        key: 'ratingFeedback',
        text: tip.text,
        type: 'ratingFeedback',
        onClick: onToggleAssistant,
        onClose: () => { setRatingFeedbackTip(null); },
        showCloseButton: true,
        ratingChoice: {
          onConfirm: () => {
            setRatingFeedbackTip(null);
            if (!currentTrack || !currentTrack.tags || tip.trackId !== currentTrack.id) return;
            if (tip.rating === 3) return; // 3 星普通评分：不增加也不调整权重
            const isLowRating = tip.rating <= 2; // 用评分区分，避免文案含「不」误判为低分
            const tagsToUpdate = {
              genres: currentTrack.tags.genres || [],
              instruments: currentTrack.tags.instruments || [],
              moods: currentTrack.tags.moods || [],
              themes: currentTrack.tags.themes || [],
            };
            if (isLowRating) {
              const removals: { type: 'genres' | 'instruments' | 'moods' | 'themes'; items: string[] }[] = [];
              if (tagsToUpdate.genres.length > 0) removals.push({ type: 'genres', items: tagsToUpdate.genres });
              if (tagsToUpdate.instruments.length > 0) removals.push({ type: 'instruments', items: tagsToUpdate.instruments });
              if (tagsToUpdate.moods.length > 0) removals.push({ type: 'moods', items: tagsToUpdate.moods });
              if (tagsToUpdate.themes.length > 0) removals.push({ type: 'themes', items: tagsToUpdate.themes });
              if (removals.length > 0) removeUserPreferenceBatch(removals, { operation: 'dislike_remove', conversationContent: '评分反馈：不喜欢' }).catch(() => {});
              const allTagsLow = [...(tagsToUpdate.genres || []), ...(tagsToUpdate.instruments || []), ...(tagsToUpdate.moods || []), ...(tagsToUpdate.themes || [])];
              if (allTagsLow.length > 0) setTimeout(() => pushWeightPlusOneMessages(allTagsLow.map((t) => `${tagWithChinese(t)}权重-1`)), 3000);
            } else {
              const ratingOpt = { operation: 'rating_confirm' as const };
              for (let i = 0; i < 2; i++) {
                if (tagsToUpdate.genres.length > 0) addUserPreference('genres', tagsToUpdate.genres, ratingOpt).catch(() => {});
                if (tagsToUpdate.instruments.length > 0) addUserPreference('instruments', tagsToUpdate.instruments, ratingOpt).catch(() => {});
                if (tagsToUpdate.moods.length > 0) addUserPreference('moods', tagsToUpdate.moods, ratingOpt).catch(() => {});
                if (tagsToUpdate.themes.length > 0) addUserPreference('themes', tagsToUpdate.themes, ratingOpt).catch(() => {});
              }
              const allTags = [...(tagsToUpdate.genres || []), ...(tagsToUpdate.instruments || []), ...(tagsToUpdate.moods || []), ...(tagsToUpdate.themes || [])];
              setTimeout(() => pushWeightPlusOneMessages(allTags.map((t) => `${tagWithChinese(t)}权重+1`)), 3000);
            }
          },
          onReject: () => {
            setRatingFeedbackTip(null);
            setRatingRejectTip('好的，我不会据此修改您的偏好。');
            setTimeout(() => setRatingRejectTip(null), 2500);
          },
        },
      });
    }
    if (oneMinuteFeedbackTip) list.push({ key: 'oneMinute', text: oneMinuteFeedbackTip.text, type: 'oneMinute', onClick: onToggleAssistant });
    if (ninetyFivePercentTip) list.push({ key: 'ninetyFive', text: ninetyFivePercentTip.text, type: 'ninetyFive', onClick: onToggleAssistant });
    return list;
  }, [recommendationTip, whyThisTrackTip, ratingFeedbackTip, oneMinuteFeedbackTip, ninetyFivePercentTip, quickSkipTip, quickSkipChoiceHandlers, diversityTip, diversityChoiceHandlers, onToggleAssistant, currentTrack, addUserPreference, removeUserPreferenceBatch, pushWeightPlusOneMessages]);

  const bubbleQueueLengthRef = useRef(0);
  bubbleQueueLengthRef.current = bubbleQueue.length;
  const currentBubbleLogIdRef = useRef<number | null>(null);
  const lastLoggedBubbleRef = useRef<{ index: number; key: string; content: string } | null>(null);

  // 气泡展示记录：当前展示的气泡变化时写入「展示时间、类型、内容」，并记录 log_id 供点击时更新
  useEffect(() => {
    const item = bubbleQueue[bubbleQueueIndex];
    if (!item) return;
    const same =
      lastLoggedBubbleRef.current &&
      lastLoggedBubbleRef.current.index === bubbleQueueIndex &&
      lastLoggedBubbleRef.current.key === item.key &&
      lastLoggedBubbleRef.current.content === item.text;
    if (same) return;
    lastLoggedBubbleRef.current = { index: bubbleQueueIndex, key: item.key, content: item.text };
    const username = getCurrentUser();
    if (!username) return;
    logBubbleShow({
      username,
      bubble_type: item.type,
      content: item.text,
    }).then((logId) => {
      currentBubbleLogIdRef.current = logId;
    });
  }, [bubbleQueueIndex, bubbleQueue]);

  useEffect(() => {
    const firstKey = bubbleQueue[0]?.key ?? null;
    if (bubbleQueueFirstKeyRef.current !== firstKey) {
      bubbleQueueFirstKeyRef.current = firstKey;
      setBubbleQueueIndex(0);
    }
  }, [bubbleQueue]);

  /** 按类型清除对应气泡状态，使队列更新、下一个气泡成为队首 */
  const clearBubbleTipByType = (type: BubbleItem['type']) => {
    switch (type) {
      case 'recommendation':
        setRecommendationTip(null);
        setRecommendationTipSuffix(null);
        break;
      case 'whyThisTrack':
        setWhyThisTrackTip(null);
        break;
      case 'ratingFeedback':
        setRatingFeedbackTip(null);
        break;
      case 'oneMinute':
        setOneMinuteFeedbackTip(null);
        break;
      case 'ninetyFive':
        setNinetyFivePercentTip(null);
        break;
      case 'quickSkip':
        setQuickSkipTip(null);
        setQuickSkipChoiceHandlers(null);
        break;
      case 'diversity':
        setDiversityTip(null);
        setDiversityChoiceHandlers(null);
        break;
    }
  };

  // 当前气泡展示一定时间后清除并显示下一个；评分反馈 10 秒，其余 5 秒
  const currentBubbleKey = bubbleQueue[bubbleQueueIndex]?.key ?? null;
  useEffect(() => {
    if (!currentBubbleKey) return;
    const durationMs = currentBubbleKey === 'ratingFeedback' ? 10000 : 5000;
    const t = setTimeout(() => {
      clearBubbleTipByType(currentBubbleKey as BubbleItem['type']);
      setBubbleQueueIndex(0);
    }, durationMs);
    return () => clearTimeout(t);
  }, [bubbleQueueIndex, currentBubbleKey]);

  const isFavorited = currentTrack ? favorites.some(f => f.id === currentTrack.id) : false;
  const currentRating = currentTrack ? getRating(currentTrack.id) : 0;

  // 权重+1 队列：每条仅展示 1 秒，无常驻；1s 后渐隐约 0.3s，1.3s 时强制 shift（不依赖 transitionEnd，避免最后一条不消失）
  const currentWeightTipText = weightPlusOneQueue[0] ?? null;
  const weightTipShiftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 队列为空时清除状态和定时器
  useEffect(() => {
    if (weightPlusOneQueue.length > 0) return;
    setWeightTipExiting(false);
    if (weightTipShiftTimerRef.current) {
      clearTimeout(weightTipShiftTimerRef.current);
      weightTipShiftTimerRef.current = null;
    }
    if (weightTipTimerRef.current) {
      clearTimeout(weightTipTimerRef.current);
      weightTipTimerRef.current = null;
    }
  }, [weightPlusOneQueue.length]);

  useEffect(() => {
    if (!currentWeightTipText || weightTipExiting) return;
    if (weightTipTimerRef.current) clearTimeout(weightTipTimerRef.current);
    if (weightTipShiftTimerRef.current) clearTimeout(weightTipShiftTimerRef.current);
    // 1s 后进入渐隐
    weightTipTimerRef.current = setTimeout(() => {
      weightTipTimerRef.current = null;
      setWeightTipExiting(true);
    }, 1000);
    // 1.3s 时强制 shift，不依赖 transitionEnd，保证最后一条也会消失
    weightTipShiftTimerRef.current = setTimeout(() => {
      weightTipShiftTimerRef.current = null;
      shiftWeightPlusOneQueue();
      setWeightTipExiting(false);
    }, 1300);
    return () => {
      if (weightTipTimerRef.current) clearTimeout(weightTipTimerRef.current);
      // 不清 weightTipShiftTimerRef：effect 因 weightTipExiting 重跑时会触发 cleanup，若也清掉 1.3s 定时器则 shift 永远不会执行，消息会卡住不消失、后续条目不出现
    };
  }, [currentWeightTipText, weightTipExiting]);

  useEffect(() => () => {
    if (weightTipTimerRef.current) clearTimeout(weightTipTimerRef.current);
    if (weightTipShiftTimerRef.current) clearTimeout(weightTipShiftTimerRef.current);
  }, []);

  // 当歌曲切换时，清除各类气泡与 per-track 状态，并重置「每首歌每类气泡只弹一次」的 ref
  useEffect(() => {
    if (currentTrack) {
      setRecommendationTip(null);
      setRecommendationTipSuffix(null);
      setWhyThisTrackTip(null);
      setRatingFeedbackTip(null);
      setRatingRejectTip(null);
      setOneMinuteFeedbackTip(null);
      setNinetyFivePercentTip(null);
      setDiversityTip(null);
      if (weightTipTimerRef.current) {
        clearTimeout(weightTipTimerRef.current);
        weightTipTimerRef.current = null;
      }
      lastRatingForFeedbackRef.current = null;
      hasTriggeredOneMinuteFeedbackRef.current = null;
      oneMinuteRequestInProgressRef.current = false;
      oneMinuteTipSetForTrackIdRef.current = null;
      lastCurrentTimeForOneMinuteRef.current = 0;
      hasTriggeredNinetyFivePercentRef.current = null;
      lastProgressFor95Ref.current = -1;
      hasAddedConfirmMessageForTrackRef.current = null; // 新歌允许一条确认消息
      hasRequestedWhyThisTrackForTrackIdRef.current = null; // 新歌允许展示一次「这首歌的感觉」
      hasScheduledRecommendationForTrackIdRef.current = null;
      bubblesShownForTrackRef.current = { trackId: currentTrack.id, recommendation: false, whyThisTrack: false, ratingFeedback: false, oneMinute: false };
      
      // 快速切换计数器：不在此处重置，在 handleNext 里当播放时长 ≥20 秒时重置
      
      // 注意：不重置 hasTriggeredDiversityRef，触发后需等待下次连续听满 DIVERSITY_TRIGGER_AFTER_SONGS 首再触发
    }
  }, [currentTrack?.id]);

  // 气泡不受 Seren 是否收起影响，均正常弹出（不再在 Seren 打开时清除）

  // 监听播放时长，仅在「从 <60s 跨到 ≥60s」时触发一次反馈（听满 1 分钟节点，同一首歌只触发一次）
  useEffect(() => {
    if (!currentTrack || !isPlaying) {
      return;
    }
    const timeSec = Math.floor(currentTime);
    const prevTime = lastCurrentTimeForOneMinuteRef.current;

    // 切歌后 currentTime 可能尚未重置，仍为上一首的时长，导致误在“10秒”等时刻触发。若 ref 刚被清 0 而 currentTime 已≥60，视为上一首的残留，只更新 ref 不触发
    if (prevTime === 0 && currentTime >= 60) {
      lastCurrentTimeForOneMinuteRef.current = currentTime;
      return;
    }
    lastCurrentTimeForOneMinuteRef.current = currentTime;

    // 仅在跨越 60 秒时触发（用整数秒避免浮点导致多次进入）
    if (prevTime >= 60 || timeSec < 60) {
      return;
    }

    // 每首歌只触发一次
    if (hasTriggeredOneMinuteFeedbackRef.current?.trackId === currentTrack.id) {
      return;
    }
    if (oneMinuteRequestInProgressRef.current) {
      return;
    }
    if (hasAddedConfirmMessageForTrackRef.current === currentTrack.id) {
      return;
    }

    hasTriggeredOneMinuteFeedbackRef.current = { trackId: currentTrack.id };
    oneMinuteRequestInProgressRef.current = true;
    const trackIdForRequest = currentTrack.id;

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
          // 无论 Seren 是否展开都弹出气泡；同一 track 只 set 一次
          if (bubblesShownForTrackRef.current.trackId === trackIdForRequest && bubblesShownForTrackRef.current.oneMinute) return;
          if (oneMinuteTipSetForTrackIdRef.current === trackIdForRequest) return;
          oneMinuteTipSetForTrackIdRef.current = trackIdForRequest;
          bubblesShownForTrackRef.current = { ...bubblesShownForTrackRef.current, trackId: trackIdForRequest, oneMinute: true };
          setOneMinuteFeedbackTip({
            text: feedbackText,
            trackId: currentTrack.id,
          });
        }
      } catch (error) {
        console.error('生成1分钟反馈失败:', error);
      } finally {
        oneMinuteRequestInProgressRef.current = false;
      }
    };

    generateFeedback();
  }, [currentTime, currentTrack, isPlaying]);

  // 监听播放进度，仅在实际「跨越 95%」时触发反馈（与 1 分钟反馈的跨越逻辑一致），避免切歌后 progress 残留或首帧误触发
  useEffect(() => {
    if (!currentTrack || !isPlaying) return;
    // 必须用 progress（与音频元素同步）
    if (progress > 100) return; // 切歌后 progress 可能暂未重置，避免误触发
    if (progress < 95) {
      lastProgressFor95Ref.current = progress;
      return;
    }
    // 仅当本曲播放过程中从 <95% 跨到 ≥95% 时触发；若 lastProgressFor95Ref 为 -1 说明刚切歌尚未见过 <95，不触发
    if (lastProgressFor95Ref.current < 0 || lastProgressFor95Ref.current >= 95) {
      lastProgressFor95Ref.current = progress;
      return;
    }
    lastProgressFor95Ref.current = progress;

    if (hasTriggeredNinetyFivePercentRef.current?.trackId === currentTrack.id) return;
    if (hasAddedConfirmMessageForTrackRef.current === currentTrack.id) return;

    const userPrefs = getUserPreferences();
    const trackTags = currentTrack.tags || { genres: [], instruments: [], moods: [], themes: [] };
    const hasNewTags =
      (trackTags.genres.length > 0 && trackTags.genres.some((g: string) => !userPrefs.genres.includes(g))) ||
      (trackTags.instruments.length > 0 && trackTags.instruments.some((i: string) => !userPrefs.instruments.includes(i))) ||
      (trackTags.moods.length > 0 && trackTags.moods.some((m: string) => !userPrefs.moods.includes(m))) ||
      (trackTags.themes.length > 0 && trackTags.themes.some((t: string) => !userPrefs.themes.includes(t)));

    if (!hasNewTags) return;

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
          setNinetyFivePercentTip({
            text: feedbackText,
            trackId: currentTrack.id,
          });
        }
      } catch (error) {
        console.error('生成95%反馈失败:', error);
      }
    };

    generateFeedback();
  }, [progress, currentTrack, isPlaying, getUserPreferences]);

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
      // 播放中：待播列表剩余 ≤2 首（含下一首）时在列表下方补充新推荐
      const { recommendedTrackIds: ids, recommendedTrackIndex: idx, preloadNextRecommendationsIfNeeded } = usePlayerStore.getState();
      const remaining = ids.length - idx; // 剩余首数（含下一首）
      if (remaining <= 2 && ids.length > 0) {
        preloadNextRecommendationsIfNeeded();
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
      const doPlay = () => {
        audio.play().catch(err => {
          console.error('Play failed:', err?.name, err?.message);
          // NotAllowedError 多为浏览器自动播放策略：需用户先与页面交互（如点击播放按钮）后才能播
          if (err?.name === 'NotAllowedError') {
            console.warn('自动播放被浏览器拦截，请点击播放按钮开始播放');
          }
          usePlayerStore.getState().setIsPlaying(false);
        });
      };
      // 切歌后新 src 可能尚未加载完成，先等 canplay 再播，避免播不出来
      if (currentTrack && (audio.readyState < 2 || audio.networkState === 0)) {
        const onCanPlay = () => {
          audio.removeEventListener('canplay', onCanPlay);
          doPlay();
        };
        audio.addEventListener('canplay', onCanPlay);
        return () => audio.removeEventListener('canplay', onCanPlay);
      }
      doPlay();
    } else {
      audio.pause();
    }
  }, [isPlaying, currentTrack]);

  const handlePlayPause = () => {
    togglePlayPause();
  };

  // 生成推荐解释文本（「根据**为您推荐」气泡）：标签取用户偏好与歌曲标签的交集；交集过多取权重最高的前5个；无交集则**为这首歌的标签
  const generateRecommendationExplanation = (track: JamendoTrack | null, isDiversity: boolean): string | null => {
    if (!track || !track.tags) return null;

    const buildPartsFromTags = (): string[] => {
      const p: string[] = [];
      if (track!.tags!.genres?.length) p.push(`风格${track!.tags!.genres.map(tagWithChinese).join('、')}`);
      if (track!.tags!.instruments?.length) p.push(`器乐${track!.tags!.instruments.map(tagWithChinese).join('、')}`);
      const moodTheme = [...new Set([...(track!.tags!.moods || []), ...(track!.tags!.themes || [])])];
      if (moodTheme.length) p.push(`情绪·主题${moodTheme.map(tagWithChinese).join('、')}`);
      return p;
    };

    if (isDiversity) {
      const parts = buildPartsFromTags();
      if (parts.length === 0) return null;
      return `尝试一下${parts.join('、')}吧～`;
    }

    // 非多样性：气泡里的** = 用户偏好标签 ∩ 歌曲标签；过多则只取交集里用户偏好权重最高的前5个；无交集则** = 这首歌的标签
    const userPrefs = getUserPreferences();
    type TagWithMeta = { tag: string; category: 'genres' | 'instruments' | 'moods_themes'; weight: number };
    const intersection: TagWithMeta[] = [];
    const getWeight = (cat: TagWithMeta['category'], tag: string): number => {
      const w = cat === 'genres' ? userPrefs.genresWeights?.[tag]
        : cat === 'instruments' ? userPrefs.instrumentsWeights?.[tag]
        : (userPrefs.moodsWeights?.[tag] ?? userPrefs.themesWeights?.[tag]);
      return typeof w === 'number' ? w : 0;
    };
    if (track.tags.genres?.length && userPrefs.genres.length) {
      track.tags.genres.filter(g => userPrefs.genres.includes(g)).forEach(g => {
        intersection.push({ tag: g, category: 'genres', weight: getWeight('genres', g) });
      });
    }
    if (track.tags.instruments?.length && userPrefs.instruments.length) {
      track.tags.instruments.filter(i => userPrefs.instruments.includes(i)).forEach(i => {
        intersection.push({ tag: i, category: 'instruments', weight: getWeight('instruments', i) });
      });
    }
    const moodThemePrefs = [...(userPrefs.moods || []), ...(userPrefs.themes || [])];
    const moodThemeTrack = [...new Set([...(track.tags.moods || []), ...(track.tags.themes || [])])];
    if (moodThemeTrack.length && moodThemePrefs.length) {
      moodThemeTrack.filter(t => moodThemePrefs.includes(t)).forEach(t => {
        intersection.push({ tag: t, category: 'moods_themes', weight: getWeight('moods_themes', t) });
      });
    }

    if (intersection.length > 0) {
      // 交集数量过多时，只取用户偏好权重最高的前5个（最多）
      const top = [...intersection].sort((a, b) => b.weight - a.weight).slice(0, 5);
      const byCat = { genres: [] as string[], instruments: [] as string[], moods_themes: [] as string[] };
      top.forEach(({ tag, category }) => {
        if (!byCat[category].includes(tag)) byCat[category].push(tag);
      });
      const parts: string[] = [];
      if (byCat.genres.length) parts.push(`风格${byCat.genres.map(tagWithChinese).join('、')}`);
      if (byCat.instruments.length) parts.push(`器乐${byCat.instruments.map(tagWithChinese).join('、')}`);
      if (byCat.moods_themes.length) parts.push(`情绪·主题${byCat.moods_themes.map(tagWithChinese).join('、')}`);
      return `根据你喜欢的${parts.join('、')}为您推荐`;
    }

    // 没有交集：** 用这首歌的标签
    const parts = buildPartsFromTags();
    if (parts.length === 0) return null;
    return `根据这首歌的${parts.join('、')}为您推荐`;
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
  const hasRequestedWhyThisTrackForTrackIdRef = useRef<string | null>(null); // 同一首歌只请求并展示一次「这首歌的感觉」气泡
  
  // 分割线消息只在 AIAssistant 内根据 currentTrack 添加一次，此处不再重复添加
  
  // 监听 currentTrack.id 变化，生成推荐解释（仅当本次切歌来自「点击推荐下一首」时显示气泡）；依赖 id 而非 currentTrack 避免同首歌引用变化导致 effect 反复执行、清理 timeouts 使「这首歌的感觉」无法展示
  useEffect(() => {
    const currentTrack = usePlayerStore.getState().currentTrack;
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
      // 同一首歌只弹一次推荐气泡，防止重复
      if (bubblesShownForTrackRef.current.trackId === currentTrack.id && bubblesShownForTrackRef.current.recommendation) {
        previousTrackIdForExplanationRef.current = currentTrack.id;
        return;
      }
      // 同首歌已调度过 10s/3s 定时器则不再调度，避免气泡重复弹
      if (hasScheduledRecommendationForTrackIdRef.current === currentTrack.id) {
        previousTrackIdForExplanationRef.current = currentTrack.id;
        return;
      }
      const reason = usePlayerStore.getState().currentTrackRecommendReason;
      const isDiversity = reason === '多样性推荐';
      // 喜爱艺术家/专辑插队时使用预设推荐理由
      const isFavoriteArtistOrAlbumReason = reason && (reason.startsWith('你刚听了') || reason.startsWith('你刚刚听了'));
      const explanation = isFavoriteArtistOrAlbumReason ? reason : generateRecommendationExplanation(currentTrack, isDiversity);
      
      if (explanation) {
        setWhyThisTrackTip(null); // 新推荐时先清掉上一首的「感觉」气泡
        // 无论Seren是否展开，都保存到聊天框
        addMessageToChat(explanation);
        // 先标记已展示推荐气泡，再 setState，避免重入时再次设置
        bubblesShownForTrackRef.current = { ...bubblesShownForTrackRef.current, trackId: currentTrack.id, recommendation: true };
        setRecommendationTip(explanation);
        setRecommendationTipSuffix(null);
        setBubbleQueueIndex(0); // 切到新推荐时重置为队首，确保进度条上方显示本条解释弹框
        hasScheduledRecommendationForTrackIdRef.current = currentTrack.id;
        const timeouts: ReturnType<typeof setTimeout>[] = [];
        const trackForWhy = currentTrack;
        // 5 秒后关闭「根据…推荐」气泡，再在 3s 后请求「这首歌的感觉」并作为气泡展示（与进度条气泡常驻 5 秒一致）
        const t2 = setTimeout(() => {
          setRecommendationTip(null);
          setRecommendationTipSuffix(null);
          const t3 = setTimeout(async () => {
            const stillCurrent = usePlayerStore.getState().currentTrack?.id === trackForWhy.id;
            if (!stillCurrent) return;
            // 同一首歌只请求并展示一次，避免一首歌播放过程中气泡弹出多次
            if (hasRequestedWhyThisTrackForTrackIdRef.current === trackForWhy.id) return;
            if (bubblesShownForTrackRef.current.trackId === trackForWhy.id && bubblesShownForTrackRef.current.whyThisTrack) return;
            hasRequestedWhyThisTrackForTrackIdRef.current = trackForWhy.id;
            const username = getCurrentUser();
            if (!username) return;
            try {
              const whyData = await getRecommendWhy(username, trackForWhy.id, trackForWhy.tags);
              const text = whyData
                ? await aiAssistantApi.generateWhyThisTrackKeywords(whyData, trackForWhy.name, trackForWhy.artist_name)
                : await aiAssistantApi.generateWhyThisTrackFallbackKeywords(trackForWhy.name, trackForWhy.artist_name, trackForWhy.tags);
              if (usePlayerStore.getState().currentTrack?.id === trackForWhy.id) {
                if (bubblesShownForTrackRef.current.trackId === trackForWhy.id && bubblesShownForTrackRef.current.whyThisTrack) return;
                if (whyThisTrackClearRef.current) clearTimeout(whyThisTrackClearRef.current);
                bubblesShownForTrackRef.current = { ...bubblesShownForTrackRef.current, trackId: trackForWhy.id, whyThisTrack: true };
                setWhyThisTrackTip(text);
                whyThisTrackClearRef.current = setTimeout(() => {
                  setWhyThisTrackTip(null);
                  whyThisTrackClearRef.current = null;
                }, 5000);
              }
            } catch (e) {
              console.warn('获取「这首歌的感觉」气泡失败:', e);
              hasRequestedWhyThisTrackForTrackIdRef.current = null; // 失败则允许重试
            }
          }, 3000); // 推荐气泡消失后 3s
          timeouts.push(t3);
        }, 5000);
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
  }, [currentTrack?.id]);

  /** 显示「猜测用户对推荐不满意」气泡（连续跳过≥5 或 连续3首评分≤2星 时共用） */
  const showDissatisfactionBubble = () => {
    hasTriggeredQuickSkipTipRef.current = true;
    const tipMessage = '你似乎对推荐的歌曲都不太满意呢。来聊聊你的喜好，让我更好地为你推荐吧！';
    const showExploreResultTipForQuickSkip = async () => {
      const track = usePlayerStore.getState().currentTrack;
      if (!track) return;
      try {
        const intro = await aiAssistantApi.generateDiversityIntroduction({
          name: track.name,
          artist: track.artist_name,
          tags: track.tags,
        });
        setQuickSkipTip(null);
        setQuickSkipChoiceHandlers(null);
        setDiversityTip(`尝试一下新风格吧～\n\n${intro}`);
        setDiversityChoiceHandlers({
          onFamiliar: async () => {
            setDiversityTip(null);
            setDiversityChoiceHandlers(null);
            const ok = await usePlayerStore.getState().playNextFromList();
            if (ok) appendSystemLog('[推荐] 多样性选择「继续听我熟悉的风格」：继续播放待播列表');
          },
          onExplore: () => {
            setDiversityTip(null);
            setDiversityChoiceHandlers(null);
            usePlayerStore.getState().prependDiversityTrackAndPlay().then(() => {
              appendSystemLog('[推荐] 多样性选择「探索新领域」：已插入待播列表最前并播放');
              showExploreResultTipForQuickSkip();
            }).catch((e) => appendSystemLog(`[推荐] 探索新领域失败: ${e instanceof Error ? e.message : String(e)}`));
          },
        });
      } catch (_) {}
    };
    setQuickSkipTip(tipMessage);
    setQuickSkipChoiceHandlers({
      onFamiliar: async () => {
        setQuickSkipTip(null);
        setQuickSkipChoiceHandlers(null);
        const ok = await usePlayerStore.getState().playNextFromList();
        if (ok) appendSystemLog('[推荐] 快速切换选择「继续听我熟悉的风格」：继续播放待播列表');
      },
      onExplore: () => {
        setQuickSkipTip(null);
        setQuickSkipChoiceHandlers(null);
        usePlayerStore.getState().prependDiversityTrackAndPlay().then(() => {
          appendSystemLog('[推荐] 快速切换选择「探索新领域」：已插入待播列表最前并播放');
          showExploreResultTipForQuickSkip();
        }).catch((e) => {
          appendSystemLog(`[推荐] 探索新领域失败: ${e instanceof Error ? e.message : String(e)}`);
        });
      },
    });
    setTimeout(() => {
      setQuickSkipTip(null);
      setQuickSkipChoiceHandlers(null);
    }, 5000);
    if (isAssistantVisible) {
      const storageKey = getUserStorageKey('ai-assistant-messages');
      const stored = localStorage.getItem(storageKey);
      const messages = stored ? JSON.parse(stored) : [];
      const newMessage: ChatMessage = {
        role: 'assistant',
        content: tipMessage,
        fromSeren: true,
        buttons: [
          { label: '继续听我熟悉的风格', action: 'quick_skip_continue' },
          { label: '探索新领域', action: 'quick_skip_explore' },
        ],
      };
      messages.push(newMessage);
      localStorage.setItem(storageKey, JSON.stringify(messages));
      window.dispatchEvent(new Event('storage'));
    }
  };

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
    setIsPlaying(false);

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
      
      // 检查播放时长是否小于20秒（每首听不满20秒计为一次「跳过」）
      if (playDuration < 20) {
        // 增加快速切换计数器
        quickSkipCountRef.current += 1;
        console.log(`⚠️ 快速切换检测: 当前歌曲播放时长 ${playDuration}秒 < 20秒，连续跳过次数: ${quickSkipCountRef.current}`);
        
          // 连续跳过5首歌且每首听不满20秒，显示不满意气泡
          if (quickSkipCountRef.current >= 5 && !hasTriggeredQuickSkipTipRef.current) {
            appendSystemLog('[推荐] 触发不满意气泡（连续跳过≥5首且每首<20秒）');
            showDissatisfactionBubble();
          }
      } else {
        // 播放时长 >= 20秒，重置快速切换计数器与连续低分计数，允许下次再次触发不满意气泡
        if (quickSkipCountRef.current > 0 || consecutiveLowRatingCountRef.current > 0) {
          console.log(`✅ 播放时长 ${playDuration}秒 >= 20秒，重置快速切换/连续低分计数器`);
          quickSkipCountRef.current = 0;
          consecutiveLowRatingCountRef.current = 0;
          hasTriggeredQuickSkipTipRef.current = false;
        }
      }
      
      playStartTimeRef.current = 0;
    }

    // 每听完 1 首则增加连续听歌数，满 6 首触发多样性推荐（不要求每首播放时长）
    incrementConsecutivePlayCount();
    const countAfter = usePlayerStore.getState().consecutivePlayCount;
    const shouldTriggerDiversity = countAfter >= DIVERSITY_TRIGGER_AFTER_SONGS && !hasTriggeredDiversityRef.current;

    if (shouldTriggerDiversity) {
      hasTriggeredDiversityRef.current = true;
      resetConsecutivePlayCount();
      appendSystemLog(`[推荐] 触发多样性推荐（连续听满${DIVERSITY_TRIGGER_AFTER_SONGS}首歌）`);
      
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
              
              // 无论 Seren 是否展开都显示气泡（含「继续听我熟悉的风格」「探索新领域」两个选项）
              const showExploreResultTip = async () => {
                const track = usePlayerStore.getState().currentTrack;
                if (!track) return;
                try {
                  const intro = await aiAssistantApi.generateDiversityIntroduction({
                    name: track.name,
                    artist: track.artist_name,
                    tags: track.tags,
                  });
                  setDiversityTip(`尝试一下新风格吧～\n\n${intro}`);
                  setDiversityChoiceHandlers({
                    onFamiliar: async () => {
                      setDiversityTip(null);
                      setDiversityChoiceHandlers(null);
                      const ok = await usePlayerStore.getState().playNextFromList();
                      if (ok) appendSystemLog('[推荐] 多样性选择「继续听我熟悉的风格」：继续播放待播列表');
                    },
                    onExplore: () => {
                      setDiversityTip(null);
                      setDiversityChoiceHandlers(null);
                      usePlayerStore.getState().prependDiversityTrackAndPlay().then(() => {
                        appendSystemLog('[推荐] 多样性选择「探索新领域」：已插入待播列表最前并播放');
                        showExploreResultTip();
                      }).catch((e) => {
                        appendSystemLog(`[推荐] 探索新领域失败: ${e instanceof Error ? e.message : String(e)}`);
                      });
                    },
                  });
                } catch (_) {}
              };
              setDiversityTip(introduction);
              setDiversityChoiceHandlers({
                onFamiliar: async () => {
                  setDiversityTip(null);
                  setDiversityChoiceHandlers(null);
                  const ok = await usePlayerStore.getState().playNextFromList();
                  if (ok) appendSystemLog('[推荐] 多样性选择「继续听我熟悉的风格」：继续播放待播列表');
                },
                onExplore: () => {
                  setDiversityTip(null);
                  setDiversityChoiceHandlers(null);
                  usePlayerStore.getState().prependDiversityTrackAndPlay().then(() => {
                    appendSystemLog('[推荐] 多样性选择「探索新领域」：已插入待播列表最前并播放');
                    showExploreResultTip();
                  }).catch((e) => {
                    appendSystemLog(`[推荐] 探索新领域失败: ${e instanceof Error ? e.message : String(e)}`);
                  });
                },
              });
              setTimeout(() => {
                setDiversityTip(null);
                setDiversityChoiceHandlers(null);
              }, 5000);
              if (isAssistantVisible) {
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
                window.dispatchEvent(new Event('storage'));
              }

              // 加载多样性推荐歌曲
              appendSystemLog(`[推荐] 多样性推荐成功 - track_id: ${diversityTrack.id}《${diversityTrack.name}》`);
              const { setCurrentTrack, setIsPlaying } = usePlayerStore.getState();
              showRecommendationBubbleForNextTrackRef.current = true;
              setCurrentTrack(diversityTrack, '多样性推荐');
              setIsPlaying(true);
              hasTriggeredDiversityRef.current = false; // 允许下次连续听满 6 首再次触发
              return; // 直接返回，不继续执行loadRandomTrack
            }
          }
        } catch (error) {
          console.error('获取多样性推荐失败:', error);
          appendSystemLog(`[推荐] 获取多样性推荐失败: ${error instanceof Error ? error.message : String(error)}`);
        }
        hasTriggeredDiversityRef.current = false; // 失败时也允许下次再触发
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

  // 立刻发起一次新推荐请求填充待播列表（用户等急了可点刷新）
  const handleRefreshRecommendations = async () => {
    const username = getCurrentUser();
    if (!username) return;
    setLoading(true);
    appendSystemLog('[推荐] 点击刷新，正在重新拉取推荐…');
    try {
      const prefs = getUserPreferences();
      const { recommendedTracks: newIds, recommendedScores: newScores, firstTracks: newFirstTracks } = await getRecommendations({
        username,
        systemType: currentSystem,
        explicitPreferences: prefs,
        count: 10,
        trigger: 'user_request_rerecommend',
      });
      appendSystemLog(`[推荐] 刷新完成，共 ${newIds.length} 首`);
      if (newIds.length > 0) {
        setRecommendedTrackIds(newIds, newScores ?? undefined, newFirstTracks, '用户点击刷新');
        setRecommendedTrackIndex(0);
        setPlaylist(username, newIds, currentSystem).catch(() => {});
        syncLastRecommendationVersion();
      }
    } catch (e) {
      appendSystemLog(`[推荐] 刷新失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
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
        // 仅系统 B 收藏后弹出黄色气泡；系统 A 不弹
        if (currentSystem === 'B') {
          const genres = currentTrack.tags?.genres ?? [];
          const genresText = genres.length > 0 ? genres.slice(0, 3).map(tagWithChinese).join('、') : '';
          setFavoriteTip(genresText.length > 0 ? genresText : ' '); // 最多保留前 3 个标签；空串用空格表示无风格
          setTimeout(() => {
            setFavoriteTip(null);
            const tags = currentTrack.tags;
            const allTags = [
              ...(tags?.genres ?? []),
              ...(tags?.instruments ?? []),
              ...(tags?.moods ?? []),
              ...(tags?.themes ?? []),
            ];
            pushWeightPlusOneMessages(allTags.map((t) => `${tagWithChinese(t)}权重+1`));
          }, 8000);
        }
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
      if (newRating === 5) addFavoriteArtistAndAlbum(currentTrack);
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

      // 评分为 ≤2 或 ≥4 时生成反馈；同一首歌只弹一次，先做守卫再请求
      if (newRating > 2 && newRating < 4) return;
      if (bubblesShownForTrackRef.current.trackId === currentTrack.id && bubblesShownForTrackRef.current.ratingFeedback) return;
      if (hasAddedConfirmMessageForTrackRef.current === currentTrack.id) return;
      lastRatingForFeedbackRef.current = { trackId: currentTrack.id, rating: newRating };
      bubblesShownForTrackRef.current = { ...bubblesShownForTrackRef.current, trackId: currentTrack.id, ratingFeedback: true };
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
            setRatingFeedbackTip({
              text: feedbackText,
              rating: newRating,
              trackId: currentTrack.id,
            });
          }
      } catch (error) {
        console.error('生成评分反馈失败:', error);
      }

      // 连续3首评分≤2星时也触发不满意气泡
      if (newRating <= 2) {
        consecutiveLowRatingCountRef.current += 1;
        if (consecutiveLowRatingCountRef.current >= 3 && !hasTriggeredQuickSkipTipRef.current) {
          appendSystemLog('[推荐] 触发不满意气泡（连续3首评分≤2星）');
          showDissatisfactionBubble();
        }
      } else {
        consecutiveLowRatingCountRef.current = 0;
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
      <div className="flex-1 min-h-0 flex items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  if (error && !currentTrack) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100">
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
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100 p-8 relative">
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
        {/* 黑胶封面占位符 - 与有歌时同宽、居中 */}
        <div className="mb-8 flex justify-center w-full">
          <div className="w-80 h-80 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center shadow-2xl relative overflow-hidden flex-shrink-0">
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
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center bg-gradient-to-br from-orange-50 to-orange-100 p-8 relative overflow-y-auto">
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
      <div className="relative mb-6 flex flex-col items-center w-full">
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
            {/* Album Art - 系统 A：单击展开/收起标签（标签常驻）；系统 B：双击展开/隐藏下方 tag，默认收起且不显示跟随提示 */}
            <div
              className="mb-8 cursor-pointer select-none flex justify-center items-center w-full"
              onClick={currentSystem === 'A' ? () => setShowTags((s) => !s) : undefined}
              onDoubleClick={currentSystem === 'B' ? () => setShowTags((s) => !s) : undefined}
              title={currentSystem === 'A' ? (showTags ? '单击收起标签' : '单击展开标签') : undefined}
            >
              <div className="w-80 h-80 rounded-2xl shadow-2xl overflow-hidden flex-shrink-0 bg-gray-300">
                {currentTrack.image ? (
                  <img
                    src={currentTrack.image}
                    alt={currentTrack.album_name}
                    className="w-full h-full object-cover object-center"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-gray-500 text-xl">无封面</span>
                  </div>
                )}
              </div>
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
        
              {/* Tags：系统 A 红框内按钮控制标签展开/收起；系统 B 双击封面显示/隐藏整块 */}
              {(currentSystem === 'A' || showTags) && (
              <div className="flex flex-col items-center gap-3 mt-4 max-w-2xl">
                {/* track_id：仅展开时显示 */}
                {(currentSystem === 'A' ? showTags : true) && (
                  <p className="text-xs text-gray-500 font-mono">track_id: {currentTrack.id}</p>
                )}
                {/* 系统 A 红框内：左侧按钮控制标签展开/收起，右侧为标签（仅展开时显示） */}
                {currentTrack.tags && (
              <div className="flex items-start gap-2 w-full justify-center max-w-2xl">
                {currentSystem === 'A' && (
                  <button
                    type="button"
                    onClick={() => setShowTags((s) => !s)}
                    className="flex-shrink-0 p-1 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    title={showTags ? '收起标签' : '展开标签'}
                    aria-label={showTags ? '收起标签' : '展开标签'}
                  >
                    {/* 展开时显示 ▲（收起），收起时显示 ▼（展开） */}
                    {showTags ? (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" style={{ transform: 'rotate(-90deg)' }}>
                        <path d="M12.5 15l-5-5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" style={{ transform: 'rotate(-90deg)' }}>
                        <path d="M7.5 5l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    )}
                  </button>
                )}
                {/* 标签内容：点击按钮展开时显示，收起时隐藏 */}
                {showTags && (
                <div className="flex flex-col items-center gap-3 flex-1 min-w-0">
                {currentTrack.tags.genres.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="text-xs text-gray-500 shrink-0">风格</span>
                    {[...new Set(currentTrack.tags.genres)].slice(0, 5).map((genre, idx) => (
                      <span
                        key={`genre-${genre}-${idx}`}
                        className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium"
                      >
                        {tagWithChinese(genre)}
                      </span>
                    ))}
                  </div>
                )}
                {currentTrack.tags.instruments.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="text-xs text-gray-500 shrink-0">乐器</span>
                    {[...new Set(currentTrack.tags.instruments)].slice(0, 5).map((instrument, idx) => (
                      <span
                        key={`instrument-${instrument}-${idx}`}
                        className="px-3 py-1 text-gray-700 rounded-full text-sm font-normal"
                        style={{ backgroundColor: '#D8CECF' }}
                      >
                        {tagWithChinese(instrument)}
                      </span>
                    ))}
                  </div>
                )}
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
                          {tagWithChinese(tag)}
                        </span>
                      ))}
                    </div>
                  );
                })()}
                </div>
                )}
              </div>
                )}
              </div>
            )}
            </div>
          </>
        )}
      </div>

      {/* Progress Bar with Play Button */}
      <div className="w-full max-w-2xl mb-6 relative">
        {/* 进度条上方区域：权重+1 提示（在气泡上方一点）+ 进度条气泡；权重条 1s 后向上渐隐消失，多条按序弹出 */}
        {(weightPlusOneQueue.length > 0 || ratingRejectTip !== null || (currentSystem === 'B' && bubbleQueue.length > 0)) && (
          <div className="absolute bottom-full left-0 right-0 mb-2 flex flex-col-reverse items-start gap-2 z-50 min-h-0">
            {/* 进度条气泡：每种只展示一次，前一个 5 秒消失后再展示下一个（DOM 第一项在 flex-col-reverse 下靠近进度条） */}
            {currentSystem === 'B' && bubbleQueue.length > 0 && (() => {
              const isDiversityOrQuickSkip = (t: BubbleItem['type']) => t === 'diversity' || t === 'quickSkip';
              const baseStyle: React.CSSProperties = {
                background: 'linear-gradient(135deg, #D8CECF 0%, #91738B 100%)',
                opacity: 0.9,
                maxWidth: '100%',
                whiteSpace: 'normal',
              };
              const grayBubbleStyle: React.CSSProperties = {
                background: 'linear-gradient(135deg, #9CA3AF 0%, #6B7280 100%)',
                opacity: 0.9,
                maxWidth: '100%',
                whiteSpace: 'normal',
              };
              return (
                <div className="flex flex-col-reverse items-start gap-1 min-h-0 w-full">
                  {bubbleQueueIndex < bubbleQueue.length && (() => {
                const item = bubbleQueue[bubbleQueueIndex];
                const handleBubbleClick = () => {
                  logBubbleClick(currentBubbleLogIdRef.current);
                  item.onClick?.();
                };
                const bubbleStyle = item.type === 'recommendation'
                  ? baseStyle
                  : isDiversityOrQuickSkip(item.type)
                    ? grayBubbleStyle
                    : baseStyle;
                const isQuickSkipOrDiversityBubble = isDiversityOrQuickSkip(item.type);
                const glowClass = item.type === 'recommendation'
                  ? 'recommendation-tip'
                  : isQuickSkipOrDiversityBubble
                    ? 'gray-bubble-tip'
                    : 'recommendation-tip';
                return (
                  <div
                    key={item.key}
                    className={`${glowClass} px-3 py-2 text-white text-xs rounded-lg shadow-lg break-words w-fit max-w-full min-w-0 ${item.onClick ? 'cursor-pointer' : ''}`}
                    style={bubbleStyle}
                    onClick={handleBubbleClick}
                  >
                    {(item.showCloseButton && item.onClose) ? (
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <StreamingText
                            text={item.text}
                            onComplete={() => {}}
                          />
                          {(item.type === 'diversity' && item.diversityChoice) || (item.type === 'quickSkip' && item.quickSkipChoice) ? (
                            <div className="flex flex-wrap gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  (item.diversityChoice ?? item.quickSkipChoice)!.onFamiliar();
                                  item.onClose?.();
                                }}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/50 bg-white/20 hover:bg-white/30 text-white transition-colors"
                              >
                                继续听我熟悉的风格
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  (item.diversityChoice ?? item.quickSkipChoice)!.onExplore();
                                  item.onClose?.();
                                }}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/50 bg-white/20 hover:bg-white/30 text-white transition-colors"
                              >
                                探索新领域
                              </button>
                            </div>
                          ) : item.type === 'ratingFeedback' && item.ratingChoice ? (
                            <div className="flex flex-wrap gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  item.ratingChoice!.onConfirm();
                                  item.onClose?.();
                                }}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/50 bg-white/20 hover:bg-white/30 text-white transition-colors opacity-90"
                              >
                                是这样的!
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  item.ratingChoice!.onReject();
                                  item.onClose?.();
                                }}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/50 bg-white/20 hover:bg-white/30 text-white transition-colors opacity-90"
                              >
                                说的不对
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            item.onClose?.();
                            if (item.onClick) handleBubbleClick();
                          }}
                          className="text-white/80 hover:text-white transition-colors shrink-0"
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
                          }}
                        />
                        {item.type === 'recommendation' && recommendationTipSuffix && <span className="block mt-1">{recommendationTipSuffix}</span>}
                      </>
                    )}
                  </div>
                );
              })()}
                </div>
              );
            })()}
            {/* 评分气泡点「说的不对」后的短暂文案 */}
            {ratingRejectTip && (
              <div className="py-1">
                <span className="text-[11px] text-gray-500">{ratingRejectTip}</span>
              </div>
            )}
            {/* 权重+1：在气泡上方一点，无框主题色渐变，1s 后向上渐隐消失，多条按序弹出 */}
            {weightPlusOneQueue.length > 0 && (
              <div
                className={`py-1 transition-all duration-300 ease-out ${
                  weightTipExiting ? 'opacity-0 -translate-y-3' : 'opacity-100 translate-y-0'
                }`}
              >
                <span
                  className="text-[11px] font-medium bg-clip-text text-transparent"
                  style={{
                    backgroundImage: 'linear-gradient(90deg, #91738B 0%, #D8CECF 100%)',
                    WebkitBackgroundClip: 'text',
                  }}
                >
                  <TextWithBoldTags text={weightPlusOneQueue[0]} as="span" />
                </span>
              </div>
            )}
          </div>
        )}
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

      {/* 系统眼中的你（我的偏好图）弹窗 - 与 AIAssistant 内一致 */}
      {showSystemEyesModal && <SystemEyesModal onClose={() => setShowSystemEyesModal(false)} />}

      {/* Actions */}
      <div className="flex flex-row items-center justify-center gap-6 w-full max-w-2xl flex-wrap">
        {/* Favorite Button + 收藏后黄色气泡 */}
        <div className="relative">
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
          {favoriteTip && (
            <div
              className="favorite-tip absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-2 text-white text-xs rounded-lg shadow-lg z-50 min-w-[13.2rem] max-w-[22rem] break-words"
              style={{ backgroundColor: '#C4B59A', opacity: 0.9 }}
            >
              <p className="mb-2">
                {favoriteTip.trim() ? `我识别到你最喜欢的${favoriteTip}风格，下一首会为你优先推荐该风格哦～` : '我识别到你最喜欢的**风格，下一首会为你优先推荐该风格哦～'}
              </p>
              <button
                type="button"
                onClick={() => { setShowSystemEyesModal(true); setFavoriteTip(null); }}
                className="w-full py-1.5 rounded-md text-xs font-medium border border-white/50 bg-white/20 hover:bg-white/30 transition-colors"
              >
                我的偏好图
              </button>
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45" style={{ backgroundColor: '#C4B59A' }} />
            </div>
          )}
          {/* 收藏气泡消失后原地弹出：无框主题色渐变「Tag权重+1」，每条 1 秒，多条按序 */}
        </div>

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
            <div className="absolute top-full left-0 mt-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg shadow-lg z-50 animate-pulse min-w-[8rem] opacity-90">
              必须先给当前歌曲评分才能推荐下一首哦
              <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-800 transform rotate-45"></div>
            </div>
          )}
        </div>

        {/* Next Song Button + 刷新推荐 */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleNext}
            disabled={!currentTrack}
            className="px-3 py-1.5 rounded-lg bg-white text-gray-700 hover:bg-gray-50 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed relative z-10"
          >
            推荐下一首&gt;
          </button>
          <button
            type="button"
            onClick={handleRefreshRecommendations}
            disabled={loading}
            title="重新拉取推荐，填充待播列表"
            className="w-9 h-9 rounded-full bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-800 border border-gray-200 flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed relative z-10"
            aria-label="刷新推荐"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

    </div>
  );
}
