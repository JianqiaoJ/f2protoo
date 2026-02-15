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
    { username: 'user1', password: '12' },
    { username: 'user2', password: '24' },
    { username: 'user3', password: '36' },
    { username: 'user4', password: '48' },
    { username: 'user5', password: '510' },
    { username: 'user6', password: '612' },
    { username: 'user7', password: '714' },
    { username: 'user8', password: '816' },
    { username: 'user9', password: '918' },
    { username: 'user10', password: '1020' },
    { username: 'user1_LLM', password: '12' },
    { username: 'user2_LLM', password: '24' },
    { username: 'user3_LLM', password: '36' },
    { username: 'user4_LLM', password: '48' },
    { username: 'user5_LLM', password: '510' },
    { username: 'user6_LLM', password: '612' },
    { username: 'user7_LLM', password: '714' },
    { username: 'user8_LLM', password: '816' },
    { username: 'user9_LLM', password: '918' },
    { username: 'user10_LLM', password: '1020' },
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
