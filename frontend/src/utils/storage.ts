// 获取当前登录用户的用户名
export const getCurrentUser = (): string | null => {
  return localStorage.getItem('currentUser');
};

// 获取用户相关的存储key
export const getUserStorageKey = (baseKey: string): string => {
  const user = getCurrentUser();
  if (!user) {
    return baseKey;
  }
  return `${baseKey}-${user}`;
};

// 清除指定用户的所有数据（含当前会话 ID，冷启动后对话表重新开始）
export const clearUserData = (username: string) => {
  const keys = [
    `jamendo-player-storage-${username}`,
    `ai-assistant-messages-${username}`,
    `conversation_session_id-${username}`,
  ];

  keys.forEach(key => {
    localStorage.removeItem(key);
  });
};

const SESSION_ID_KEY_PREFIX = 'conversation_session_id-';

/** 获取或创建当前用户的对话 session_id（冷启动/清除后会重新生成） */
export const getOrCreateConversationSessionId = (): string => {
  const user = getCurrentUser();
  if (!user) return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const key = `${SESSION_ID_KEY_PREFIX}${user}`;
  let sid = localStorage.getItem(key);
  if (!sid) {
    sid = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(key, sid);
  }
  return sid;
};

// 清除当前用户的所有数据（用于清除记录功能）
export const clearCurrentUserData = () => {
  const currentUser = getCurrentUser();
  if (currentUser) {
    clearUserData(currentUser);
    return true;
  }
  return false;
};

// 清除所有用户数据（用于测试或重置）
export const clearAllUserData = () => {
  const currentUser = getCurrentUser();
  if (currentUser) {
    clearUserData(currentUser);
  }
};

/** Seren 使用的 LLM 提供商 */
export type LLMProvider = 'deepseek' | 'deepseek_reason' | 'gemini_25' | 'gemini' | 'gemini_3_flash' | 'chatgpt4o' | 'chatgpt5' | 'qwen' | 'kimi_k2_5';

const SEREN_LLM_PROVIDER_KEY = 'seren-llm-provider';

const VALID_PROVIDERS: LLMProvider[] = ['deepseek', 'deepseek_reason', 'gemini_25', 'gemini', 'gemini_3_flash', 'chatgpt4o', 'chatgpt5', 'qwen', 'kimi_k2_5'];

/** 系统 B 默认 DeepSeek Reason；系统 A 默认 DeepSeek Chat */
export const getDefaultSerenLLMProvider = (system: 'A' | 'B'): LLMProvider =>
  system === 'B' ? 'deepseek_reason' : 'deepseek';

export const getSerenLLMProvider = (): LLMProvider => {
  const v = localStorage.getItem(SEREN_LLM_PROVIDER_KEY);
  if (v && VALID_PROVIDERS.includes(v as LLMProvider)) return v as LLMProvider;
  return 'deepseek';
};

export const setSerenLLMProvider = (provider: LLMProvider) => {
  localStorage.setItem(SEREN_LLM_PROVIDER_KEY, provider);
};
