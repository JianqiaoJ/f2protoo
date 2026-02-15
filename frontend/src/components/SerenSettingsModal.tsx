import { getSerenLLMProvider, setSerenLLMProvider, type LLMProvider } from '../utils/storage';
import { getModelNameForProvider } from '../api/aiAssistant';

interface SerenSettingsModalProps {
  onClose: () => void;
}

const PROVIDERS: { id: LLMProvider; label: string }[] = [
  { id: 'deepseek', label: 'DeepSeek Chat' },
  { id: 'deepseek_reason', label: 'DeepSeek Reason' },
  { id: 'gemini_25', label: 'Gemini 2.5 Pro' },
  { id: 'gemini', label: 'Gemini 3 Pro' },
  { id: 'gemini_3_flash', label: 'Gemini 3 Flash' },
  { id: 'chatgpt4o', label: 'ChatGPT 4o' },
  { id: 'chatgpt5', label: 'ChatGPT 5.2' },
  { id: 'qwen', label: 'Qwen3 Max Thinking' },
  { id: 'kimi_k2_5', label: 'Kimi K2.5' },
];

export default function SerenSettingsModal({ onClose }: SerenSettingsModalProps) {
  const current = getSerenLLMProvider();

  const handleSelect = (provider: LLMProvider) => {
    setSerenLLMProvider(provider);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl border border-gray-200 p-4 w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Seren 对话模型</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-3">选择后立即生效，用于 Seren 对话与各类文案生成。</p>
        <div className="space-y-1.5">
          {PROVIDERS.map((p) => {
            const isSelected = current === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelect(p.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                  isSelected
                    ? 'border-transparent text-white'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
                style={isSelected ? { background: 'linear-gradient(135deg, #D8CECF 0%, #91738B 100%)' } : undefined}
              >
                <span className="text-sm font-medium">{p.label}</span>
                <span className={`text-xs shrink-0 ${isSelected ? 'text-white/90' : 'text-gray-500'}`}>
                  {getModelNameForProvider(p.id)}
                </span>
                {isSelected && (
                  <svg className="w-4 h-4 text-white shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
