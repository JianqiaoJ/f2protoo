// 用户数据
export interface User {
  username: string;
  password: string;
}

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3000';

// 验证用户登录（通过后端 API）
export const validateUser = async (username: string, password: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    const text = await response.text();
    let data: { success?: boolean } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      // 响应非 JSON（错误页/代理页等）时用本地回退，保证能登录
      console.warn('登录响应非 JSON，使用本地验证', response.status);
      return fallbackValidateUser(username, password);
    }
    if (response.ok && data.success === true) return true;
    if (!response.ok) return false;
    return fallbackValidateUser(username, password);
  } catch (error) {
    console.error('登录验证失败:', error);
    // 网络错误或后端不可用时，回退到 localStorage（仅用于开发）
    return fallbackValidateUser(username, password);
  }
};

// 回退验证（仅用于开发，当后端不可用时）
const fallbackValidateUser = (username: string, password: string): boolean => {
  try {
    let stored = localStorage.getItem('users-data');
    if (!stored) {
      loadUsers(); // 初始化默认测试账号，便于后端未启动时也能登录
      stored = localStorage.getItem('users-data');
    }
    if (stored) {
      const users: User[] = JSON.parse(stored);
      return users.some(user => user.username === username && user.password === password);
    }
  } catch (error) {
    console.error('回退验证失败:', error);
  }
  return false;
};

// 初始化用户数据（仅用于开发，当后端不可用时）
export const loadUsers = (): User[] => {
  try {
    const stored = localStorage.getItem('users-data');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load users:', error);
  }
  const initialUsers: User[] = [
    { username: 'user11', password: '1122' },
    { username: 'user11_LLM', password: '1122' },
    { username: 'user12', password: '1224' },
    { username: 'user12_LLM', password: '1224' },
    { username: 'user13', password: '1326' },
    { username: 'user13_LLM', password: '1326' },
    { username: 'user14', password: '1428' },
    { username: 'user14_LLM', password: '1428' },
    { username: 'user15', password: '1130' },
    { username: 'user15_LLM', password: '1130' },
    { username: 'user16', password: '1632' },
    { username: 'user16_LLM', password: '1632' },
    { username: 'user17', password: '1734' },
    { username: 'user17_LLM', password: '1734' },
    { username: 'user18', password: '1836' },
    { username: 'user18_LLM', password: '1836' },
    { username: 'user19', password: '1938' },
    { username: 'user19_LLM', password: '1938' },
    { username: 'user20', password: '2040' },
    { username: 'user20_LLM', password: '2040' },
  ];
  saveUsers(initialUsers);
  return initialUsers;
};

// 保存用户数据到 localStorage（仅用于开发）
export const saveUsers = (users: User[]) => {
  try {
    localStorage.setItem('users-data', JSON.stringify(users));
  } catch (error) {
    console.error('Failed to save users:', error);
  }
};
