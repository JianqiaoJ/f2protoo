import { useState, useRef, useEffect } from 'react';
import { usePlayerStore } from '../store';
import { aiAssistantApi, ChatMessage } from '../api/aiAssistant';
import { getUserStorageKey, getCurrentUser, getOrCreateConversationSessionId } from '../utils/storage';
import { appendConversationMessage } from '../api/conversation';
import { jamendoApi } from '../api';
import { getReportDistinctTags } from '../data/reportDistinctTags';
import { getRecommendations, getRecommendWhy } from '../api/recommend';
import { setPlaylist } from '../api/playlist';
import { appendSystemLog } from '../api/logs';
import { getPreferenceOperationLabel } from '../api/preferences';
import { tagToChinese } from '../utils/tagToChinese';
import SystemEyesModal from './SystemEyesModal';

// 从localStorage加载消息历史（按用户隔离）
const loadMessagesFromStorage = (): ChatMessage[] => {
  try {
    const storageKey = getUserStorageKey('ai-assistant-messages');
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 验证并过滤有效消息 - 确保用户消息和AI消息都被保留
        const validMessages = parsed.filter((msg: any) => {
          if (!msg || !msg.role) return false;
          // 用户消息必须有content
          if (msg.role === 'user') {
            return !!msg.content;
          }
          // AI消息可以有content或buttons
          return !!(msg.content || (msg.buttons && Array.isArray(msg.buttons) && msg.buttons.length > 0));
        });
        if (validMessages.length > 0) {
          console.log('Loaded messages from storage:', validMessages.length, 'messages');
          return validMessages;
        }
      }
    }
  } catch (error) {
    console.error('Failed to load messages from storage:', error);
  }
  // 首次登录或清除记录后，返回引导消息
  return [];
};

// 保存消息到localStorage
const saveMessagesToStorage = (messages: ChatMessage[]) => {
  try {
    // 确保只保存有效的消息 - 确保用户消息和AI消息都被保存
    const validMessages = messages.filter(msg => {
      if (!msg || !msg.role) return false;
      // 用户消息必须有content
      if (msg.role === 'user') {
        return !!msg.content;
      }
      // AI消息可以有content或buttons
      return !!(msg.content || (msg.buttons && Array.isArray(msg.buttons) && msg.buttons.length > 0));
    });
    if (validMessages.length > 0) {
      const storageKey = getUserStorageKey('ai-assistant-messages');
      localStorage.setItem(storageKey, JSON.stringify(validMessages));
      console.log('Saved messages to storage:', validMessages.length, 'messages');
    }
  } catch (error) {
    console.error('Failed to save messages to storage:', error);
  }
};

interface AIAssistantProps {
  onToggleAssistant?: () => void;
  onFirstRecommendation?: () => void; // 第一次推荐后的回调
}

export default function AIAssistant({ onToggleAssistant, onFirstRecommendation }: AIAssistantProps = {}) {
  const { currentTrack, ratings, getRating, addUserPreference, removeUserPreferenceBatch, getUserPreferences, isPlaying, trackIds, setCurrentTrack, setIsPlaying, setLoading, setRecommendedTrackIds, setRecommendedTrackIndex, syncLastRecommendationVersion, currentSystem } = usePlayerStore();
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessagesFromStorage());
  const lastSyncedToBackendRef = useRef(0);

  // 首次挂载时认为当前消息已存在，不重复同步到后端
  useEffect(() => {
    lastSyncedToBackendRef.current = messages.length;
  }, []);

  // 监听 currentTrack 变化：重新加载消息（推荐解释、评分反馈），并添加歌曲分割线（切换歌曲时）
  useEffect(() => {
    if (!currentTrack) return;
    const loadedMessages = loadMessagesFromStorage();
    const isTrackSwitch = currentTrack.id !== lastTrackIdRef.current;
    let nextMessages = loadedMessages;
    if (isTrackSwitch && lastTrackIdRef.current) {
      const dividerMessage: ChatMessage = {
        role: 'assistant',
        content: `━━━━━━━━━━━━━━━━━━━━\n🎵 ${currentTrack.name} - ${currentTrack.artist_name}`,
      };
      nextMessages = [...loadedMessages, dividerMessage];
    }
    if (isTrackSwitch) {
      lastTrackIdRef.current = currentTrack.id;
      lastRatingRef.current = getRating(currentTrack.id);
    }
    setMessages(nextMessages);
    // 不在此处更新 lastSyncedToBackendRef，否则从 localStorage 新加载的消息（如推荐解释、评分反馈）会被误认为已同步，导致不再写入 user_conversations / user_conversations_history
  }, [currentTrack, getRating]);

  // 监听localStorage变化，实时更新消息（用于接收评分反馈）
  useEffect(() => {
    const handleStorageChange = () => {
      const loadedMessages = loadMessagesFromStorage();
      setMessages(loadedMessages);
      // 不在此处更新 lastSyncedToBackendRef，否则仅存在于 localStorage 的新消息（如评分反馈等）会被误认为已同步，导致不再写入后端
    };
    
    // 监听storage事件（跨标签页）
    window.addEventListener('storage', handleStorageChange);
    
    // 定期检查localStorage（同标签页）
    const interval = setInterval(handleStorageChange, 500);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);
  
  // 监听第一次推荐后歌曲开始播放，收起Seren
  useEffect(() => {
    if (hasTriggeredFirstRecommendationRef.current && currentTrack && isPlaying && onFirstRecommendation) {
      // 检查是否是首次登录（没有用户偏好）
      const prefs = getUserPreferences();
      const isFirstLogin = prefs.genres.length === 0 && 
                          prefs.instruments.length === 0 && 
                          prefs.moods.length === 0 && 
                          prefs.themes.length === 0;
      
      if (isFirstLogin) {
        // 延迟2秒，让用户看到系统回答和歌曲开始播放
        const timer = setTimeout(() => {
          onFirstRecommendation();
          hasTriggeredFirstRecommendationRef.current = false; // 重置，避免重复触发
        }, 2000);
        
        return () => clearTimeout(timer);
      }
    }
  }, [currentTrack, isPlaying, onFirstRecommendation, getUserPreferences]);
  
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSystemEyesModal, setShowSystemEyesModal] = useState(false);
  const [preferenceRememberedTip, setPreferenceRememberedTip] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const showPreferenceRememberedTip = () => {
    setPreferenceRememberedTip('正在更新您的偏好...');
    setTimeout(() => setPreferenceRememberedTip(null), 3000);
  };

  /** 在原按钮位置弹出的灰色纯文字确认，弹出后自动消失 */
  const [transientButtonTip, setTransientButtonTip] = useState<{ messageIndex: number; text: string } | null>(null);
  const showTransientButtonTip = (messageIndex: number, text: string) => {
    setTransientButtonTip({ messageIndex, text });
    setTimeout(() => setTransientButtonTip(null), 2500);
  };
  const lastTrackIdRef = useRef<string>(''); // 记录上次的trackId
  const lastRatingRef = useRef<number>(0); // 记录上次的评分，避免重复推送
  const hasShownWelcomeMessageRef = useRef<boolean>(false); // 记录是否已显示欢迎消息
  const hasTriggeredFirstRecommendationRef = useRef<boolean>(false); // 记录是否已触发第一次推荐
  const chatCancelRequestedRef = useRef(false); // 用户双击加载气泡停止加载时设为 true，请求返回后不再追加回复

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 保存消息到localStorage，并将新增消息同步到后端（当前会话表 + 永久历史表）
  useEffect(() => {
    saveMessagesToStorage(messages);
    const user = getCurrentUser();
    if (!user || messages.length <= lastSyncedToBackendRef.current) return;
    const sessionId = getOrCreateConversationSessionId();
    for (let i = lastSyncedToBackendRef.current; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const content = msg?.content ?? '';
      appendConversationMessage(user, sessionId, role, content, i).catch(() => {});
    }
    lastSyncedToBackendRef.current = messages.length;
  }, [messages]);

  // 首次登录或清除记录后显示引导消息
  useEffect(() => {
    if (messages.length === 0 && !hasShownWelcomeMessageRef.current && trackIds.length > 0) {
      hasShownWelcomeMessageRef.current = true;
      
      const welcomeMessage: ChatMessage = {
        role: 'assistant',
        content: `我是你的音乐推荐小助手Seren ^_^，欢迎第一次访问。为了更好地为你开始推荐，请用一句话描述：
🎵 你喜欢的音乐风格（genre）
🎸 你喜欢的（instrument）
💭 你当前的情境或心情（mood/theme）
例如："我喜欢摇滚和电子音乐，喜欢钢琴，现在想放松"`,
      };
      
      setMessages([welcomeMessage]);
    }
  }, [messages.length, trackIds.length]);

  // 分割线已在上面「监听 currentTrack 变化」的 effect 中与加载消息一起处理，此处不再重复


  // 评分变化时仅更新 lastRatingRef，不再在此处推送低分确认消息（由 MusicPlayer 的评分反馈统一推送「是这样的/说的不对」，避免重复让用户确认）
  useEffect(() => {
    if (!currentTrack) return;
    const currentRating = getRating(currentTrack.id);
    if (currentRating !== lastRatingRef.current) {
      lastRatingRef.current = currentRating;
    }
  }, [currentTrack, ratings, getRating]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: input.trim(),
    };

    // 立即添加用户消息到状态，确保用户能看到自己的输入
    const userInput = input.trim();
    setInput('');
    chatCancelRequestedRef.current = false;
    setIsLoading(true);
    
    // 使用函数式更新确保状态同步
    setMessages((prev) => {
      const newMessages = [...prev, userMessage];
      console.log('Adding user message:', userMessage);
      console.log('Previous messages count:', prev.length);
      console.log('New messages count:', newMessages.length);
      // 立即保存到localStorage
      saveMessagesToStorage(newMessages);
      return newMessages;
    });

    try {
      // 检查是否是首次回复引导消息（消息数量为1且是assistant消息）
      const isFirstResponse = messages.length === 1 && messages[0]?.role === 'assistant' && messages[0]?.content.includes('你喜欢的音乐风格');
      
      if (isFirstResponse) {
        // 首次回复，需要映射到raw.tsv中的标签并推荐歌曲
        try {
          const availableTags = getReportDistinctTags();
          // 调用LLM将用户输入映射到报告中的 distinct tags（不得编造）
          const mappedTags = await aiAssistantApi.mapUserInputToTags(userInput, availableTags);
          
          // 更新用户偏好记忆（先保存偏好），记录为首次登录对话
          const firstLoginOpt = { operation: 'first_login' as const, conversationContent: userInput };
          if (mappedTags.genres.length > 0) {
            await addUserPreference('genres', mappedTags.genres, firstLoginOpt);
          }
          if (mappedTags.instruments.length > 0) {
            await addUserPreference('instruments', mappedTags.instruments, firstLoginOpt);
          }
          if (mappedTags.moods.length > 0) {
            await addUserPreference('moods', mappedTags.moods, firstLoginOpt);
          }
          if (mappedTags.themes.length > 0) {
            await addUserPreference('themes', mappedTags.themes, firstLoginOpt);
          }
          
          // 获取保存后的完整偏好（用于推荐）
          const savedPrefs = getUserPreferences();

          // 冷启动首次回复：不依赖 trackIds 是否已加载（推荐由后端完成），直接请求推荐并回复
          setLoading(true);
          try {
            const username = getCurrentUser();
            if (username) {
                appendSystemLog('[推荐] 已发送冷启动推荐请求，正在等待推荐接口返回...');
                const { recommendedTracks: recommendedTrackIds, recommendedScores, firstTrack: firstTrackFromApi, firstTracks } = await getRecommendations({
                  username,
                  systemType: currentSystem,
                  explicitPreferences: savedPrefs,
                  count: 3,
                  trigger: 'user_expressed_preference',
                });
                appendSystemLog(`[推荐] 请求完成，共 ${recommendedTrackIds.length} 首`);
                if (recommendedTrackIds.length > 0) {
                  setRecommendedTrackIds(recommendedTrackIds, recommendedScores, firstTracks, '用户表达喜好 / 冷启动推荐');
                  setRecommendedTrackIndex(1);
                  setPlaylist(username, recommendedTrackIds, currentSystem).catch(() => {});
                  syncLastRecommendationVersion(); // 避免点「推荐下一首」时被当成偏好更新又拉 10 首
                  const timestamp = new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                  console.log(`✅ [${timestamp}] 已保存推荐列表并同步待播列表，共 ${recommendedTrackIds.length} 首歌曲`);
                  appendSystemLog(`[推荐] 已保存推荐列表并同步待播列表，共 ${recommendedTrackIds.length} 首歌曲`);
                }
                
                if (recommendedTrackIds.length > 0) {
                  const timestamp = new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                  let recommendedTrack = firstTrackFromApi ?? (Array.isArray(firstTracks) && firstTracks.length > 0 ? firstTracks[0] : null);
                  if (!recommendedTrack) {
                    for (let i = 0; i < Math.min(recommendedTrackIds.length, 5); i++) {
                      try {
                        recommendedTrack = await jamendoApi.getTrackById(recommendedTrackIds[i]);
                        if (recommendedTrack) break;
                      } catch {
                        continue;
                      }
                    }
                  }
                  console.log(`🎵 [${timestamp}] 当前推荐歌曲 - track_id: ${recommendedTrack?.id ?? recommendedTrackIds[0]}`);
                  appendSystemLog(`[推荐] 当前推荐歌曲 - track_id: ${recommendedTrack?.id ?? recommendedTrackIds[0]}`);
                  try {
                    if (!recommendedTrack) throw new Error('首曲拉取失败');
                    setCurrentTrack(recommendedTrack);
                    setIsPlaying(true);

                    // 系统 B 冷启动：回复「识别到的用户偏好」+「推荐当前这首歌的理由」，语言热情、简洁、优美；展示完后收起 Seren
                    const preferenceParts: string[] = [];
                    if (mappedTags.genres.length > 0) {
                      preferenceParts.push(`风格 ${mappedTags.genres.map(tagToChinese).join('、')}`);
                    }
                    if (mappedTags.instruments.length > 0) {
                      preferenceParts.push(`乐器 ${mappedTags.instruments.map(tagToChinese).join('、')}`);
                    }
                    const moodThemeParts: string[] = [];
                    if (mappedTags.moods.length > 0) moodThemeParts.push(...mappedTags.moods.map(tagToChinese));
                    if (mappedTags.themes.length > 0) moodThemeParts.push(...mappedTags.themes.map(tagToChinese));
                    if (moodThemeParts.length > 0) {
                      preferenceParts.push(`情绪·主题 ${[...new Set(moodThemeParts)].join('、')}`);
                    }
                    const recognizedSection = preferenceParts.length > 0
                      ? `✨ 捕捉到你的喜好：${preferenceParts.join('；')}。\n\n为你选了这首《${recommendedTrack.name}》，推荐理由：\n\n`
                      : `根据你的描述为你选了这首《${recommendedTrack.name}》～ 推荐理由：\n\n`;

                    // 生成推荐理由（热情、简洁、优美）
                    try {
                      const whyData = await getRecommendWhy(username, recommendedTrack.id, recommendedTrack.tags ?? undefined);
                      let explanationText: string;
                      if (whyData) {
                        explanationText = await aiAssistantApi.generateWhyThisTrack(whyData, recommendedTrack.name, recommendedTrack.artist_name, true);
                      } else {
                        explanationText = await aiAssistantApi.generateWhyThisTrackFallback(recommendedTrack.name, recommendedTrack.artist_name, recommendedTrack.tags ?? undefined);
                      }
                      const fullContent = recognizedSection + explanationText;
                      const systemReply: ChatMessage = { role: 'assistant', content: fullContent, fromSeren: true };
                      setMessages((prev) => {
                        const next = [...prev, systemReply];
                        saveMessagesToStorage(next);
                        return next;
                      });
                      // 系统 B 冷启动：展示「识别到的偏好 + 推荐理由」后 1 秒自动收起小助手
                      if (currentSystem === 'B') {
                        const COLLAPSE_AFTER_MS = 1000;
                        setTimeout(() => onFirstRecommendation?.(), COLLAPSE_AFTER_MS);
                      }
                    } catch (explainErr) {
                      console.warn('冷启动推荐解释生成失败:', explainErr);
                      appendSystemLog(`[推荐] 冷启动推荐解释生成失败: ${explainErr instanceof Error ? explainErr.message : String(explainErr)}`);
                      const fallbackWhy = `这首很契合你刚说的口味，希望你喜欢～`;
                      const fullContent = recognizedSection + fallbackWhy;
                      const fallbackReply: ChatMessage = {
                        role: 'assistant',
                        content: fullContent,
                        fromSeren: true,
                      };
                      setMessages((prev) => {
                        const next = [...prev, fallbackReply];
                        saveMessagesToStorage(next);
                        return next;
                      });
                      if (currentSystem === 'B') {
                        setTimeout(() => onFirstRecommendation?.(), 1000);
                      }
                    }

                    showPreferenceRememberedTip();
                    const prefsBeforeSave = getUserPreferences();
                    const isFirstLoginBeforeSave = prefsBeforeSave.genres.length === 0 &&
                                                  prefsBeforeSave.instruments.length === 0 &&
                                                  prefsBeforeSave.moods.length === 0 &&
                                                  prefsBeforeSave.themes.length === 0;
                    if (isFirstLoginBeforeSave && !hasTriggeredFirstRecommendationRef.current) {
                      hasTriggeredFirstRecommendationRef.current = true;
                    }
                  } catch (trackError) {
                    console.error('Failed to load recommended track:', trackError);
                    const errorMessage: ChatMessage = {
                      role: 'assistant',
                      content: '抱歉，推荐歌曲时出现了问题，请稍后再试。',
                    };
                    setMessages((prev) => [...prev, errorMessage]);
                  } finally {
                    setLoading(false);
                  }
                } else {
                  const noMatchMessage: ChatMessage = {
                    role: 'assistant',
                    content: '抱歉，没有找到完全匹配的歌曲，但我已经记住了您的偏好，后续会为您推荐类似的音乐。',
                  };
                  setMessages((prev) => [...prev, noMatchMessage]);
                  setLoading(false);
                }
              } else {
                setLoading(false);
              }
            } catch (recommendError) {
              console.error('推荐失败:', recommendError);
              const errorMessage: ChatMessage = {
                role: 'assistant',
                content: '抱歉，推荐歌曲时出现了问题，请稍后再试。',
              };
              setMessages((prev) => [...prev, errorMessage]);
              setLoading(false);
            }
        } catch (mappingError) {
          console.error('Failed to map user input to tags:', mappingError);
          // 如果映射失败，继续正常的聊天流程
          const errorMessage: ChatMessage = {
            role: 'assistant',
            content: '抱歉，处理您的偏好时出现了问题。让我继续为您提供帮助。',
          };
          setMessages((prev) => [...prev, errorMessage]);
        }
        
        // 首次回复后，不再调用正常的AI聊天流程
        setIsLoading(false);
        return;
      } else {
        // 非首次回复，先尝试提取偏好并映射到raw.tsv标签
        try {
          // 先提取用户输入中的偏好关键词
          const extractedPrefs = await aiAssistantApi.extractPreferences(userInput);

          // 检查是否有提取到偏好
          const hasExtractedPrefs = 
            extractedPrefs.genres.length > 0 ||
            extractedPrefs.instruments.length > 0 ||
            extractedPrefs.moods.length > 0 ||
            extractedPrefs.themes.length > 0;

          if (hasExtractedPrefs) {
            const availableTags = getReportDistinctTags();
            // 将提取的偏好映射到报告中的 distinct tags（不得编造）
            const mappedTags = await aiAssistantApi.mapUserInputToTags(userInput, availableTags);

            // 检查映射后是否有有效的标签
            const hasMappedTags = 
              mappedTags.genres.length > 0 ||
              mappedTags.instruments.length > 0 ||
              mappedTags.moods.length > 0 ||
              mappedTags.themes.length > 0;

            if (hasMappedTags) {
              // 记录映射后的标签（用于调试）
              console.group('🎵 用户偏好映射结果');
              console.log('用户输入:', userInput);
              console.log('映射后的标签:', mappedTags, 'isDislike:', extractedPrefs.isDislike);

              // 用户表达不喜欢：立即从偏好中移除该风格/特征，更新 DB（user_preferences + user_preference_updates），并重新请求推荐、立刻更新待播列表
              if (extractedPrefs.isDislike) {
                const removals: { type: 'genres' | 'instruments' | 'moods' | 'themes'; items: string[] }[] = [];
                if (mappedTags.genres.length > 0) removals.push({ type: 'genres', items: mappedTags.genres });
                if (mappedTags.instruments.length > 0) removals.push({ type: 'instruments', items: mappedTags.instruments });
                if (mappedTags.moods.length > 0) removals.push({ type: 'moods', items: mappedTags.moods });
                if (mappedTags.themes.length > 0) removals.push({ type: 'themes', items: mappedTags.themes });
                if (removals.length > 0) {
                  await removeUserPreferenceBatch(removals, { operation: 'dislike_remove', conversationContent: userInput });
                  const parts: string[] = [];
                  if (mappedTags.genres.length > 0) parts.push(mappedTags.genres.map(tagToChinese).join('、'));
                  if (mappedTags.instruments.length > 0) parts.push(mappedTags.instruments.map(tagToChinese).join('、'));
                  if (mappedTags.moods.length > 0) parts.push(mappedTags.moods.map(tagToChinese).join('、'));
                  if (mappedTags.themes.length > 0) parts.push(mappedTags.themes.map(tagToChinese).join('、'));
                  const removedText = parts.join('，');
                  const dislikeReply: ChatMessage = {
                    role: 'assistant',
                    content: `已从你的偏好中移除：${removedText}，并已重新拉取推荐、更新待播列表，之后不会再推荐带这些风格的歌啦～`,
                    fromSeren: true,
                  };
                  setMessages((prev) => {
                    const next = [...prev, dislikeReply];
                    saveMessagesToStorage(next);
                    return next;
                  });
                  appendSystemLog(`[用户偏好] 已移除不喜欢: ${removedText}，已更新 DB 并刷新推荐列表`);
                }
                console.groupEnd();
                setIsLoading(false);
                return;
              }

              // 获取当前用户偏好
              const currentPrefs = getUserPreferences();

              // 检测偏好冲突
              const conflictResult = await aiAssistantApi.detectPreferenceConflict(
                userInput,
                currentPrefs,
                messages
              );
              
              // 如果检测到冲突，显示矛盾描述和选择问题
              if (conflictResult.hasConflict && conflictResult.conflictDescription && conflictResult.choiceQuestion && conflictResult.conflictingTag && conflictResult.tagType) {
                console.log('⚠️ 检测到偏好冲突:', conflictResult);
                appendSystemLog(`[用户偏好] 检测到偏好冲突: ${JSON.stringify(conflictResult)} 原因: 对话中表达偏好（冲突检测）`);
                
                // 验证冲突标签是否在映射后的标签中
                const conflictingTagInMapped = 
                  (conflictResult.tagType === 'genres' && mappedTags.genres.includes(conflictResult.conflictingTag)) ||
                  (conflictResult.tagType === 'instruments' && mappedTags.instruments.includes(conflictResult.conflictingTag)) ||
                  (conflictResult.tagType === 'moods' && mappedTags.moods.includes(conflictResult.conflictingTag)) ||
                  (conflictResult.tagType === 'themes' && mappedTags.themes.includes(conflictResult.conflictingTag));
                
                // 如果冲突标签在映射后的标签中，使用映射后的标签；否则使用LLM返回的标签
                const tagToUse = conflictingTagInMapped ? conflictResult.conflictingTag : conflictResult.conflictingTag;
                
                const conflictMessage: ChatMessage = {
                  role: 'assistant',
                  content: `${conflictResult.conflictDescription}\n\n${conflictResult.choiceQuestion}`,
                  fromSeren: true,
                  buttons: [
                    { label: '是！', action: `confirm_conflict_${conflictResult.tagType}_${tagToUse}` },
                    { label: '否', action: `reject_conflict_${conflictResult.tagType}_${tagToUse}` },
                  ],
                };
                
                setMessages((prev) => {
                  const updated = [...prev, conflictMessage];
                  saveMessagesToStorage(updated);
                  return updated;
                });
                
                setIsLoading(false);
                console.groupEnd();
                return;
              }
              
              // 没有冲突，正常保存偏好（记录为对话操作并保存用户输入）
              const conversationOpt = { operation: 'conversation' as const, conversationContent: userInput };
              const formatTagsWithWeights = (tags: string[], weights?: Record<string, number>) =>
                (tags || []).map((t) => (weights && weights[t] != null ? `${t}(${weights[t]})` : t)).join(', ');
              if (mappedTags.genres.length > 0) {
                await addUserPreference('genres', mappedTags.genres, conversationOpt);
                const p = getUserPreferences();
                appendSystemLog(`[用户偏好] 已保存风格偏好: ${formatTagsWithWeights(p?.genres ?? [], p?.genresWeights)} 原因: ${getPreferenceOperationLabel('conversation')}`);
              }
              if (mappedTags.instruments.length > 0) {
                await addUserPreference('instruments', mappedTags.instruments, conversationOpt);
                const p = getUserPreferences();
                appendSystemLog(`[用户偏好] 已保存乐器偏好: ${formatTagsWithWeights(p?.instruments ?? [], p?.instrumentsWeights)} 原因: ${getPreferenceOperationLabel('conversation')}`);
              }
              if (mappedTags.moods.length > 0) {
                await addUserPreference('moods', mappedTags.moods, conversationOpt);
                const p = getUserPreferences();
                appendSystemLog(`[用户偏好] 已保存情绪偏好: ${formatTagsWithWeights(p?.moods ?? [], p?.moodsWeights)} 原因: ${getPreferenceOperationLabel('conversation')}`);
              }
              if (mappedTags.themes.length > 0) {
                await addUserPreference('themes', mappedTags.themes, conversationOpt);
                const p = getUserPreferences();
                appendSystemLog(`[用户偏好] 已保存主题偏好: ${formatTagsWithWeights(p?.themes ?? [], p?.themesWeights)} 原因: ${getPreferenceOperationLabel('conversation')}`);
              }
              
              // 显示最终保存的偏好（含权重）
              const savedPrefs = getUserPreferences();
              console.log('📝 当前用户偏好:', savedPrefs);
              appendSystemLog(`[用户偏好] 当前用户偏好: 风格=${formatTagsWithWeights(savedPrefs?.genres ?? [], savedPrefs?.genresWeights)} 乐器=${formatTagsWithWeights(savedPrefs?.instruments ?? [], savedPrefs?.instrumentsWeights)} 情绪=${formatTagsWithWeights(savedPrefs?.moods ?? [], savedPrefs?.moodsWeights)} 主题=${formatTagsWithWeights(savedPrefs?.themes ?? [], savedPrefs?.themesWeights)} 原因: ${getPreferenceOperationLabel('conversation')}`);
              console.groupEnd();

              // 用户主动表达喜好：立即按新偏好拉取推荐并作为最高优先级在下一首播放（挤掉当前推荐风格）
              const username = getCurrentUser();
              if (username) {
                setLoading(true);
                try {
                  const latestPrefs = getUserPreferences();
                  appendSystemLog('[推荐] 已发送推荐请求（主动表达偏好），正在等待推荐接口返回...');
                  const { recommendedTracks: newRecommendations, recommendedScores: newScores, firstTrack: firstTrackFromApi, firstTracks: newFirstTracks } = await getRecommendations({
                    username,
                    systemType: currentSystem,
                    explicitPreferences: latestPrefs,
                    count: 3,
                    trigger: 'user_expressed_preference',
                  });
                  appendSystemLog(`[推荐] 请求完成，共 ${newRecommendations.length} 首`);
                  if (newRecommendations.length > 0) {
                    setRecommendedTrackIds(newRecommendations, newScores, newFirstTracks, '用户偏好已更新');
                    setRecommendedTrackIndex(1);
                    setPlaylist(username, newRecommendations, currentSystem).catch(() => {});
                    const firstTrack = firstTrackFromApi || await jamendoApi.getTrackById(newRecommendations[0]);
                    if (firstTrack) {
                      setCurrentTrack(firstTrack);
                      setIsPlaying(true);
                    }
                  }
                } catch (err) {
                  console.warn('主动偏好后立即推荐失败:', err);
                  appendSystemLog(`[推荐] 请求失败: ${err instanceof Error ? err.message : String(err)}`);
                } finally {
                  setLoading(false);
                }
              }

              // 构建偏好文本
              const preferenceTexts: string[] = [];
              if (mappedTags.genres.length > 0) {
                preferenceTexts.push(`风格：${mappedTags.genres.join('、')}`);
              }
              if (mappedTags.instruments.length > 0) {
                preferenceTexts.push(`乐器：${mappedTags.instruments.join('、')}`);
              }
              if (mappedTags.moods.length > 0) {
                preferenceTexts.push(`情绪：${mappedTags.moods.join('、')}`);
              }
              if (mappedTags.themes.length > 0) {
                preferenceTexts.push(`主题：${mappedTags.themes.join('、')}`);
              }

              showPreferenceRememberedTip();
              // 偏好已处理，不继续调用LLM
              setIsLoading(false);
              return;
            }
          }
        } catch (prefError) {
          console.warn('Failed to extract or map preferences:', prefError);
          // 如果偏好提取/映射失败，继续正常的聊天流程
        }
      }

      // 1) 若上一条是「是否想查看系统学习到的你的偏好」且用户回复肯定，则打开系统眼中的你（treemap）
      const lastBeforeUser = messages.length > 0 ? messages[messages.length - 1] : null;
      const wasPrefOffer = lastBeforeUser?.role === 'assistant' && typeof lastBeforeUser.content === 'string' && lastBeforeUser.content.includes('是否想查看系统学习到的你的偏好');
      const positiveReply = /^(是|想|要|可以|好的|打开|看看|想看|想看下|想看一下|展示|显示|看一下|看看我的偏好|想看我的偏好)$/i.test(userInput.trim()) || /^好[的]?$/i.test(userInput.trim());
      if (wasPrefOffer && positiveReply) {
        setShowSystemEyesModal(true);
        const okMsg: ChatMessage = { role: 'assistant', content: '好的，正在为你打开系统眼中的你痴迷于…～', fromSeren: true };
        setMessages((prev) => {
          const next = [...prev, okMsg];
          saveMessagesToStorage(next);
          return next;
        });
        setIsLoading(false);
        return;
      }

      // 2) 用户问「怎么推荐的」等与推荐模型/算法相关的问题：查算法文档生成回答，并主动询问是否查看偏好
      const algorithmKeywords = ['怎么推荐', '如何推荐', '推荐歌曲', '推荐算法', '推荐原理', '推荐模型', '你是怎么推荐的', '推荐机制', '推荐逻辑', '怎么给我推荐', '如何给我推荐'];
      const isAskingAlgorithm = algorithmKeywords.some((k) => userInput.toLowerCase().includes(k.toLowerCase()));
      if (isAskingAlgorithm) {
        const docContent = await aiAssistantApi.getRecommendationAlgorithmDoc();
        const answer = await aiAssistantApi.generateAnswerFromAlgorithmDoc(docContent, userInput);
        const offerText = '是否想查看系统学习到的你的偏好？回复「是」或「想」即可打开。';
        const answerMsg: ChatMessage = { role: 'assistant', content: answer, fromSeren: true };
        const offerMsg: ChatMessage = { role: 'assistant', content: offerText, fromSeren: true };
        setMessages((prev) => {
          const hasUser = prev[prev.length - 1]?.role === 'user' && prev[prev.length - 1]?.content === userMessage.content;
          const next = hasUser ? [...prev, answerMsg, offerMsg] : [...prev, userMessage, answerMsg, offerMsg];
          saveMessagesToStorage(next);
          return next;
        });
        setIsLoading(false);
        return;
      }

      // 2.5) 用户表达「重新推荐」「换一批」等不满：立刻调用推荐服务重新推荐并更新待播列表
      const rerecommendKeywords = ['重新推荐', '换一批', '再推荐', '换一些', '重新推', '换一批歌', '不想听这些', '换歌', '给我换', '换一首', '不满意', '不想要这些', '换别的'];
      const isRerecommendRequest = rerecommendKeywords.some(kw => userInput.includes(kw));
      if (isRerecommendRequest) {
        const username = getCurrentUser();
        if (!username) {
          setMessages((prev) => {
            const next: ChatMessage[] = [...prev, { role: 'assistant', content: '请先登录后再试。', fromSeren: true }];
            saveMessagesToStorage(next);
            return next;
          });
          setIsLoading(false);
          return;
        }
        try {
          appendSystemLog('[推荐] 用户请求重新推荐，正在请求推荐接口...');
          const prefs = getUserPreferences();
          const { recommendedTracks: newIds, recommendedScores: newScores, firstTrack: firstFromApi, firstTracks: newFirstTracks } = await getRecommendations({
            username,
            systemType: currentSystem,
            explicitPreferences: prefs,
            count: 10,
            trigger: 'user_request_rerecommend',
          });
          appendSystemLog(`[推荐] 重新推荐请求完成，共 ${newIds.length} 首`);
          if (newIds.length === 0) {
            setMessages((prev) => {
              const next: ChatMessage[] = [...prev, { role: 'assistant', content: '暂时没有更多推荐，可以试试说说你喜欢的风格～', fromSeren: true }];
              saveMessagesToStorage(next);
              return next;
            });
          } else {
            setRecommendedTrackIds(newIds, newScores ?? undefined, newFirstTracks, '用户请求重新推荐');
            setRecommendedTrackIndex(0);
            setPlaylist(username, newIds, currentSystem).catch(() => {});
            syncLastRecommendationVersion();
            const firstTrack = firstFromApi ?? newFirstTracks?.[0] ?? null;
            if (firstTrack) {
              setCurrentTrack(firstTrack);
              setIsPlaying(true);
            } else {
              const fallback = await jamendoApi.getTrackById(newIds[0]).catch(() => null);
              if (fallback) {
                setCurrentTrack(fallback);
                setIsPlaying(true);
              }
            }
            setMessages((prev) => {
              const next: ChatMessage[] = [...prev, { role: 'assistant', content: '已重新推荐，请听新歌～', fromSeren: true }];
              saveMessagesToStorage(next);
              return next;
            });
          }
        } catch (err) {
          console.warn('重新推荐失败:', err);
          appendSystemLog(`[推荐] 重新推荐失败: ${err instanceof Error ? err.message : String(err)}`);
          setMessages((prev) => {
            const next: ChatMessage[] = [...prev, { role: 'assistant', content: '重新推荐时出错了，请稍后再试。', fromSeren: true }];
            saveMessagesToStorage(next);
            return next;
          });
        }
        setIsLoading(false);
        return;
      }

      // 3) 检测用户是否询问偏好（直接打开系统眼中的你 treemap）
      const preferenceKeywords = ['我的偏好', '我的喜好', '偏好是什么', '偏好情况', '偏好分析', '我的音乐偏好', '听歌偏好'];
      const isAskingPreference = preferenceKeywords.some(keyword => 
        userInput.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (isAskingPreference) {
        setShowSystemEyesModal(true);
        setIsLoading(false);
        return;
      }

      // 构建当前歌曲信息
      const trackInfo = currentTrack
        ? {
            name: currentTrack.name,
            artist: currentTrack.artist_name,
            tags: currentTrack.tags,
          }
        : undefined;

      // 获取用户已有的偏好（用于后续可能的扩展）
      try {
        const userPrefs = getUserPreferences();
        // 可以在这里使用userPrefs来增强AI回复
        if (userPrefs.genres.length > 0 || userPrefs.instruments.length > 0) {
          // 用户有偏好记录，可以在系统提示词中使用
        }
      } catch (error) {
        console.error('Failed to get user preferences:', error);
      }

      // 调用AI助手（使用包含用户消息的最新列表）
      // 注意：由于React状态更新是异步的，我们需要使用已经添加了用户消息的列表
      const messagesWithUser = [...messages, userMessage];
      const response = await aiAssistantApi.chat(
        messagesWithUser,
        trackInfo
      );

      if (chatCancelRequestedRef.current) return;

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response,
        fromSeren: true,
      };

      // 添加AI回复（用户消息应该已经在状态中了，因为我们在前面已经setMessages了）
      setMessages((prev) => {
        // 检查最后一条消息是否是刚添加的用户消息
        const lastMessage = prev[prev.length - 1];
        const hasUserMessage = lastMessage && 
          lastMessage.role === 'user' && 
          lastMessage.content === userMessage.content;
        
        if (hasUserMessage) {
          // 用户消息已存在，只添加AI回复
          const updated = [...prev, assistantMessage];
          saveMessagesToStorage(updated);
          return updated;
        } else {
          // 用户消息不存在（不应该发生，但为了安全还是处理）
          console.warn('User message missing in state, adding both user and assistant messages');
          const updated = [...prev, userMessage, assistantMessage];
          saveMessagesToStorage(updated);
          return updated;
        }
      });
    } catch (error) {
      if (chatCancelRequestedRef.current) return;
      console.error('AI Assistant error:', error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: error instanceof Error 
          ? (error.message.includes('AI助手暂时无法响应') 
              ? 'AI助手暂时无法响应，请检查网络连接或稍后再试。' 
              : error.message)
          : '抱歉，发生了错误，请稍后再试。',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  /** 双击加载气泡停止加载，允许用户进行下一轮输入 */
  const handleStopLoading = () => {
    chatCancelRequestedRef.current = true;
    setIsLoading(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleWhyThisTrack = async () => {
    const username = getCurrentUser();
    if (!currentTrack || !username) {
      setMessages(prev => [...prev, { role: 'assistant', content: '请先登录并播放一首推荐歌曲后再试。', fromSeren: true }]);
      return;
    }
    setIsLoading(true);
    try {
      const whyData = await getRecommendWhy(username, currentTrack.id, currentTrack.tags ?? undefined);
      let text: string;
      if (whyData) {
        text = await aiAssistantApi.generateWhyThisTrack(whyData, currentTrack.name, currentTrack.artist_name);
      } else {
        text = await aiAssistantApi.generateWhyThisTrackFallback(currentTrack.name, currentTrack.artist_name, currentTrack.tags ?? undefined);
      }
      const msg: ChatMessage = { role: 'assistant', content: text, fromSeren: true };
      setMessages(prev => {
        const next = [...prev, msg];
        saveMessagesToStorage(next);
        return next;
      });
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: '生成推荐理由时出错了，请稍后再试。', fromSeren: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full h-full min-h-0 flex flex-col bg-gray-100 border-r border-gray-200 relative" style={{ borderRightWidth: '0.5px' }}>
      {/* Toggle Button - Floating on the right */}
      {onToggleAssistant && (
        <button
          onClick={onToggleAssistant}
          className="absolute top-3 right-4 z-50 flex items-center px-3 py-1 text-sm transition-all"
          style={{ top: '12px' }}
        >
          <span style={{
            background: 'linear-gradient(135deg, #D8CECF 0%, #91738B 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            textShadow: '0 0 8px rgba(216, 206, 207, 0.5), 0 0 4px rgba(145, 115, 139, 0.3)',
          }}>
            &lt;&lt;收起Seren
          </span>
        </button>
      )}
      
      {/* 系统眼中的你（偏好 treemap）弹窗 */}
      {showSystemEyesModal && <SystemEyesModal onClose={() => setShowSystemEyesModal(false)} />}

      {/* Messages - min-h-0 让 flex 子项可收缩，才能出现滚动条并支持往上滑 */}
      <div className="flex-1 min-h-0 overflow-y-auto pt-8 px-4 pb-4 space-y-4 bg-gray-50">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <p>暂无消息</p>
          </div>
        ) : (
          messages.map((message, index) => {
            // 调试：打印所有消息
            if (index === 0 || message.role === 'user') {
              console.log(`Rendering message ${index}:`, message);
            }

            // 跳过无效消息
            if (!message || !message.role) {
              console.warn('Invalid message at index', index, message);
              return null;
            }

            // 确保消息有内容或按钮（用户消息必须有content）
            if (message.role === 'user' && !message.content) {
              console.warn('User message without content at index', index, message);
              return null;
            }
            if (message.role === 'assistant' && !message.content && (!message.buttons || message.buttons.length === 0)) {
              console.warn('Assistant message without content or buttons at index', index, message);
              return null;
            }

            // 生成安全的key
            const contentKey = message.content 
              ? message.content.substring(0, 20).replace(/\s/g, '_')
              : message.buttons 
                ? `buttons_${index}`
                : `empty_${index}`;
            const messageKey = `${message.role}-${index}-${contentKey}`;

            // 检查是否是分割线消息
            const isDividerMessage = message.content?.includes('━━━━━━━━━━━━━━━━━━━━');
            
            if (isDividerMessage) {
              // 分割线消息：直接显示文字，两边有灰色连线
              const songInfo = message.content.split('\n')[1] || '';
              return (
                <div key={messageKey} className="flex items-center justify-center gap-3 py-3 px-4">
                  <div className="flex-1 h-px bg-gray-300"></div>
                  <div className="text-xs text-gray-500 whitespace-nowrap">{songInfo}</div>
                  <div className="flex-1 h-px bg-gray-300"></div>
                </div>
              );
            }

            return (
              <div
                key={messageKey}
                className={`flex items-start gap-2 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
              {message.role === 'assistant' ? (
                <div className="max-w-[80%] flex flex-col gap-1.5 ml-2">
                  {message.content && (
                    <div className="relative self-start" style={{
                      borderRadius: '0 2rem 2rem 1.5rem',
                      padding: '1px',
                      background: 'linear-gradient(135deg, #D8CECF 0%, #91738B 100%)',
                    }}>
                      <div
                        className="px-4 py-3 shadow-sm bg-white text-gray-800"
                        style={{
                          borderRadius: '0 calc(2rem - 1px) calc(2rem - 1px) calc(1.5rem - 1px)',
                        }}
                      >
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">
                          {message.fromSeren && <><span className="font-medium text-gray-600">【Seren】</span> </>}
                          {message.content}
                        </p>
                      </div>
                    </div>
                  )}
                  {(message.buttons && message.buttons.length > 0) ? (
                    <div className="flex flex-row gap-2 self-start">
                      {message.buttons.map((button, btnIndex) => (
                        <button
                          key={btnIndex}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-900 transition-colors"
                          onClick={async () => {
                        // 点击后立即移除该条消息的按钮（先同步写 storage，再 setState，避免 500ms 轮询用旧数据覆盖）
                        const next = messages.map((msg, idx) => idx === index ? { ...msg, buttons: undefined } : msg);
                        saveMessagesToStorage(next);
                        setMessages(next);

                        if (button.action === 'confirm') {
                          showPreferenceRememberedTip();
                        } else if (button.action === 'continue') {
                          showTransientButtonTip(index, '好的，我会继续为您推荐音乐。');
                        } else if (button.action === 'confirm_rating_feedback') {
                          showPreferenceRememberedTip();
                          const messageContent = message.content;
                          // 根据评分更新用户偏好
                          if (currentTrack && currentTrack.tags) {
                            // 判断是低分还是高分（通过消息内容判断）
                            const isLowRating = messageContent.includes('不喜欢') || messageContent.includes('不');
                            const tagsToUpdate = {
                              genres: currentTrack.tags.genres || [],
                              instruments: currentTrack.tags.instruments || [],
                              moods: currentTrack.tags.moods || [],
                              themes: currentTrack.tags.themes || [],
                            };
                            
                            // 更新用户偏好
                            if (isLowRating) {
                              // 用户主动表达讨厌：立即从偏好中移除该歌的 tag，更新 DB（user_preferences + user_preference_updates），重新请求推荐并立刻更新待播列表
                              const removals: { type: 'genres' | 'instruments' | 'moods' | 'themes'; items: string[] }[] = [];
                              if (tagsToUpdate.genres.length > 0) removals.push({ type: 'genres', items: tagsToUpdate.genres });
                              if (tagsToUpdate.instruments.length > 0) removals.push({ type: 'instruments', items: tagsToUpdate.instruments });
                              if (tagsToUpdate.moods.length > 0) removals.push({ type: 'moods', items: tagsToUpdate.moods });
                              if (tagsToUpdate.themes.length > 0) removals.push({ type: 'themes', items: tagsToUpdate.themes });
                              if (removals.length > 0) {
                                await removeUserPreferenceBatch(removals, { operation: 'dislike_remove', conversationContent: '评分反馈：不喜欢' });
                                console.log('已移除讨厌的 tag 并替换播放列表:', tagsToUpdate);
                              }
                            } else {
                              // 高分：提升这些标签的权重（通过增加添加次数）
                              const ratingOpt = { operation: 'rating_confirm' as const };
                              for (let i = 0; i < 2; i++) {
                                if (tagsToUpdate.genres.length > 0) {
                                  await addUserPreference('genres', tagsToUpdate.genres, ratingOpt);
                                }
                                if (tagsToUpdate.instruments.length > 0) {
                                  await addUserPreference('instruments', tagsToUpdate.instruments, ratingOpt);
                                }
                                if (tagsToUpdate.moods.length > 0) {
                                  await addUserPreference('moods', tagsToUpdate.moods, ratingOpt);
                                }
                                if (tagsToUpdate.themes.length > 0) {
                                  await addUserPreference('themes', tagsToUpdate.themes, ratingOpt);
                                }
                              }
                              console.log('提升标签权重:', tagsToUpdate);
                            }
                          }
                        } else if (button.action === 'reject_rating_feedback') {
                          showTransientButtonTip(index, '好的，我不会据此修改您的偏好。');
                        } else if (button.action === 'confirm_one_minute_feedback') {
                          showPreferenceRememberedTip();
                          // 根据1分钟听歌更新用户偏好（提升权重）
                          if (currentTrack && currentTrack.tags) {
                            const tagsToUpdate = {
                              genres: currentTrack.tags.genres || [],
                              instruments: currentTrack.tags.instruments || [],
                              moods: currentTrack.tags.moods || [],
                              themes: currentTrack.tags.themes || [],
                            };
                            
                            // 提升这些标签的权重（通过增加添加次数）
                            const oneMinOpt = { operation: 'one_minute_confirm' as const };
                            for (let i = 0; i < 2; i++) {
                              if (tagsToUpdate.genres.length > 0) {
                                await addUserPreference('genres', tagsToUpdate.genres, oneMinOpt);
                              }
                              if (tagsToUpdate.instruments.length > 0) {
                                await addUserPreference('instruments', tagsToUpdate.instruments, oneMinOpt);
                              }
                              if (tagsToUpdate.moods.length > 0) {
                                await addUserPreference('moods', tagsToUpdate.moods, oneMinOpt);
                              }
                              if (tagsToUpdate.themes.length > 0) {
                                await addUserPreference('themes', tagsToUpdate.themes, oneMinOpt);
                              }
                            }
                            console.log('提升标签权重（1分钟听歌）:', tagsToUpdate);
                          }
                        } else if (button.action === 'reject_one_minute_feedback') {
                          showTransientButtonTip(index, '好的，我不会据此修改您的偏好。');
                        } else if (button.action === 'confirm_ninety_five_percent_feedback') {
                          showPreferenceRememberedTip();
                          if (currentTrack && currentTrack.tags) {
                            const tagsToUpdate = {
                              genres: currentTrack.tags.genres || [],
                              instruments: currentTrack.tags.instruments || [],
                              moods: currentTrack.tags.moods || [],
                              themes: currentTrack.tags.themes || [],
                            };
                            const ninetyFiveOpt = { operation: 'ninety_five_confirm' as const };
                            for (let i = 0; i < 2; i++) {
                              if (tagsToUpdate.genres.length > 0) await addUserPreference('genres', tagsToUpdate.genres, ninetyFiveOpt);
                              if (tagsToUpdate.instruments.length > 0) await addUserPreference('instruments', tagsToUpdate.instruments, ninetyFiveOpt);
                              if (tagsToUpdate.moods.length > 0) await addUserPreference('moods', tagsToUpdate.moods, ninetyFiveOpt);
                              if (tagsToUpdate.themes.length > 0) await addUserPreference('themes', tagsToUpdate.themes, ninetyFiveOpt);
                            }
                            console.log('提升标签权重（95%进度）:', tagsToUpdate);
                          }
                          try {
                            const beautifulDescription = await aiAssistantApi.generateBeautifulDescription({
                              name: currentTrack?.name || '',
                              artist: currentTrack?.artist_name || '',
                              tags: currentTrack?.tags,
                            });
                            const descriptionMsg: ChatMessage = {
                              role: 'assistant',
                              content: beautifulDescription,
                              fromSeren: true,
                            };
                            setMessages((prev) => {
                              const next = [...prev];
                              if (next.length > 0) next[next.length - 1] = descriptionMsg;
                              return next;
                            });
                          } catch (error) {
                            console.error('生成优美描述失败:', error);
                            // 保留已追加的「好的，我已经记住了您的偏好！」不重复添加
                          }
                        } else if (button.action === 'reject_ninety_five_percent_feedback') {
                          showTransientButtonTip(index, '好的，我不会据此修改您的偏好。');
                        } else if (button.action.startsWith('confirm_conflict_')) {
                          const actionParts = button.action.split('_');
                          if (actionParts.length >= 4) {
                            showPreferenceRememberedTip();
                            const tagType = actionParts[2] as 'genres' | 'instruments' | 'moods' | 'themes';
                            const conflictingTag = actionParts.slice(3).join('_');
                            const conflictOpt = { operation: 'conflict_confirm' as const, conversationContent: message.content ?? undefined };
                            for (let i = 0; i < 2; i++) {
                              await addUserPreference(tagType, [conflictingTag], conflictOpt);
                            }
                            showTransientButtonTip(index, '好的，我已经更新了您的偏好！');
                            console.log(`✅ 已更新偏好: ${tagType} = ${conflictingTag}`);
                            appendSystemLog(`[用户偏好] 已更新偏好: ${tagType} = ${conflictingTag} 原因: ${getPreferenceOperationLabel('conflict_confirm')}`);
                          }
                        } else if (button.action.startsWith('reject_conflict_')) {
                          showTransientButtonTip(index, '好的，我不会据此修改您的偏好。');
                        }
                      }}
                    >
                      {button.label}
                    </button>
                      ))}
                    </div>
                  ) : transientButtonTip?.messageIndex === index ? (
                    <div className="text-[11px] text-gray-500 self-start py-1">
                      {transientButtonTip.text}
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  {message.content && (
                    <div
                      className="max-w-[80%] px-4 py-3 shadow-sm bg-white text-gray-800 border border-gray-300"
                      style={{
                        borderRadius: '1.5rem 1.5rem 0 1.5rem'
                      }}
                    >
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          );
          })
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div
              role="button"
              tabIndex={0}
              onDoubleClick={handleStopLoading}
              title="双击停止加载，可继续输入"
              className="bg-white border border-gray-200 rounded-lg px-4 py-2 cursor-pointer hover:bg-gray-50 select-none"
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
          </div>
        )}

        {/* 记住偏好：主题色渐变 + 四角星形图标（参考图），维持 3 秒 */}
        {preferenceRememberedTip && (
          <div
            className="flex items-center gap-1.5 text-xs self-start py-0.5 px-2 rounded-md"
            style={{
              background: 'linear-gradient(90deg, #91738B 0%, #D8CECF 100%)',
              color: '#fff',
              boxShadow: '0 0 10px rgba(145,115,139,0.25)',
            }}
          >
            <span className="inline-block w-3 h-3 flex-shrink-0 animate-spin" aria-hidden>
              <svg viewBox="0 0 24 24" className="w-full h-full">
                <defs>
                  <linearGradient id="preference-tip-star-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="#fff" stopOpacity="0.7" />
                  </linearGradient>
                </defs>
                {/* 四角星形（参考图：四角星 sparkle） */}
                <path
                  d="M12 2 L14.5 9.5 L22 12 L14.5 14.5 L12 22 L9.5 14.5 L2 12 L9.5 9.5 Z"
                  fill="url(#preference-tip-star-gradient)"
                />
              </svg>
            </span>
            <span className="font-medium text-[11px]">{preferenceRememberedTip}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 常驻按钮（输入框上方）+ 输入框 */}
      <div className="p-4 bg-gray-50 border-t border-gray-200">
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={handleWhyThisTrack}
            disabled={isLoading || !currentTrack}
            className="rounded-lg p-[1px] disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #D8CECF 0%, #91738B 100%)' }}
          >
            <span className="block px-3 py-1.5 text-xs font-medium rounded-[calc(0.5rem-1px)] bg-white text-gray-900">
              为什么推荐这首
            </span>
          </button>
          <button
            type="button"
            onClick={() => setShowSystemEyesModal(true)}
            disabled={isLoading}
            className="rounded-lg p-[1px] disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #D8CECF 0%, #91738B 100%)' }}
          >
            <span className="block px-3 py-1.5 text-xs font-medium rounded-[calc(0.5rem-1px)] bg-white text-gray-900">
              系统眼中的你痴迷于…
            </span>
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="输入消息..."
            disabled={isLoading}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-100"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="px-4 py-2 bg-transparent text-gray-700 rounded-lg hover:bg-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center"
            title="发送 (Enter)"
          >
            <svg
              className="w-5 h-5 transform -rotate-90"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
