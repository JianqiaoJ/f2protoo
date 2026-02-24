import axios from 'axios';
import { getSerenLLMProvider } from '../utils/storage';
import { chineseToTag, tagToChinese, tagWithChinese } from '../utils/tagToChinese';
import { appendSystemLog } from './logs';

const DEEPSEEK_API_KEY = 'sk-adfb9647455540ad807e6511ae8abe98';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
// OpenRouter：必须从环境变量 VITE_OPENROUTER_API_KEY 读取（并 trim）。未设置或密钥无效会返回 "User not found" 或 "Failed to authenticate request with Clerk"，请到 https://openrouter.ai/keys 获取密钥，参见 https://openrouter.ai/docs/quickstart
const _rawOpenRouterKey = (import.meta as any).env?.VITE_OPENROUTER_API_KEY ?? '';
const OPENROUTER_API_KEY = String(_rawOpenRouterKey).trim();
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** OpenRouter 返回认证相关错误时（User not found / Clerk / 401），表示 API Key 无效或未设置，附加解决提示 */
function openRouterErrorHint(errMsg: string, status?: number): string {
  const msg = String(errMsg);
  const isAuthError =
    status === 401 ||
    /user not found|invalid.*key|unauthorized|failed to authenticate|clerk/i.test(msg);
  if (!isAuthError) return '';
  return ' （请到 https://openrouter.ai/keys 获取 API Key，在本项目 frontend 目录下的 .env 或 .env.local 中设置 VITE_OPENROUTER_API_KEY=sk-or-v1-xxx；.env.example 仅为模板，不会被读取。参见 https://openrouter.ai/docs/quickstart）';
}
import { API_BASE_URL } from './baseUrl';

/** 供 OpenRouter 使用的完整 headers（Authorization + 可选 Referer，部分环境下可避免 401） */
function getOpenRouterHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
  };
  if (typeof window !== 'undefined' && window.location?.origin) {
    h['HTTP-Referer'] = window.location.origin;
  }
  return h;
}

/** 从 choice 取出 content；若 finish_reason 为 length 则打日志（便于排查「老被截断」） */
function getChoiceContent(choice: any, fallback: string): string {
  const raw = choice?.message?.content;
  const content = (typeof raw === 'string' ? raw.trim() : '') || fallback;
  if (choice?.finish_reason === 'length') {
    console.warn('[LLM] 回复因达到 token 上限被截断');
    appendSystemLog('[LLM] 回复因达到 token 上限被截断');
  }
  return content;
}

/** DeepSeek Chat API 的 max_tokens 有效范围为 [1, 8192]，其他模型可用更大值 */
const DEEPSEEK_MAX_TOKENS = 8192;
const DEFAULT_MAX_TOKENS = 16384;

/** 根据当前设置返回 LLM 请求的 url、headers、model、maxTokens（DeepSeek 直连或 Open Router） */
function getLLMConfig(): { url: string; headers: Record<string, string>; model: string; maxTokens: number } {
  const provider = getSerenLLMProvider();
  if (provider === 'deepseek') {
    return {
      url: DEEPSEEK_API_URL,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      model: 'deepseek-chat',
      maxTokens: DEEPSEEK_MAX_TOKENS,
    };
  }
  if (provider === 'deepseek_reason') {
    return {
      url: DEEPSEEK_API_URL,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      model: 'deepseek-reasoner',
      maxTokens: DEEPSEEK_MAX_TOKENS,
    };
  }
  if (provider === 'gemini_25') {
    return { url: OPENROUTER_URL, headers: getOpenRouterHeaders(), model: 'google/gemini-2.5-pro', maxTokens: DEFAULT_MAX_TOKENS };
  }
  if (provider === 'gemini') {
    return { url: OPENROUTER_URL, headers: getOpenRouterHeaders(), model: 'google/gemini-3-pro-preview', maxTokens: DEFAULT_MAX_TOKENS };
  }
  if (provider === 'gemini_3_flash') {
    return { url: OPENROUTER_URL, headers: getOpenRouterHeaders(), model: 'google/gemini-3-flash-preview', maxTokens: DEFAULT_MAX_TOKENS };
  }
  if (provider === 'kimi_k2_5') {
    return { url: OPENROUTER_URL, headers: getOpenRouterHeaders(), model: 'moonshotai/kimi-k2.5', maxTokens: DEFAULT_MAX_TOKENS };
  }
  if (provider === 'chatgpt4o') {
    return { url: OPENROUTER_URL, headers: getOpenRouterHeaders(), model: 'openai/gpt-4o', maxTokens: DEFAULT_MAX_TOKENS };
  }
  if (provider === 'qwen') {
    return { url: OPENROUTER_URL, headers: getOpenRouterHeaders(), model: 'qwen/qwen3-max-thinking', maxTokens: DEFAULT_MAX_TOKENS };
  }
  // chatgpt5：Open Router 上 OpenAI 系（GPT-5.2）
  return { url: OPENROUTER_URL, headers: getOpenRouterHeaders(), model: 'openai/gpt-5.2-chat', maxTokens: DEFAULT_MAX_TOKENS };
}

/** 供设置弹窗展示：根据 provider 返回实际使用的模型名 */
export function getModelNameForProvider(provider: string): string {
  if (provider === 'deepseek') return 'deepseek-chat';
  if (provider === 'deepseek_reason') return 'deepseek-reasoner';
  if (provider === 'gemini_25') return 'google/gemini-2.5-pro';
  if (provider === 'gemini') return 'google/gemini-3-pro-preview';
  if (provider === 'gemini_3_flash') return 'google/gemini-3-flash-preview';
  if (provider === 'chatgpt4o') return 'openai/gpt-4o';
  if (provider === 'chatgpt5') return 'openai/gpt-5.2-chat';
  if (provider === 'qwen') return 'qwen/qwen3-max-thinking';
  if (provider === 'kimi_k2_5') return 'moonshotai/kimi-k2.5';
  return provider;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 是否为 LLM 产出（显示时在内容前加【Seren】） */
  fromSeren?: boolean;
  buttons?: Array<{
    label: string;
    action: string;
  }>;
}

export interface TrackInfo {
  name: string;
  artist: string;
  tags?: {
    genres: string[];
    instruments: string[];
    moods: string[];
    themes: string[];
  };
}

/** 描述歌曲时使用的三个解释维度，供 LLM 统一遵循；且不做人声判断、不出现人声表述 */
const SONG_DESCRIPTION_LAYERS = `描述时请从三个维度组织内容（可自然融合在一段话里）：
1. 声学层（acoustic）：从乐器、节奏、编曲等听感出发，如木吉他+轻节奏→自然、柔和；旋律柔和、编曲简单。
2. 情绪层（affective）：这首歌带给人的情绪与感受，如轻松、陪伴感、温暖、不抢注意力、有生活感。
3. 情境层（contextual）：适合的聆听场景，如聊天、通勤、日常陪伴、放松时聆听。
**禁止**：不要做歌曲是否有人声的判断，描述中不要出现「人声」「有/无人声」「vocal」「人声/纯音乐」等表述。`;

export const aiAssistantApi = {
  async chat(
    messages: ChatMessage[],
    currentTrack?: TrackInfo
  ): Promise<string> {
    try {
      // 构建系统提示词：仅音乐推荐功能，无搜索、无曲名推荐
      const systemPrompt = `你是音乐推荐小助手 Seren，**仅提供音乐推荐相关功能**，没有其他功能。

**你的性格与文风：**
- 善解人意：细心理解用户的喜好与心情，不急于下结论，适时确认或追问一句，让用户感到被听懂。
- 活泼亲切：用轻松、有温度的口吻回复，可以偶尔用一点口语化表达或适度比喻，避免过于正式或机械。
- 服务型助手：以「帮用户找到更合口味的音乐」为己任，主动一点、贴心一点，在合适的时候给一点小建议或小鼓励，但不过度热情或啰嗦。

**你的能力（仅限以下）：**
- 根据用户描述的风格、乐器、心情/情境，理解并记录其音乐偏好，用于系统为其推荐歌曲
- 围绕当前播放的歌曲与用户聊天（风格、情绪、喜好），帮助系统更好地学习偏好并推荐
- 回答与「推荐逻辑」「偏好」「为什么推荐这首」相关的问题

**你没有的能力（请勿声称、提供或建议用户使用）：**
- **没有搜索功能**：不能按歌名、歌手名、歌词搜索；不能帮用户「找某首歌」。**严禁对用户说「可以使用搜索」「去搜索一下」「试试搜索」等**——本产品没有搜索功能，不要提及或暗示存在搜索。
- **不能推荐具体曲目**：不要主动说出具体歌曲名、艺术家名；推荐由系统根据偏好自动完成
- **不能联网或查外部曲库**：仅基于系统曲库与用户偏好进行推荐，不提及曲库外的歌曲

**回复原则：**
- 若用户问「有没有某首歌」「搜一下xxx」「找一首叫xxx的」等，礼貌说明：你只能根据偏好推荐音乐，**没有搜索功能**，建议用户用一句话描述喜欢的风格/心情，系统会为其推荐；**绝不要建议用户使用搜索**。
- 不要主动提及具体歌曲名；分析当前播放时可简要描述风格/情绪，不「推荐」其他具体歌曲
- 语气友好、简洁

**关于人声/纯音乐：**
- **不要**对歌曲做是否有人声的判断，在推荐理由或歌曲描述中**不要出现**「人声」「有/无人声」「vocal」「人声/纯音乐」等表述。
- 当用户要求听「人声歌曲」「有人声的歌」「非纯音乐」「带人声」等时，礼貌说明：**曲库内没有按人声/非人声区分的风格**，目前无法提供这类推荐；建议用户用风格、乐器、情绪等描述偏好，系统会据此推荐。

${currentTrack ? `当前正在播放：${currentTrack.name} - ${currentTrack.artist}` : ''}
${currentTrack?.tags ? `歌曲标签：风格-${currentTrack.tags.genres.join(', ') || '无'}，乐器-${currentTrack.tags.instruments.join(', ') || '无'}，情绪-${currentTrack.tags.moods.join(', ') || '无'}，主题-${currentTrack.tags.themes.join(', ') || '无'}` : ''}`;

      const cfg = getLLMConfig();
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
          temperature: 0.7,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        { headers: cfg.headers }
      );

      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        throw new Error('AI助手返回了无效的响应');
      }
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      return getChoiceContent(response.data.choices[0], '抱歉，我无法理解您的问题。');
    } catch (error: any) {
      console.error('DeepSeek API error:', error);
      
      // 提供更详细的错误信息
      if (error.response) {
        // API返回了错误响应
        const status = error.response.status;
        const message = error.response.data?.error?.message || error.response.data?.message;
        
        if (status === 401) {
          throw new Error('API密钥无效，请检查配置');
        } else if (status === 429) {
          throw new Error('请求过于频繁，请稍后再试');
        } else if (status >= 500) {
          throw new Error('AI服务暂时不可用，请稍后再试');
        } else {
          throw new Error(message || `API错误 (${status})`);
        }
      } else if (error.request) {
        // 请求已发出但没有收到响应
        throw new Error('网络连接失败，请检查网络连接');
      } else {
        // 其他错误
        throw new Error(error.message || 'AI助手暂时无法响应，请稍后再试');
      }
    }
  },

  async recommendMusic(
    userPreference: string,
    currentTrack?: TrackInfo
  ): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: `根据我的偏好"${userPreference}"，推荐一些类似的音乐。${currentTrack ? `当前正在播放：${currentTrack.name} - ${currentTrack.artist}` : ''}`,
      },
    ];

    return this.chat(messages, currentTrack);
  },

  /** 冷启动引导例句：根据该用户在 DB 中的偏好生成一句易懂的示例，供「请用一句话描述…」使用；无偏好时生成通用例句 */
  async generateColdStartExample(preferences: {
    genres: string[];
    instruments: string[];
    moods: string[];
    themes: string[];
  }): Promise<string> {
    const hasPrefs =
      (preferences.genres?.length ?? 0) > 0 ||
      (preferences.instruments?.length ?? 0) > 0 ||
      (preferences.moods?.length ?? 0) > 0 ||
      (preferences.themes?.length ?? 0) > 0;
    const genreStr = (preferences.genres ?? []).slice(0, 3).join('、') || '无';
    const instrumentStr = (preferences.instruments ?? []).slice(0, 3).join('、') || '无';
    const moodStr = (preferences.moods ?? []).slice(0, 2).join('、') || '无';
    const themeStr = (preferences.themes ?? []).slice(0, 2).join('、') || '无';
    try {
      const systemPrompt = hasPrefs
        ? `你是音乐推荐小助手。当前用户在数据库里已有偏好：风格 ${genreStr}，乐器 ${instrumentStr}，情绪 ${moodStr}，主题 ${themeStr}。请根据这些偏好，生成一句简短、易懂的中文示例（一句话），方便用户在冷启动时照着写。要求：只输出「例如："……"」这一句，引号内是一句自然的中文描述（可结合上述偏好），不要解释、不要换行。`
        : `你是音乐推荐小助手。用户还没有任何偏好。请生成一句简短、易懂的中文示例（一句话），方便用户冷启动时照着描述喜好。要求：只输出「例如："……"」这一句，引号内是一句自然的中文（如喜欢的风格、乐器、心情），不要解释、不要换行。`;
      const cfg = getLLMConfig();
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请生成一句示例' },
          ],
          temperature: 0.5,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        { headers: cfg.headers }
      );
      if (!response.data?.choices?.length) throw new Error('无效响应');
      const raw = getChoiceContent(response.data.choices[0], '例如："我喜欢摇滚和电子音乐，喜欢钢琴，现在想放松"');
      const trimmed = (raw || '').trim();
      if (trimmed && /例如[：:]/.test(trimmed)) return trimmed;
      return '例如："我喜欢摇滚和电子音乐，喜欢钢琴，现在想放松"';
    } catch (e) {
      console.warn('生成冷启动例句失败:', e);
      return '例如："我喜欢摇滚和电子音乐，喜欢钢琴，现在想放松"';
    }
  },

  // 将用户输入映射到raw.tsv中的标签
  async mapUserInputToTags(
    userInput: string,
    availableTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] }
  ): Promise<{
    genres: string[];
    instruments: string[];
    moods: string[];
    themes: string[];
  }> {
    try {
      const systemPrompt = `你是一个音乐标签映射助手。用户输入了他们的音乐偏好，你需要将这些偏好映射到以下可用的标签中：

可用风格(genres): ${availableTags.genres.join(', ')}
可用乐器(instruments): ${availableTags.instruments.join(', ')}
可用情绪(moods): ${availableTags.moods.join(', ')}
可用主题(themes): ${availableTags.themes.join(', ')}

用户输入：${userInput}

重要规则：
1. **必须严格从上述标签列表中选择**，不能返回列表中不存在的标签
2. 只映射用户明确提到的标签，不要额外添加或推断
3. 如果用户只提到了风格，就只返回风格，不要添加乐器或情绪
4. 如果用户只提到了乐器，就只返回乐器，不要添加其他标签
5. 如果用户说"放松"、"relaxed"等，应该映射到"relaxing"或"relaxation"（如果它们在列表中）
6. 如果找不到完全匹配的标签，返回空数组，不要猜测或创造新标签
7. **不要**将「人声」「有人声」「vocal」「非纯音乐」「带人声」等与人声/纯音乐相关的表述映射到任何标签；若用户仅表达此类需求，全部返回空数组

返回JSON格式：
{
  "genres": ["从可用风格列表中选择的标签"],
  "instruments": ["从可用乐器列表中选择的标签"],
  "moods": ["从可用情绪列表中选择的标签"],
  "themes": ["从可用主题列表中选择的标签"]
}

只返回JSON，不要其他文字。如果用户没有明确提到某类标签，或找不到匹配的标签，返回空数组。`;

      const cfg = getLLMConfig();
      // [场景：其它] 用户输入→标签 JSON 解析，建议 1024（原 500 易被截断）
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userInput },
          ],
          temperature: 0.3,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        { headers: cfg.headers }
      );

      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      const content = response.data.choices[0]?.message?.content || '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // 验证和过滤标签，确保只返回数据库中存在的标签
        const validateAndFilterTags = (tags: string[], availableTags: string[]): string[] => {
          return tags.filter(tag => {
            // 精确匹配
            if (availableTags.includes(tag)) {
              return true;
            }
            // 尝试找到相似的标签（忽略大小写）
            const lowerTag = tag.toLowerCase();
            const similarTag = availableTags.find(available => 
              available.toLowerCase() === lowerTag ||
              available.toLowerCase().includes(lowerTag) ||
              lowerTag.includes(available.toLowerCase())
            );
            if (similarTag) {
              console.warn(`⚠️ 标签 "${tag}" 不存在，找到相似标签 "${similarTag}"`);
              return false; // 不直接替换，而是过滤掉，让调用者处理
            }
            // 特殊处理：relaxed -> relaxing 或 relaxation
            if (lowerTag === 'relaxed') {
              const relaxedTag = availableTags.find(t => 
                t.toLowerCase() === 'relaxing' || t.toLowerCase() === 'relaxation'
              );
              if (relaxedTag) {
                console.warn(`⚠️ 标签 "relaxed" 不存在，使用相似标签 "${relaxedTag}"`);
                return false;
              }
            }
            console.warn(`❌ 标签 "${tag}" 不存在于数据库中，已过滤`);
            return false;
          });
        };
        
        // 验证并过滤每个类别的标签
        const validatedGenres = validateAndFilterTags(parsed.genres || [], availableTags.genres);
        const validatedInstruments = validateAndFilterTags(parsed.instruments || [], availableTags.instruments);
        const validatedMoods = validateAndFilterTags(parsed.moods || [], availableTags.moods);
        const validatedThemes = validateAndFilterTags(parsed.themes || [], availableTags.themes);
        
        // 处理相似标签替换（如relaxed -> relaxing）
        const findSimilarTag = (tag: string, availableTags: string[]): string | null => {
          const lowerTag = tag.toLowerCase();
          // 特殊处理relaxed
          if (lowerTag === 'relaxed') {
            const relaxing = availableTags.find(t => t.toLowerCase() === 'relaxing');
            if (relaxing) return relaxing;
            const relaxation = availableTags.find(t => t.toLowerCase() === 'relaxation');
            if (relaxation) return relaxation;
          }
          // 其他相似匹配
          return availableTags.find(available => 
            available.toLowerCase() === lowerTag ||
            available.toLowerCase().includes(lowerTag) ||
            lowerTag.includes(available.toLowerCase())
          ) || null;
        };
        
        // 对未通过验证的标签：先尝试中文→英文解析（extractPreferences 常返回中文），再尝试相似标签
        const resolveTag = (tag: string, available: string[], final: string[], category: string): boolean => {
          if (final.includes(tag)) return true;
          if (available.includes(tag)) {
            final.push(tag);
            return true;
          }
          const fromChinese = chineseToTag(tag);
          if (fromChinese && available.includes(fromChinese) && !final.includes(fromChinese)) {
            console.log(`🔄 标签解析(中文→英文): "${tag}" → "${fromChinese}" (${category})`);
            final.push(fromChinese);
            return true;
          }
          const similar = findSimilarTag(tag, available);
          if (similar && !final.includes(similar)) {
            console.log(`🔄 标签替换: "${tag}" → "${similar}" (${category})`);
            final.push(similar);
            return true;
          }
          return false;
        };
        const finalGenres = [...validatedGenres];
        (parsed.genres || []).forEach((tag: string) => {
          if (!validatedGenres.includes(tag)) resolveTag(tag, availableTags.genres, finalGenres, '风格');
        });
        const finalInstruments = [...validatedInstruments];
        (parsed.instruments || []).forEach((tag: string) => {
          if (!validatedInstruments.includes(tag)) resolveTag(tag, availableTags.instruments, finalInstruments, '乐器');
        });
        const finalMoods = [...validatedMoods];
        (parsed.moods || []).forEach((tag: string) => {
          if (!validatedMoods.includes(tag)) resolveTag(tag, availableTags.moods, finalMoods, '情绪');
        });
        const finalThemes = [...validatedThemes];
        (parsed.themes || []).forEach((tag: string) => {
          if (!validatedThemes.includes(tag)) resolveTag(tag, availableTags.themes, finalThemes, '主题');
        });
        
        return {
          genres: finalGenres,
          instruments: finalInstruments,
          moods: finalMoods,
          themes: finalThemes,
        };
      }
      return { genres: [], instruments: [], moods: [], themes: [] };
    } catch (error) {
      console.error('Failed to map user input to tags:', error);
      return { genres: [], instruments: [], moods: [], themes: [] };
    }
  },

  /**
   * 将 extractPreferences 返回的标签（可能含中文）解析为曲库中的英文 tag。
   * 用于「不喜欢 xxx」场景：extract 已识别 isDislike 与标签，此处仅做标签名→库内 tag 的映射，避免 mapUserInputToTags 对整句「不喜欢pop」返回空。
   */
  resolveExtractedTagsToLibrary(
    extractedPrefs: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] },
    availableTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] }
  ): { genres: string[]; instruments: string[]; moods: string[]; themes: string[] } {
    const findSimilar = (tag: string, available: string[]): string | null => {
      const lower = tag.toLowerCase();
      if (available.includes(tag)) return tag;
      const fromZh = chineseToTag(tag);
      if (fromZh && available.includes(fromZh)) return fromZh;
      return available.find(a => a.toLowerCase() === lower || a.toLowerCase().includes(lower) || lower.includes(a.toLowerCase())) ?? null;
    };
    const resolveList = (raw: string[], available: string[]): string[] => {
      const out: string[] = [];
      raw.forEach(tag => {
        const resolved = findSimilar(tag, available);
        if (resolved && !out.includes(resolved)) out.push(resolved);
      });
      return out;
    };
    return {
      genres: resolveList(extractedPrefs.genres || [], availableTags.genres),
      instruments: resolveList(extractedPrefs.instruments || [], availableTags.instruments),
      moods: resolveList(extractedPrefs.moods || [], availableTags.moods),
      themes: resolveList(extractedPrefs.themes || [], availableTags.themes),
    };
  },

  /**
   * 不喜欢解析兜底：当 LLM 未提取出标签时，从用户输入中按顿号/逗号分段，匹配曲库中的标签（中文名或英文名），用于厌恶分支。
   * 仅当输入包含「不喜欢」「讨厌」「别推荐」「不要」时生效。
   */
  parseDislikeFallback(
    userInput: string,
    availableTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] }
  ): { genres: string[]; instruments: string[]; moods: string[]; themes: string[] } {
    const raw = String(userInput || '').trim();
    if (!/不喜欢|讨厌|别推荐|不要/.test(raw)) {
      return { genres: [], instruments: [], moods: [], themes: [] };
    }
    const segments = raw
      .replace(/，/g, ',')
      .split(/[,、，\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const result = { genres: [] as string[], instruments: [] as string[], moods: [] as string[], themes: [] as string[] };
    const categories = ['genres', 'instruments', 'moods', 'themes'] as const;
    for (const cat of categories) {
      const list = availableTags[cat];
      for (const tag of list) {
        const zh = tagToChinese(tag);
        const matched = segments.some(seg => seg === tag || seg === zh);
        if (matched && !result[cat].includes(tag)) result[cat].push(tag);
      }
    }
    return result;
  },

  /** 当用户请求系统无法支持时（库里没有的风格/乐器/曲风，或要求近n年歌曲）：生成「暂时无法支持」的回复并推荐类似风格（返回的 similarTags 仅从 availableTags 中选取，用于后续推荐） */
  async getUnsupportedReplyWithSimilar(
    userInput: string,
    availableTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] },
    reason: 'tags_not_in_library' | 'year_filter'
  ): Promise<{ reply: string; similarTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] } }> {
    const reasonDesc =
      reason === 'year_filter'
        ? '用户要求按年份筛选（如近n年、某年后的歌），系统暂不支持按年份筛选。'
        : '用户想要的风格、乐器或曲风在曲库中不存在。';
    const systemPrompt = `你是音乐推荐小助手。当前情况：${reasonDesc}

用户原话：${userInput}

请完成两件事：
1. 用一句简短、友好的中文回复告知用户「暂时无法支持」并说明原因，同时说明会为他推荐类似风格的歌曲。
2. 从下面「可用标签」中选出与用户意图最接近的类似风格（每类最多 3 个），用于后续推荐。必须严格只从列表中选，不得编造。

可用风格(genres)：${availableTags.genres.slice(0, 80).join(', ')}
可用乐器(instruments)：${availableTags.instruments.join(', ')}
可用情绪(moods)：${availableTags.moods.slice(0, 60).join(', ')}
可用主题(themes)：${availableTags.themes.slice(0, 60).join(', ')}

返回 JSON，不要其他文字：
{
  "reply": "你的回复内容（告知暂时无法支持并推荐类似风格）",
  "similarTags": {
    "genres": ["从可用风格中选的标签，最多3个"],
    "instruments": ["从可用乐器中选的标签，最多3个"],
    "moods": ["从可用情绪中选的标签，最多3个"],
    "themes": ["从可用主题中选的标签，最多3个"]
  }
}`;

    try {
      const cfg = getLLMConfig();
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userInput },
          ],
          temperature: 0.3,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        { headers: cfg.headers }
      );
      const content = response.data.choices[0]?.message?.content || '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('未解析到 JSON');
      const parsed = JSON.parse(jsonMatch[0]);
      const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '暂时无法支持该需求，为你推荐了类似风格的歌曲～';
      const raw = parsed.similarTags || {};
      const filterToAvailable = (arr: unknown[], available: string[]): string[] =>
        (Array.isArray(arr) ? arr : [])
          .filter((t): t is string => typeof t === 'string' && available.includes(t))
          .slice(0, 3);
      const similarTags = {
        genres: filterToAvailable(raw.genres || [], availableTags.genres),
        instruments: filterToAvailable(raw.instruments || [], availableTags.instruments),
        moods: filterToAvailable(raw.moods || [], availableTags.moods),
        themes: filterToAvailable(raw.themes || [], availableTags.themes),
      };
      if (
        similarTags.genres.length === 0 &&
        similarTags.instruments.length === 0 &&
        similarTags.moods.length === 0 &&
        similarTags.themes.length === 0
      ) {
        similarTags.genres = availableTags.genres.slice(0, 2);
      }
      return { reply, similarTags };
    } catch (error) {
      console.error('getUnsupportedReplyWithSimilar failed:', error);
      const fallbackSimilar = {
        genres: availableTags.genres.slice(0, 2),
        instruments: [] as string[],
        moods: [] as string[],
        themes: [] as string[],
      };
      return {
        reply:
          reason === 'year_filter'
            ? '暂不支持按年份筛选歌曲哦，为你推荐了类似风格的歌～'
            : '该风格/曲风暂不在曲库中，为你推荐了类似风格的歌曲～',
        similarTags: fallbackSimilar,
      };
    }
  },

  // 识别用户消息中的音乐偏好（喜欢或不喜欢）
  async extractPreferences(userMessage: string): Promise<{
    isDislike?: boolean;
    genres: string[];
    instruments: string[];
    moods: string[];
    themes: string[];
  }> {
    try {
      const systemPrompt = `你是一个音乐偏好提取助手。从用户的消息中提取音乐风格(genre)、乐器(instrument)、情绪(mood)或主题(theme)。

规则：
1. 若用户表达「喜欢」「想要」某类音乐，则 isDislike 为 false，将对应标签放入各数组。
2. 若用户表达「不喜欢」「讨厌」「别推荐」「不要」某类音乐/风格/特征，则 isDislike 为 true，将用户不喜欢的风格或特征放入对应数组。
3. **不要**将「人声」「有人声」「vocal」「非纯音乐」「带人声」等与人声/纯音乐相关的表述放入任何数组——曲库不按人声区分，这类需求无法作为偏好标签。若用户仅表达此类需求，各数组均返回空。

用户消息：${userMessage}

请以JSON格式返回：
{
  "isDislike": true或false,
  "genres": ["风格1"],
  "instruments": ["乐器1"],
  "moods": ["情绪1"],
  "themes": ["主题1"]
}

未提及的类别返回空数组。只返回JSON，不要其他文字。`;

      const cfg = getLLMConfig();
      // [场景：其它] 喜欢/不喜欢偏好 JSON，建议 1024（原 500 易被截断）
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.3,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        {
          headers: cfg.headers,
        }
      );

      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      const content = response.data.choices[0]?.message?.content || '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          isDislike: parsed.isDislike === true,
          genres: parsed.genres || [],
          instruments: parsed.instruments || [],
          moods: parsed.moods || [],
          themes: parsed.themes || [],
        };
      }
      return { genres: [], instruments: [], moods: [], themes: [] };
    } catch (error) {
      console.error('Failed to extract preferences:', error);
      return { genres: [], instruments: [], moods: [], themes: [] };
    }
  },

  // 生成评分反馈文本
  async generateRatingFeedback(
    rating: number,
    trackInfo: TrackInfo
  ): Promise<string> {
    try {
      const isLowRating = rating <= 2;
      const isHighRating = rating >= 4;
      
      if (!isLowRating && !isHighRating) {
        return '';
      }

      const ratingType = isLowRating ? '低' : '高';
      const sentiment = isLowRating ? '不喜欢' : '喜欢';
      
      const tags = trackInfo.tags || { genres: [], instruments: [], moods: [], themes: [] };
      const genres = tags.genres.slice(0, 2).map(tagWithChinese).join('、') || '未知风格';
      const instruments = tags.instruments.slice(0, 2).map(tagWithChinese).join('、') || '未知乐器';
      const moods = tags.moods.slice(0, 2).map(tagWithChinese).join('、') || '未知情绪';
      
      const systemPrompt = `你是一个音乐推荐助手。用户刚刚对一首歌曲打了${rating}星（${ratingType}评分），你需要生成一段简短、易读、友好的反馈文本，表明你理解了用户的隐式偏好。

歌曲信息：
- 名称：${trackInfo.name}
- 艺术家：${trackInfo.artist}
- 风格标签：${genres}
- 乐器标签：${instruments}
- 情绪标签：${moods}

要求：
1. 开头必须明确写出刚刚的歌曲名称和用户对这首歌的${rating}星评分，例如：「你刚刚给了《${trackInfo.name}》${rating}星评分，你似乎${sentiment}……」让用户清楚知道这是针对他/她刚才的评分行为。文案中不要使用「根据」二字。
2. 严格控制在 100 字以内；不要推理过程，只输出一段反馈文本。
3. 语气友好、自然。
4. ${isLowRating ? '表达理解用户不喜欢这些标签组合' : '表达理解用户喜欢这些标签组合'}
5. 必须包含且突出两点：① 这首歌最有特色的地方（如编曲、层次、某段旋律、某种音色、节奏或氛围上的亮点，用一句话点出）；② 着重强调这首歌带给人的感觉、氛围或情绪（如沉静、克制、温暖、有张力、治愈、开阔等）
6. 可自然带过适合聆听的情境（如专注、休息、放松时听）
7. 只提及实际存在的标签；开头必须带上歌曲名称《${trackInfo.name}》
8. 文中若提到具体标签，请使用「英文 中文」格式，如 jazz 爵士、piano 钢琴。

示例风格（仅供参考）：你刚刚给了《${trackInfo.name}》5星评分，你似乎很喜欢古典交响乐中钢琴与大提琴的搭配呢；这首在层次与张力上尤其出彩，整体给人沉静又略带克制的感动，适合专注或休息时听。

请只输出反馈文本，不要推理过程：`;

      const cfg = getLLMConfig();
      // [场景：评分反馈] 评分反馈文本（严格 100 字以内），上限 2048 避免截断
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请生成反馈文本（只输出一段话，100字以内）' },
          ],
          temperature: 0.7,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        {
          headers: cfg.headers,
        }
      );

      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        throw new Error('AI助手返回了无效的响应');
      }
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      return getChoiceContent(response.data.choices[0], '');
    } catch (error: any) {
      console.error('生成评分反馈失败:', error);
      const tags = trackInfo.tags || { genres: [], instruments: [], moods: [], themes: [] };
      const genres = tags.genres.slice(0, 2).map(tagWithChinese).join('、') || '未知风格';
      const instruments = tags.instruments.slice(0, 2).map(tagWithChinese).join('、') || '未知乐器';
      const moods = tags.moods.slice(0, 2).map(tagWithChinese).join('、') || '未知情绪';
      const songName = trackInfo.name ? `《${trackInfo.name}》` : '这首歌';
      if (rating <= 2) {
        return `你刚刚给了${songName}${rating}星评分，你似乎很不喜欢该${genres}和器乐${instruments}在${moods}下为您营造的氛围哦`;
      } else if (rating >= 4) {
        return `你刚刚给了${songName}${rating}星评分，你似乎很喜欢该${genres}和器乐${instruments}的搭配呢；这首在编曲与层次上很有辨识度，整体给人放松又舒服的感觉，适合闲暇时听。`;
      }
      return '';
    }
  },

  // 生成1分钟听歌反馈文本
  async generateOneMinuteFeedback(
    trackInfo: TrackInfo
  ): Promise<string> {
    try {
      const tags = trackInfo.tags || { genres: [], instruments: [], moods: [], themes: [] };
      const genres = tags.genres.slice(0, 2).map(tagWithChinese).join('、') || '未知风格';
      const instruments = tags.instruments.slice(0, 2).map(tagWithChinese).join('、') || '未知乐器';
      const moods = tags.moods.slice(0, 2).map(tagWithChinese).join('、') || '未知情绪';
      
      const systemPrompt = `你是一个音乐推荐助手。用户刚刚听这首歌已经持续了1分钟，这表明用户可能喜欢这首歌曲。你需要生成一段简短、易读、友好的反馈文本，表明你理解了用户的隐式偏好。

歌曲信息：
- 名称：${trackInfo.name}
- 艺术家：${trackInfo.artist}
- 风格标签：${genres}
- 乐器标签：${instruments}
- 情绪标签：${moods}

要求：
1. 开头必须明确写出刚刚听的歌曲名称和听满1分钟的行为，例如：「你刚刚听了《${trackInfo.name}》约1分钟，你似乎很喜欢……」让用户清楚知道这是针对他/她刚才的听歌行为。文案中不要使用「根据」二字。
2. 文本稍丰富（约 60～100 字）
3. 语气友好、自然
4. 必须包含且突出两点：① 这首歌最有特色的地方（如编曲、层次、音色、节奏或氛围上的亮点，一句话点出）；② 着重强调这首歌带给人的感觉、氛围或情绪
5. 可自然带过适合聆听的情境；只提及实际存在的标签；开头必须带上歌曲名称《${trackInfo.name}》
6. 文中若提到具体标签，请使用「英文 中文」格式，如 jazz 爵士、piano 钢琴。

示例风格（仅供参考）：你刚刚听了《${trackInfo.name}》约1分钟，你似乎很喜欢古典交响乐中钢琴与大提琴的搭配呢；这首在层次与张力上尤其出彩，整体给人沉静又略带克制的感动，适合专注或休息时听。

请生成反馈文本：`;

      const cfg = getLLMConfig();
      // [场景：推荐解释] 听满 1 分钟反馈文本（约 60～100 字），建议 1024
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请生成反馈文本' },
          ],
          temperature: 0.7,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        {
          headers: cfg.headers,
        }
      );

      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        throw new Error('AI助手返回了无效的响应');
      }
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      return getChoiceContent(response.data.choices[0], '');
    } catch (error: any) {
      console.error('生成1分钟反馈失败:', error);
      const tags = trackInfo.tags || { genres: [], instruments: [], moods: [], themes: [] };
      const genres = tags.genres.slice(0, 2).map(tagWithChinese).join('、') || '未知风格';
      const instruments = tags.instruments.slice(0, 2).map(tagWithChinese).join('、') || '未知乐器';
      const moods = tags.moods.slice(0, 2).map(tagWithChinese).join('、') || '未知情绪';
      const songName = trackInfo.name ? `《${trackInfo.name}》` : '这首歌';
      return `你刚刚听了${songName}约1分钟，你似乎很喜欢该${genres}和器乐${instruments}的搭配呢；这首在编曲与层次上很有辨识度，在${moods}下尤其有味道，整体给人很舒服的感觉。`;
    }
  },

  // 生成95%进度反馈文本
  async generateNinetyFivePercentFeedback(
    trackInfo: TrackInfo
  ): Promise<string> {
    try {
      const tags = trackInfo.tags || { genres: [], instruments: [], moods: [], themes: [] };
      const genres = tags.genres.slice(0, 2).map(tagWithChinese).join('、') || '未知风格';
      const instruments = tags.instruments.slice(0, 2).map(tagWithChinese).join('、') || '未知乐器';
      const moods = tags.moods.slice(0, 2).map(tagWithChinese).join('、') || '未知情绪';
      const themes = tags.themes.slice(0, 2).map(tagWithChinese).join('、') || '未知主题';
      
      const systemPrompt = `你是一个音乐推荐助手。用户刚刚快听完这首歌曲（播放进度约95%），这表明用户可能非常喜欢这首歌曲。但该歌曲的标签不在用户已知的偏好中。你需要生成一段简短、易读、友好的反馈文本，推测用户可能喜欢这些标签组合。

歌曲信息：
- 名称：${trackInfo.name}
- 艺术家：${trackInfo.artist}
- 风格标签：${genres}
- 乐器标签：${instruments}
- 情绪标签：${moods}
- 主题标签：${themes}

要求：
1. 开头必须明确写出刚刚快听完的歌曲名称（约95%进度），例如：「你刚刚快听完了《${trackInfo.name}》，我推测你非常喜欢……」让用户清楚知道这是针对他/她刚才的听歌行为。文案中不要使用「根据」二字。
2. 文本稍丰富（约 60～90 字），可略长于一句
3. 语气友好、自然、带有推测性
4. 必须包含且突出：① 这首歌最有特色的地方（如编曲、层次、音色等，一句话点出）；② 着重强调这首歌带给人的感觉、氛围或情绪
5. 只提及实际存在的标签；开头必须带上歌曲名称《${trackInfo.name}》
6. 最后加上"来聊聊我说的对不对？"
7. 文中若提到具体标签，请使用「英文 中文」格式，如 jazz 爵士、piano 钢琴。

示例格式（仅供参考）：你刚刚快听完了《${trackInfo.name}》，我推测你非常喜欢这首在层次与张力上尤其出彩的古典搭配呢，整体给人沉静又克制的感动；来聊聊我说的对不对？

请生成反馈文本：`;

      const cfg = getLLMConfig();
      // [场景：推荐解释] 95% 进度反馈文本（约 60～90 字），建议 1024
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请生成反馈文本' },
          ],
          temperature: 0.7,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        {
          headers: cfg.headers,
        }
      );

      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        throw new Error('AI助手返回了无效的响应');
      }
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      return getChoiceContent(response.data.choices[0], '');
    } catch (error: any) {
      console.error('生成95%反馈失败:', error);
      // 如果LLM调用失败，返回默认文本
      const tags = trackInfo.tags || { genres: [], instruments: [], moods: [], themes: [] };
      const genres = tags.genres.slice(0, 2).map(tagWithChinese).join('、') || '未知风格';
      const instruments = tags.instruments.slice(0, 2).map(tagWithChinese).join('、') || '未知乐器';
      const moods = tags.moods.slice(0, 2).map(tagWithChinese).join('、') || '未知情绪';
      
      const songName = trackInfo.name ? `《${trackInfo.name}》` : '这首歌';
      return `你刚刚快听完了${songName}，我推测你非常喜欢该${genres}和器乐${instruments}在${moods}下为您营造的氛围，来聊聊我说的对不对？`;
    }
  },

  // 生成优美的歌曲描述
  async generateBeautifulDescription(
    trackInfo: TrackInfo
  ): Promise<string> {
    try {
      const tags = trackInfo.tags || { genres: [], instruments: [], moods: [], themes: [] };
      const genres = tags.genres.slice(0, 3).join('、') || '未知风格';
      const instruments = tags.instruments.slice(0, 3).join('、') || '未知乐器';
      const moods = tags.moods.slice(0, 3).join('、') || '未知情绪';
      const themes = tags.themes.slice(0, 3).join('、') || '未知主题';
      
      const systemPrompt = `你是一个音乐评论家，擅长用优美、文学化的语言描述音乐。用户确认喜欢一首歌曲，你需要为这首歌曲生成一段优美、文学化的描述。

歌曲信息：
- 名称：${trackInfo.name}
- 艺术家：${trackInfo.artist}
- 风格标签：${genres}
- 乐器标签：${instruments}
- 情绪标签：${moods}
- 主题标签：${themes}

${SONG_DESCRIPTION_LAYERS}

要求：
1. 将声学层、情绪层、情境层自然融入描述，文本优美、有诗意
2. 长度控制在50-100字
3. 不要直接罗列标签名称，用更文学化的方式表达
4. 可以提及歌曲名称和艺术家名称，语气温暖、感性

请生成优美的描述：`;

      const cfg = getLLMConfig();
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请生成优美的描述' },
          ],
          temperature: 0.8,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        {
          headers: cfg.headers,
        }
      );

      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        throw new Error('AI助手返回了无效的响应');
      }
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      return getChoiceContent(response.data.choices[0], '');
    } catch (error: any) {
      console.error('生成优美描述失败:', error);
      return `这首《${trackInfo.name}》确实是一首很棒的歌曲，它的旋律和氛围都很特别。`;
    }
  },

  // 检测偏好冲突并生成矛盾描述和选择问题
  async detectPreferenceConflict(
    userInput: string,
    currentPreferences: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] },
    chatHistory: ChatMessage[]
  ): Promise<{ hasConflict: boolean; conflictDescription?: string; choiceQuestion?: string; conflictingTag?: string; tagType?: 'genres' | 'instruments' | 'moods' | 'themes' }> {
    try {
      // 构建历史偏好描述
      const historyDescription = `当前用户偏好：
- 风格：${(currentPreferences.genres || []).map(tagWithChinese).join('、') || '无'}
- 乐器：${(currentPreferences.instruments || []).map(tagWithChinese).join('、') || '无'}
- 情绪：${(currentPreferences.moods || []).map(tagWithChinese).join('、') || '无'}
- 主题：${(currentPreferences.themes || []).map(tagWithChinese).join('、') || '无'}`;

      // 构建聊天历史摘要（最近5条消息）
      const recentHistory = chatHistory.slice(-5).map(msg => 
        `${msg.role === 'user' ? '用户' : '助手'}: ${msg.content}`
      ).join('\n');

      const systemPrompt = `你是一个音乐偏好分析助手。用户刚刚输入了一条消息，你需要判断这条消息中表达的偏好是否与用户当前的偏好存在矛盾或冲突。

${historyDescription}

最近聊天历史：
${recentHistory}

用户最新输入：${userInput}

请分析：
1. 用户的新输入是否表达了与当前偏好矛盾的偏好？（例如：之前喜欢jazz，现在说不喜欢；或之前偏好重金属，现在提到喜欢爵士）
2. 如果存在矛盾，请用第二人称「你」、简洁自然地描述（不超过30字），例如："你之前偏好重金属和歌剧，但刚刚提到喜欢爵士。" 不要用「用户」「新输入」等第三人称。
3. 如果存在矛盾，先评估：原有偏好与刚提到的偏好是否风格反差很大。
   - 反差很大：如重金属/歌剧 vs 爵士、古典 vs 电子、金属 vs 轻音乐等，问句用比较型，例如："你更喜欢爵士乐吗？"、"你更想听爵士吗？"
   - 反差不大：如民谣 vs 流行、钢琴 vs 吉他等较接近的风格，问句用补充型，例如："你也喜欢爵士乐吗？"、"是否也喜欢爵士？"
4. 如果存在矛盾，请指出冲突的标签类型（genres/instruments/moods/themes）和具体的标签名称。

请以JSON格式返回：
{
  "hasConflict": true/false,
  "conflictDescription": "矛盾描述（第二人称，如果有冲突）",
  "choiceQuestion": "选择问题（如果有冲突；反差大时用「你更喜欢X吗？」类比较问句，反差小时用「你也喜欢X吗？」类补充问句）",
  "conflictingTag": "冲突的标签名称（如果有冲突）",
  "tagType": "genres/instruments/moods/themes（如果有冲突）"
}

如果没有冲突，返回：
{
  "hasConflict": false
}`;

      const cfg = getLLMConfig();
      // [场景：其它] 偏好冲突分析 JSON，建议 1024
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请分析偏好冲突' },
          ],
          temperature: 0.3,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        {
          headers: cfg.headers,
        }
      );

      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      const content = response.data.choices[0]?.message?.content || '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          hasConflict: parsed.hasConflict === true,
          conflictDescription: parsed.conflictDescription,
          choiceQuestion: parsed.choiceQuestion,
          conflictingTag: parsed.conflictingTag,
          tagType: parsed.tagType,
        };
      }
      return { hasConflict: false };
    } catch (error) {
      console.error('检测偏好冲突失败:', error);
      return { hasConflict: false };
    }
  },

  // 生成「系统眼中的你」偏好解释（基于 treemap/偏好数据）
  async generateHeatmapExplanation(heatmapData: {
    genres: Array<{ tag: string; weight: number }>;
    instruments: Array<{ tag: string; weight: number }>;
    moods: Array<{ tag: string; weight: number }>;
    themes: Array<{ tag: string; weight: number }>;
  }): Promise<string> {
    try {
      // 构建偏好数据摘要供 LLM 使用（标签用中英文展示，如 jazz 爵士）
      const topGenres = heatmapData.genres.slice(0, 5).map(item => `${tagWithChinese(item.tag)}(${item.weight > 0 ? '+' : ''}${item.weight.toFixed(1)})`).join('、') || '无';
      const topInstruments = heatmapData.instruments.slice(0, 5).map(item => `${tagWithChinese(item.tag)}(${item.weight > 0 ? '+' : ''}${item.weight.toFixed(1)})`).join('、') || '无';
      const topMoods = heatmapData.moods.slice(0, 5).map(item => `${tagWithChinese(item.tag)}(${item.weight > 0 ? '+' : ''}${item.weight.toFixed(1)})`).join('、') || '无';
      const topThemes = heatmapData.themes.slice(0, 5).map(item => `${tagWithChinese(item.tag)}(${item.weight > 0 ? '+' : ''}${item.weight.toFixed(1)})`).join('、') || '无';
      
      const systemPrompt = `你是一个音乐偏好分析助手。用户查看了以树状图（treemap）形式展示的听歌偏好分布，你需要根据以下偏好数据生成一段简洁、优美、易懂的解释，说明用户的音乐偏好特点，以及这些偏好如何影响推荐结果。

偏好数据（权重从高到低）：
- 风格偏好：${topGenres}
- 乐器偏好：${topInstruments}
- 情绪偏好：${topMoods}
- 主题偏好：${topThemes}

权重说明：
- 正数表示偏好，数值越大偏好程度越高
- 负数表示不偏好，数值越小不偏好程度越高

要求：
1. 文字简洁优美、富有文采，用友好自然的语气
2. 突出用户最偏好的几个标签（权重最高的）
3. 简要说明这些偏好如何影响推荐（不必展开算法细节）
4. 长度控制在80-120字
5. 使用"你"来称呼用户，语气温暖、专业
6. 描述可视化时请用「偏好分布」「树状图」「图中的偏好」等表述
7. 文中若提到具体标签，请使用「英文 中文」格式，如 jazz 爵士、piano 钢琴。`;

      const cfg = getLLMConfig();
      /** 偏好解释（80-120 字），GPT-4o 等响应较慢，给足时间避免超时 */
      const PREFERENCE_EXPLANATION_TIMEOUT_MS = 70000;
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请根据以上偏好数据生成解释文本' },
          ],
          temperature: 0.7,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        {
          headers: cfg.headers,
          timeout: PREFERENCE_EXPLANATION_TIMEOUT_MS,
        }
      );

      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        throw new Error('AI助手返回了无效的响应');
      }
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      return getChoiceContent(response.data.choices[0], '根据您的听歌历史，系统已经学习到了您的音乐偏好，并会根据这些偏好为您推荐合适的歌曲。');
    } catch (error: any) {
      console.error('生成偏好解释失败:', error);
      return '根据您的听歌历史，系统已经学习到了您的音乐偏好，并会根据这些偏好为您推荐合适的歌曲。';
    }
  },

  /** 为什么推荐这首：根据推荐算法对这首歌的评分，用简洁优美的语言描述推荐理由；isColdStart 时语气更热情、简洁、优美 */
  async generateWhyThisTrack(
    whyData: {
      contentScore: number;
      behaviorScore: number;
      finalScore: number;
      matchedTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] };
      trackTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] };
    },
    trackName: string,
    artistName: string,
    isColdStart?: boolean
  ): Promise<string> {
    try {
      const matchedGenres = whyData.matchedTags.genres.map(tagWithChinese).join('、') || '无';
      const matchedInstruments = whyData.matchedTags.instruments.map(tagWithChinese).join('、') || '无';
      const matchedMoods = whyData.matchedTags.moods.map(tagWithChinese).join('、') || '无';
      const matchedThemes = whyData.matchedTags.themes.map(tagWithChinese).join('、') || '无';
      const trackGenres = whyData.trackTags.genres.map(tagWithChinese).join('、') || '无';
      const trackInstruments = whyData.trackTags.instruments.map(tagWithChinese).join('、') || '无';
      const trackMoods = whyData.trackTags.moods.map(tagWithChinese).join('、') || '无';
      const trackThemes = whyData.trackTags.themes.map(tagWithChinese).join('、') || '无';

      const coldStartHint = isColdStart ? '这是用户冷启动后第一首推荐（系统 B），请用热情、简洁、优美的语言描述推荐理由，让用户感到被懂、被欢迎。控制在约50字，语气热情、简洁、优美。' : '';
      const systemPrompt = `你是一个音乐推荐助手。用户想知道「为什么系统推荐了这首《${trackName}》- ${artistName}」。请根据推荐算法的评分数据，用简洁、优美的语言描述推荐理由，严格控制在约50字。${coldStartHint ? '\n\n' + coldStartHint : ''}

推荐算法数据：
- 内容匹配分数（与用户偏好标签的匹配度，权重60%）：${whyData.contentScore.toFixed(3)}
- 行为历史分数（与用户听歌行为的相似度，权重30%）：${whyData.behaviorScore.toFixed(3)}
- 综合得分：${whyData.finalScore.toFixed(3)}

这首歌的标签：风格 ${trackGenres}；乐器 ${trackInstruments}；情绪 ${trackMoods}；主题 ${trackThemes}。

与用户偏好的匹配：风格 ${matchedGenres}；乐器 ${matchedInstruments}；情绪 ${matchedMoods}；主题 ${matchedThemes}。

${SONG_DESCRIPTION_LAYERS}

要求：在解释「为什么这首适合你」时，可从声学层、情绪层、情境层自然带出这首歌的听感与适用场景；语气温暖、自然，不要罗列数字，严格控制在约50字。**描述中必须明确写出歌曲名《${trackName}》，例如开头写「《${trackName}》这首歌…」或文中自然带出歌名。** 文中若提到具体标签，请使用「英文 中文」格式，如 jazz 爵士、piano 钢琴。只返回解释文字。`;

      const cfg = getLLMConfig();
      // [场景：推荐解释] 为什么推荐这首（约 50 字），建议 256
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请描述为什么推荐这首《' + trackName + '》' },
          ],
          temperature: 0.7,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        {
          headers: cfg.headers,
        }
      );

      if (!response.data?.choices?.length) {
        throw new Error('AI助手返回了无效的响应');
      }
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      return getChoiceContent(response.data.choices[0], '这首歌与你的偏好和听歌习惯很契合，所以推荐给你。');
    } catch (error: any) {
      console.error('生成为什么推荐这首失败:', error);
      const cfg = getLLMConfig();
      const errMsg = error?.response?.data?.error?.message ?? error?.message ?? String(error);
      const status = error?.response?.status;
      const hint = openRouterErrorHint(errMsg, status);
      return `【LLM 调用失败】模型: ${cfg.model}，错误: ${errMsg}${hint}`;
    }
  },

  /** 为什么推荐这首（着重强调这首歌带给人的感觉、氛围、情绪），用于气泡展示 */
  async generateWhyThisTrackEmphasizeFeeling(
    whyData: {
      contentScore: number;
      behaviorScore: number;
      finalScore: number;
      matchedTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] };
      trackTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] };
    },
    trackName: string,
    artistName: string
  ): Promise<string> {
    try {
      const trackMoods = whyData.trackTags.moods.map(tagWithChinese).join('、') || '无';
      const trackThemes = whyData.trackTags.themes.map(tagWithChinese).join('、') || '无';
      const trackGenres = whyData.trackTags.genres.map(tagWithChinese).join('、') || '无';
      const trackInstruments = whyData.trackTags.instruments.map(tagWithChinese).join('、') || '无';

      const systemPrompt = `你是一个音乐推荐助手。请用 1～2 句话（约 40～80 字）描述这首《${trackName}》- ${artistName} 带给人的感觉。

这首歌的标签：风格 ${trackGenres}；乐器 ${trackInstruments}；情绪/氛围 ${trackMoods}；主题 ${trackThemes}。

${SONG_DESCRIPTION_LAYERS}

要求：将声学层、情绪层、情境层自然融合成一段话，语气温暖、有画面感，不要罗列数字或算法术语。文中若提到具体标签，请使用「英文 中文」格式，如 jazz 爵士。只返回这段描述。`;

      const cfg = getLLMConfig();
      // [场景：推荐解释] 这首歌带给人的感觉（40～80 字），建议 1024
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请描述这首歌带给人的感觉' },
          ],
          temperature: 0.7,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        {
          headers: cfg.headers,
        }
      );

      if (!response.data?.choices?.length) throw new Error('无效响应');
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      return getChoiceContent(response.data.choices[0], '这首歌的氛围和你的偏好很契合。');
    } catch (e) {
      console.warn('生成「这首歌的感觉」失败:', e);
      return '这首歌的氛围和你的偏好很契合。';
    }
  },

  /** 这首歌的感觉 → 精炼关键词（用于进度条气泡），有算法数据时 */
  async generateWhyThisTrackKeywords(
    whyData: {
      contentScore: number;
      behaviorScore: number;
      finalScore: number;
      matchedTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] };
      trackTags: { genres: string[]; instruments: string[]; moods: string[]; themes: string[] };
    },
    _trackName: string,
    _artistName: string
  ): Promise<string> {
    try {
      const trackMoods = whyData.trackTags.moods.map(tagWithChinese).join('、') || '无';
      const trackThemes = whyData.trackTags.themes.map(tagWithChinese).join('、') || '无';
      const trackGenres = whyData.trackTags.genres.map(tagWithChinese).join('、') || '无';
      const trackInstruments = whyData.trackTags.instruments.map(tagWithChinese).join('、') || '无';
      const systemPrompt = `你是一个音乐推荐助手。请将这首歌带给人的感觉提炼为最多 3 个精炼中文关键词（可从声学、情绪、情境等维度选取）。

这首歌的标签：风格 ${trackGenres}；乐器 ${trackInstruments}；情绪/氛围 ${trackMoods}；主题 ${trackThemes}。

要求：只输出一行关键词，用 · 连接，最多 3 个，不要句子、不要解释、不要数字。例如：氛围感·层次·沉静`;
      const cfg = getLLMConfig();
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请输出最多 3 个关键词，用 · 连接' },
          ],
          temperature: 0.5,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        { headers: cfg.headers }
      );
      if (!response.data?.choices?.length) throw new Error('无效响应');
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      const raw = getChoiceContent(response.data.choices[0], '氛围感·层次·沉静');
      const normalized = raw.replace(/\s*[，,、]\s*/g, '·').replace(/\s+/g, '·').replace(/·+/g, '·').replace(/^·|·$/g, '').trim() || '氛围感·层次·沉静';
      const keywords = normalized.split('·').filter(Boolean).slice(0, 3);
      return keywords.length ? keywords.join('·') : '氛围感·层次·沉静';
    } catch (e) {
      console.warn('生成「这首歌的感觉」关键词失败:', e);
      const g = (whyData.trackTags.genres || [])[0];
      const m = (whyData.trackTags.moods || [])[0];
      return [g ? tagWithChinese(g) : '氛围', m ? tagWithChinese(m) : '沉静', '层次'].join('·');
    }
  },

  /** 这首歌的感觉 → 精炼关键词（用于进度条气泡），无算法数据时兜底 */
  async generateWhyThisTrackFallbackKeywords(
    _trackName: string,
    _artistName: string,
    trackTags?: { genres?: string[]; instruments?: string[]; moods?: string[]; themes?: string[] } | null
  ): Promise<string> {
    try {
      const tagStr = trackTags
        ? `风格 ${(trackTags.genres || []).map(tagWithChinese).join('、') || '无'}；乐器 ${(trackTags.instruments || []).map(tagWithChinese).join('、') || '无'}；情绪/氛围 ${(trackTags.moods || []).map(tagWithChinese).join('、') || '无'}；主题 ${(trackTags.themes || []).map(tagWithChinese).join('、') || '无'}。`
        : '';
      const systemPrompt = `你是一个音乐推荐助手。请将这首歌带给人的感觉提炼为最多 3 个精炼中文关键词。${tagStr ? `\n这首歌的标签：${tagStr}\n` : ''}

要求：只输出一行关键词，用 · 连接，最多 3 个，不要句子、不要解释。例如：氛围感·层次·沉静`;
      const cfg = getLLMConfig();
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请输出最多 3 个关键词，用 · 连接' },
          ],
          temperature: 0.5,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        { headers: cfg.headers }
      );
      if (!response.data?.choices?.length) throw new Error('无效响应');
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      const raw = getChoiceContent(response.data.choices[0], '氛围感·层次·沉静');
      const normalized = raw.replace(/\s*[，,、]\s*/g, '·').replace(/\s+/g, '·').replace(/·+/g, '·').replace(/^·|·$/g, '').trim() || '氛围感·层次·沉静';
      const keywords = normalized.split('·').filter(Boolean).slice(0, 3);
      return keywords.length ? keywords.join('·') : '氛围感·层次·沉静';
    } catch (e) {
      console.warn('生成「这首歌的感觉」关键词兜底失败:', e);
      const g = (trackTags?.genres || [])[0];
      const m = (trackTags?.moods || [])[0];
      return [g ? tagWithChinese(g) : '氛围', m ? tagWithChinese(m) : '沉静', '层次'].join('·');
    }
  },

  /** 无算法数据时：仅根据歌名、歌手和标签生成「这首歌带给人的感觉」描述，用于气泡 */
  async generateWhyThisTrackFallbackEmphasizeFeeling(
    trackName: string,
    artistName: string,
    trackTags?: { genres?: string[]; instruments?: string[]; moods?: string[]; themes?: string[] } | null
  ): Promise<string> {
    try {
      const tagStr = trackTags
        ? `风格 ${(trackTags.genres || []).map(tagWithChinese).join('、') || '无'}；乐器 ${(trackTags.instruments || []).map(tagWithChinese).join('、') || '无'}；情绪/氛围 ${(trackTags.moods || []).map(tagWithChinese).join('、') || '无'}；主题 ${(trackTags.themes || []).map(tagWithChinese).join('、') || '无'}。`
        : '';
      const systemPrompt = `你是一个音乐推荐助手。请用 1～2 句话（约 40～80 字）描述这首《${trackName}》- ${artistName} 带给人的感觉。${tagStr ? `\n这首歌的标签：${tagStr}\n` : ''}

${SONG_DESCRIPTION_LAYERS}

要求：将声学层、情绪层、情境层自然融合成一段话，语气温暖、有画面感。只返回这段描述。`;
      const cfg = getLLMConfig();
      // [场景：推荐解释] 无算法数据时「这首歌带给人的感觉」兜底，建议 1024
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请描述这首歌带给人的感觉' },
          ],
          temperature: 0.7,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        {
          headers: cfg.headers,
        }
      );
      if (!response.data?.choices?.length) throw new Error('无效响应');
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      return getChoiceContent(response.data.choices[0], '这首歌的氛围和你的偏好很契合。');
    } catch (e) {
      console.warn('生成「这首歌的感觉」兜底失败:', e);
      return '这首歌的氛围和你的偏好很契合。';
    }
  },

  /** 无算法评分数据时的兜底：仅根据歌名、歌手和标签用 LLM 生成一句推荐理由 */
  async generateWhyThisTrackFallback(
    trackName: string,
    artistName: string,
    trackTags?: { genres?: string[]; instruments?: string[]; moods?: string[]; themes?: string[] } | null
  ): Promise<string> {
    try {
      const tagStr = trackTags
        ? `标签：风格 ${(trackTags.genres || []).map(tagWithChinese).join('、') || '无'}；乐器 ${(trackTags.instruments || []).map(tagWithChinese).join('、') || '无'}；情绪 ${(trackTags.moods || []).map(tagWithChinese).join('、') || '无'}；主题 ${(trackTags.themes || []).map(tagWithChinese).join('、') || '无'}。`
        : '';
      const systemPrompt = `你是一个音乐推荐助手。用户想知道「为什么系统可能推荐了这首《${trackName}》- ${artistName}」。${tagStr ? `\n${tagStr}\n` : ''}请用一句简洁、温暖的话（约50字）描述可能推荐这首的理由，不要编造具体数据。**描述中必须写出歌曲名《${trackName}》，例如「《${trackName}》这首歌…」。** 文中若提到具体标签，请使用「英文 中文」格式，如 jazz 爵士。只返回这一句话。`;
      const cfg = getLLMConfig();
      // [场景：推荐解释] 无算法数据时一句推荐理由兜底，建议 1024
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请用一句话说明为什么可能推荐这首《' + trackName + '》' },
          ],
          temperature: 0.7,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        {
          headers: cfg.headers,
        }
      );
      if (!response.data?.choices?.length) throw new Error('无效响应');
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      return getChoiceContent(response.data.choices[0], '这首歌与你的听歌偏好很契合，所以推荐给你。');
    } catch (e: any) {
      console.error('生成为什么推荐这首（兜底）失败:', e);
      const cfg = getLLMConfig();
      const errMsg = e?.response?.data?.error?.message ?? e?.message ?? String(e);
      const status = e?.response?.status;
      const hint = openRouterErrorHint(errMsg, status);
      return `【LLM 调用失败】模型: ${cfg.model}，错误: ${errMsg}${hint}`;
    }
  },

  // 生成多样性推荐介绍：简洁说明这是多样性推荐、目的、这首歌与之前不同
  async generateDiversityIntroduction(trackInfo: TrackInfo): Promise<string> {
    const fallback = `【多样性推荐】为了拓宽你的听歌范围，这次推荐了一首与之前风格不同的歌《${trackInfo.name}》，希望带给你新鲜感。`;
    try {
      const systemPrompt = `你是一个音乐推荐助手。用户已连续听了多首推荐歌，系统做了一次**多样性推荐**：选了一首用户没表达过厌恶、但也没展示过喜爱的风格的歌，**目的是拓宽听歌范围、让你尝试新风格**。这首歌与用户之前听的不一样。

歌曲信息：
- 名称：${trackInfo.name}
- 艺术家：${trackInfo.artist}
- 标签：风格 ${(trackInfo.tags?.genres || []).map(tagWithChinese).join('、') || '无'}；乐器 ${(trackInfo.tags?.instruments || []).map(tagWithChinese).join('、') || '无'}；情绪 ${(trackInfo.tags?.moods || []).map(tagWithChinese).join('、') || '无'}；主题 ${(trackInfo.tags?.themes || []).map(tagWithChinese).join('、') || '无'}

请用简洁、易读的一句话（不超过 60 字）写「根据**」式介绍，必须包含三点：
1. 点明这是**多样性推荐**（文案中必须出现「多样性」二字，建议以「【多样性推荐】」开头）。
2. 简短说明**目的**（如：拓宽听歌范围 / 让你尝试新风格）。
3. 说明**这首歌与之前听的不一样**（风格不同 / 换换口味等）。

示例："【多样性推荐】根据「拓宽听歌范围」做的推荐，这首《xxx》与之前听的风格不同，希望带给你新鲜感。"
只返回介绍文字，不要其他内容。`;

      const cfg = getLLMConfig();
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请生成多样性推荐介绍' },
          ],
          temperature: 0.7,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        { headers: cfg.headers }
      );

      if (!response.data?.choices?.length) throw new Error('AI助手返回了无效的响应');
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      const raw = getChoiceContent(response.data.choices[0], fallback);
      const trimmed = (raw || '').trim();
      if (trimmed && !trimmed.includes('多样性')) return `【多样性推荐】${trimmed}`;
      return trimmed || fallback;
    } catch (error: any) {
      console.error('生成多样性推荐介绍失败:', error);
      return fallback;
    }
  },

  /** 获取推荐算法文档内容（用于回答「怎么推荐的」等问题） */
  async getRecommendationAlgorithmDoc(): Promise<string> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/docs/recommendation-algorithm`);
      if (!response.ok) return '';
      const data = await response.json();
      return data.success && typeof data.content === 'string' ? data.content : '';
    } catch (e) {
      console.warn('获取推荐算法文档失败:', e);
      return '';
    }
  },

  /** 根据算法文档和用户问题，用 LLM 生成回答 */
  async generateAnswerFromAlgorithmDoc(docContent: string, userQuestion: string): Promise<string> {
    if (!docContent.trim()) {
      return '推荐系统会结合你的偏好标签（风格、乐器、情绪等）和听歌行为（评分、时长、收藏）计算每首歌的匹配度，优先推荐匹配度高的歌曲。如果你想了解更细节，可以查看系统内的算法设计文档。';
    }
    const truncated = docContent.length > 8000 ? docContent.slice(0, 8000) + '\n...(文档有省略)' : docContent;
    try {
      const systemPrompt = `你是音乐推荐小助手 Seren。用户问了一个关于「推荐是怎么做的」的问题。请严格根据下面的《推荐算法设计文档》内容，用简洁、易懂的中文回答用户，不要编造文档里没有的内容。语气友好，控制在 200 字以内为宜。

《推荐算法设计文档》：
${truncated}`;

      const cfg = getLLMConfig();
      // [场景：其它] 根据算法文档生成回答（推荐原理/怎么推荐等），建议 1024
      const response = await axios.post(
        cfg.url,
        {
          model: cfg.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userQuestion },
          ],
          temperature: 0.5,
          max_tokens: cfg.maxTokens,
          max_completion_tokens: cfg.maxTokens,
        },
        {
          headers: cfg.headers,
        }
      );

      if (!response.data?.choices?.length) throw new Error('无效响应');
      appendSystemLog(`[LLM] 本次调用模型: ${cfg.model}`);
      return getChoiceContent(response.data.choices[0], '推荐会结合你的偏好和听歌行为来匹配歌曲，具体逻辑可以查看算法文档。');
    } catch (e) {
      console.warn('根据算法文档生成回答失败:', e);
      return '推荐系统会结合你的偏好和听歌行为计算匹配度来推荐歌曲。如需了解细节可查看算法设计文档。';
    }
  },
};
