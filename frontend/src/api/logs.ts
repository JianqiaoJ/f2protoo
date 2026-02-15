/**
 * 前端上报日志到后端 logBuffer，同时写入前端日志列表供侧边栏「日志」tab 展示。
 * 并可将 console.log/info/warn/error 同时输出到该列表（与 terminal 一致）。
 */
import { create } from 'zustand';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3000';

const MAX_LOG_LINES = 500;

export interface LogLine {
  id: number;
  time: string;
  message: string;
  level?: 'log' | 'info' | 'warn' | 'error';
}

interface LogStoreState {
  lines: LogLine[];
  addLine: (message: string, level?: LogLine['level']) => void;
}

export const useLogStore = create<LogStoreState>((set) => ({
  lines: [],
  addLine: (message: string, level?: LogLine['level']) =>
    set((state) => {
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      const next = [...state.lines, { id: state.lines.length, time, message, level }];
      return { lines: next.slice(-MAX_LOG_LINES) };
    }),
}));

function addLogLine(message: string, level?: LogLine['level']) {
  useLogStore.getState().addLine(message, level);
}

export async function appendSystemLog(message: string): Promise<void> {
  addLogLine(message);
  try {
    await fetch(`${API_BASE_URL}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  } catch (_) {
    // 静默失败，不影响主流程
  }
}

/** 从服务端获取日志全文（与 GET /api/logs 返回内容一致，供日志 tab 展示） */
export async function fetchLogsFromServer(): Promise<string> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/logs`);
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

let consoleCaptureInitialized = false;

/** 将 console.log/info/warn/error 同时写入前端日志列表，与 terminal 输出一致。仅初始化一次。 */
export function initConsoleCapture(): void {
  if (consoleCaptureInitialized) return;
  consoleCaptureInitialized = true;

  const origLog = console.log;
  const origInfo = console.info;
  const origWarn = console.warn;
  const origError = console.error;

  const serialize = (args: unknown[]): string => {
    return args.map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' ');
  };

  console.log = (...args: unknown[]) => {
    addLogLine(serialize(args), 'log');
    origLog.apply(console, args);
  };
  console.info = (...args: unknown[]) => {
    addLogLine(serialize(args), 'info');
    origInfo.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    addLogLine(serialize(args), 'warn');
    origWarn.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    addLogLine(serialize(args), 'error');
    origError.apply(console, args);
  };
}
