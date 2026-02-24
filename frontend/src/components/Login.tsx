import { useState, useRef } from 'react';
import { validateUser } from '../data/users';
import { clearUserData, setSerenLLMProvider, getDefaultSerenLLMProvider } from '../utils/storage';
import { usePlayerStore } from '../store';

interface LoginProps {
  onLoginSuccess: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState<{ field: string; message: string } | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setValidationError(null);
    
    // 自定义验证
    if (!username.trim()) {
      setValidationError({ field: 'username', message: '请填写此字段。' });
      usernameRef.current?.focus();
      return;
    }
    if (!password.trim()) {
      setValidationError({ field: 'password', message: '请填写此字段。' });
      passwordRef.current?.focus();
      return;
    }
    
    setIsLoading(true);

    try {
      const isValid = await validateUser(username.trim(), password);
      if (!isValid) {
        setError('用户名或密码错误');
        setIsLoading(false);
        return;
      }
      // 先写登录态，再加载用户数据，最后切界面，避免热更新或异常导致卡在登录页
      const previousUser = localStorage.getItem('currentUser');
      if (previousUser && previousUser !== username.trim()) {
        clearUserData(previousUser);
      }
      localStorage.setItem('isLoggedIn', 'true');
      localStorage.setItem('currentUser', username.trim());
      const system = username.trim().includes('LLM') ? 'B' : 'A';
      usePlayerStore.getState().setCurrentSystem(system);
      setSerenLLMProvider(getDefaultSerenLLMProvider(system));
      try {
        usePlayerStore.getState().hydrateFromStorage();
      } catch (e) {
        console.warn('hydrateFromStorage 失败，继续进入应用', e);
      }
      onLoginSuccess();
    } catch (error) {
      setError('登录失败，请检查网络连接');
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-md px-8">
        <div className="text-center mb-8">
          <img 
            src="/serenlogo.png" 
            alt="Seren Logo" 
            className="mx-auto mb-2 max-w-xs h-auto"
          />
        </div>

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <div className="relative">
            <input
              ref={usernameRef}
              id="username"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (validationError?.field === 'username') {
                  setValidationError(null);
                }
              }}
              placeholder="请输入用户名"
              className="w-full px-4 py-1.5 text-sm border border-gray-300 rounded-lg bg-gray-100 focus:outline-none focus:border-gray-400"
              autoFocus
            />
            {validationError?.field === 'username' && (
              <div className="absolute top-full left-0 mt-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg shadow-lg whitespace-nowrap z-50 animate-pulse">
                {validationError.message}
                <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-800 transform rotate-45"></div>
              </div>
            )}
          </div>

          <div className="relative">
            <input
              ref={passwordRef}
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (validationError?.field === 'password') {
                  setValidationError(null);
                }
              }}
              placeholder="请输入密码"
              className="w-full px-4 py-1.5 text-sm border border-gray-300 rounded-lg bg-gray-100 focus:outline-none focus:border-gray-400"
            />
            {validationError?.field === 'password' && (
              <div className="absolute top-full left-0 mt-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg shadow-lg whitespace-nowrap z-50 animate-pulse">
                {validationError.message}
                <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-800 transform rotate-45"></div>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="mx-auto block px-6 py-1.5 rounded-lg bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
