import express from 'express';
import cors from 'cors';
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DEBUG_LOG_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../.cursor/debug.log');
function debugLog(payload) {
  try {
    appendFileSync(DEBUG_LOG_PATH, JSON.stringify({ ...payload, timestamp: Date.now() }) + '\n');
  } catch (_) {}
}
import { generateRecommendations, getTrackTagsMap, getTrackRecommendationReason, getTrackRecommendationReasonFromTags, getCombinedPreferences, getTrackTagsByAnyId, loadTrackTagsAsync } from './recommender.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 格式化时间戳（用于日志等展示）
function getTimestamp() {
  const now = new Date();
  return now.toLocaleString('zh-CN', { 
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

// 数据库写入时间统一使用北京时间 (UTC+8)，与系统时间一致
const DB_NOW = "datetime('now', '+8 hours')";
// 整数时间戳列（Unix 秒），用于时间列旁边的 timestamp 列
const DB_UNIX = "strftime('%s', 'now')";

const app = express();
const PORT = 3000;

// 系统日志缓冲：控制台里发的文字在这里再发一份，供前端「系统日志」tab 原样展示
const LOG_BUFFER_MAX = 2000;
const logBuffer = [];
function pushToLogBuffer(text) {
  if (!text || typeof text !== 'string') return;
  const lines = text.split('\n').map((s) => s.trimEnd()).filter((s) => s.length > 0);
  const ts = getTimestamp();
  lines.forEach((line) => {
    logBuffer.push(`[${ts}] ${line}`);
    if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  });
}
const origStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (chunk, encodingOrCb, cb) {
  const str = typeof chunk === 'string' ? chunk : (chunk && chunk.toString ? chunk.toString() : String(chunk));
  pushToLogBuffer(str);
  return origStdoutWrite.apply(process.stdout, arguments);
};
const origStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = function (chunk, encodingOrCb, cb) {
  const str = typeof chunk === 'string' ? chunk : (chunk && chunk.toString ? chunk.toString() : String(chunk));
  pushToLogBuffer(str);
  return origStderrWrite.apply(process.stderr, arguments);
};

// 中间件
app.use(cors());
app.use(express.json());

// 数据库文件路径
const dbPath = join(__dirname, 'users.db');

// 初始用户（与 init-db.js 一致），用于新建库插入、已有库补全缺失用户
const INITIAL_USERS = [
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

function ensureInitialUsers() {
  if (!db) return;
  try {
    const ins = db.prepare('INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)');
    for (const u of INITIAL_USERS) {
      ins.run([u.username, u.password]);
    }
    ins.free();
    saveDatabase();
  } catch (e) {
    console.error('补全初始用户失败:', e.message);
  }
}

// 加载数据库
let SQL;
let db;

async function loadDatabase() {
  SQL = await initSqlJs();
  try {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
    console.log('数据库加载成功');
    
    // 确保用户听歌行为表存在
    db.run(`
      CREATE TABLE IF NOT EXISTS user_listening_behavior (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        timestamp_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        username TEXT NOT NULL,
        track_name TEXT NOT NULL,
        artist_name TEXT NOT NULL,
        track_id TEXT NOT NULL,
        listen_duration INTEGER DEFAULT 0,
        is_favorited INTEGER DEFAULT 0,
        rating INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    
    // 确保用户偏好表存在
    db.run(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        genres TEXT DEFAULT '[]',
        instruments TEXT DEFAULT '[]',
        moods TEXT DEFAULT '[]',
        themes TEXT DEFAULT '[]',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    // 用户偏好更新记录表：更新时间、原tag、新tag、操作类型、会话内容（对话时）
    db.run(`
      CREATE TABLE IF NOT EXISTS user_preference_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        tag_category TEXT NOT NULL,
        old_tags TEXT NOT NULL,
        new_tags TEXT NOT NULL,
        operation TEXT NOT NULL,
        conversation_content TEXT
      )
    `);
    // 为 user_preferences 添加每个 tag 的权重列（已有库迁移）
    ['genres_weights', 'instruments_weights', 'moods_weights', 'themes_weights'].forEach((col) => {
      try {
        db.run(`ALTER TABLE user_preferences ADD COLUMN ${col} TEXT DEFAULT '{}'`);
      } catch (e) {
        if (!/duplicate column name/i.test(e.message)) throw e;
      }
    });
    // 用户与系统对话记录表（冷启动时清空）
    db.run(`
      CREATE TABLE IF NOT EXISTS user_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        sender TEXT NOT NULL,
        content TEXT NOT NULL,
        sequence_no INTEGER NOT NULL
      )
    `);
    // 对话历史表：永不删除，仅追加
    db.run(`
      CREATE TABLE IF NOT EXISTS user_conversations_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        sender TEXT NOT NULL,
        content TEXT NOT NULL,
        sequence_no INTEGER NOT NULL
      )
    `);
    // 已推荐过的曲目：该用户历史上被推荐过的 track_id，下次不再推荐
    db.run(`
      CREATE TABLE IF NOT EXISTS user_recommended_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        track_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(username, track_id)
      )
    `);
    // 待播列表：按顺序播放，播放到倒数第二首时自动追加 3 首
    db.run(`
      CREATE TABLE IF NOT EXISTS user_playlist (
        username TEXT PRIMARY KEY,
        track_ids TEXT NOT NULL DEFAULT '[]',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at_timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    // 系统眼中的你：每次用户请求时的请求时间、返回文字、treemap tag 与权重
    db.run(`
      CREATE TABLE IF NOT EXISTS user_system_eyes_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        system_type TEXT NOT NULL DEFAULT 'A',
        requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        requested_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        explanation_text TEXT,
        treemap_data TEXT
      )
    `);
    // 气泡展示记录：展示时间、气泡类型、是否被点击、当时气泡内容
    db.run(`
      CREATE TABLE IF NOT EXISTS bubble_display_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        shown_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        shown_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        bubble_type TEXT NOT NULL,
        was_clicked INTEGER NOT NULL DEFAULT 0,
        content TEXT
      )
    `);
    // 对话框按钮记录：展示的按钮（文字）、是否被点击、点击后的下一个文字
    db.run(`
      CREATE TABLE IF NOT EXISTS dialog_button_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        session_id TEXT NOT NULL,
        message_sequence_no INTEGER NOT NULL,
        shown_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        shown_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        buttons_json TEXT NOT NULL,
        clicked_button_label TEXT,
        clicked_button_action TEXT,
        next_text_after_click TEXT
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS why_this_track_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
        created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        username TEXT NOT NULL,
        track_id TEXT,
        track_name TEXT,
        explanation TEXT NOT NULL
      )
    `);
    // 已有库：补全缺失的初始用户（user4–user10），不覆盖已有数据
    ensureInitialUsers();
    ensureSystemTypeMigration();
    ensureTimestampColumns();
  } catch (error) {
    // 如果数据库文件不存在，创建新数据库
    db = new SQL.Database();
    console.log('创建新数据库');
    
    // 创建用户表
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // 创建用户听歌行为表
    db.run(`
      CREATE TABLE IF NOT EXISTS user_listening_behavior (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        username TEXT NOT NULL,
        track_name TEXT NOT NULL,
        artist_name TEXT NOT NULL,
        track_id TEXT NOT NULL,
        listen_duration INTEGER DEFAULT 0,
        is_favorited INTEGER DEFAULT 0,
        rating INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    
    // 创建用户偏好表（含每个 tag 的权重分数列）
    db.run(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        genres TEXT DEFAULT '[]',
        instruments TEXT DEFAULT '[]',
        moods TEXT DEFAULT '[]',
        themes TEXT DEFAULT '[]',
        genres_weights TEXT DEFAULT '{}',
        instruments_weights TEXT DEFAULT '{}',
        moods_weights TEXT DEFAULT '{}',
        themes_weights TEXT DEFAULT '{}',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    // 用户偏好更新记录表
    db.run(`
      CREATE TABLE IF NOT EXISTS user_preference_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        tag_category TEXT NOT NULL,
        old_tags TEXT NOT NULL,
        new_tags TEXT NOT NULL,
        operation TEXT NOT NULL,
        conversation_content TEXT
      )
    `);
    // 用户与系统对话记录表
    db.run(`
      CREATE TABLE IF NOT EXISTS user_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        sender TEXT NOT NULL,
        content TEXT NOT NULL,
        sequence_no INTEGER NOT NULL
      )
    `);
    // 已推荐过的曲目：该用户历史上被推荐过的 track_id，下次不再推荐
    db.run(`
      CREATE TABLE IF NOT EXISTS user_recommended_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        track_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(username, track_id)
      )
    `);
    // 待播列表：按顺序播放，播放到倒数第二首时自动追加 3 首
    db.run(`
      CREATE TABLE IF NOT EXISTS user_playlist (
        username TEXT PRIMARY KEY,
        track_ids TEXT NOT NULL DEFAULT '[]',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at_timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS user_system_eyes_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        system_type TEXT NOT NULL DEFAULT 'A',
        requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        requested_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        explanation_text TEXT,
        treemap_data TEXT
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS bubble_display_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        shown_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        shown_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        bubble_type TEXT NOT NULL,
        was_clicked INTEGER NOT NULL DEFAULT 0,
        content TEXT
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS dialog_button_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        session_id TEXT NOT NULL,
        message_sequence_no INTEGER NOT NULL,
        shown_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        shown_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        buttons_json TEXT NOT NULL,
        clicked_button_label TEXT,
        clicked_button_action TEXT,
        next_text_after_click TEXT
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS why_this_track_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at DATETIME DEFAULT (datetime('now', '+8 hours')),
        created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        username TEXT NOT NULL,
        track_id TEXT,
        track_name TEXT,
        explanation TEXT NOT NULL
      )
    `);

    ensureInitialUsers();
    ensureSystemTypeMigration();
    ensureTimestampColumns();
    // 新创建的数据库立即写入磁盘，否则文件不存在时数据只存在内存中
    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
    console.log('已创建并保存新数据库文件:', dbPath);
  }
}

// 为 A/B 实验：为所有用户表增加 system_type 维度（A/B）
function ensureSystemTypeMigration() {
  if (!db) return;
  const run = (sql) => { try { db.run(sql); } catch (e) { if (!/duplicate column name|already exists/i.test(e.message)) console.warn('Migration:', e.message); } };
  run(`ALTER TABLE user_listening_behavior ADD COLUMN system_type TEXT DEFAULT 'A'`);
  run(`ALTER TABLE user_preference_updates ADD COLUMN system_type TEXT DEFAULT 'A'`);
  run(`ALTER TABLE user_conversations ADD COLUMN system_type TEXT DEFAULT 'A'`);
  run(`ALTER TABLE user_conversations_history ADD COLUMN system_type TEXT DEFAULT 'A'`);
  run(`ALTER TABLE user_recommended_tracks ADD COLUMN system_type TEXT DEFAULT 'A'`);
  // user_preferences: 需 (username, system_type) 唯一，迁移到新表
  try {
    let hasSystemType = false;
    try {
      db.exec("SELECT system_type FROM user_preferences LIMIT 1");
      hasSystemType = true;
    } catch (_) {}
    if (!hasSystemType) {
      db.run(`CREATE TABLE user_preferences_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        system_type TEXT NOT NULL DEFAULT 'A',
        genres TEXT DEFAULT '[]',
        instruments TEXT DEFAULT '[]',
        moods TEXT DEFAULT '[]',
        themes TEXT DEFAULT '[]',
        genres_weights TEXT DEFAULT '{}',
        instruments_weights TEXT DEFAULT '{}',
        moods_weights TEXT DEFAULT '{}',
        themes_weights TEXT DEFAULT '{}',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(username, system_type)
      )`);
      db.run(`INSERT INTO user_preferences_new (id, username, system_type, genres, instruments, moods, themes, genres_weights, instruments_weights, moods_weights, themes_weights, updated_at, updated_at_timestamp, created_at, created_at_timestamp)
        SELECT id, username, 'A', genres, instruments, moods, themes, genres_weights, instruments_weights, moods_weights, themes_weights, updated_at, strftime('%s', updated_at), created_at, strftime('%s', created_at) FROM user_preferences`);
      db.run(`DROP TABLE user_preferences`);
      db.run(`ALTER TABLE user_preferences_new RENAME TO user_preferences`);
      console.log('Migrated user_preferences to (username, system_type)');
    }
  } catch (e) {
    if (!/no such table|duplicate column/i.test(e.message)) console.warn('user_preferences migration:', e.message);
  }
  // user_playlist: 需 (username, system_type) 主键
  try {
    let hasSystemType = false;
    try {
      db.exec("SELECT system_type FROM user_playlist LIMIT 1");
      hasSystemType = true;
    } catch (_) {}
    if (!hasSystemType) {
      db.run(`CREATE TABLE user_playlist_new (
        username TEXT NOT NULL,
        system_type TEXT NOT NULL DEFAULT 'A',
        track_ids TEXT NOT NULL DEFAULT '[]',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at_timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (username, system_type)
      )`);
      db.run(`INSERT INTO user_playlist_new (username, system_type, track_ids, updated_at, updated_at_timestamp)
        SELECT username, 'A', track_ids, updated_at, strftime('%s', updated_at) FROM user_playlist`);
      db.run(`DROP TABLE user_playlist`);
      db.run(`ALTER TABLE user_playlist_new RENAME TO user_playlist`);
      console.log('Migrated user_playlist to (username, system_type)');
    }
  } catch (e) {
    if (!/no such table|duplicate column/i.test(e.message)) console.warn('user_playlist migration:', e.message);
  }
  saveDatabase();
}

// 为所有时间列旁边加一列 timestamp（整数 Unix 秒）
function ensureTimestampColumns() {
  if (!db) return;
  const run = (sql) => { try { db.run(sql); } catch (e) { if (!/duplicate column name|already exists/i.test(e.message)) console.warn('Timestamp migration:', e.message); } };
  // users
  run(`ALTER TABLE users ADD COLUMN created_at_timestamp INTEGER`);
  run(`UPDATE users SET created_at_timestamp = strftime('%s', created_at) WHERE created_at_timestamp IS NULL AND created_at IS NOT NULL`);
  // user_listening_behavior
  run(`ALTER TABLE user_listening_behavior ADD COLUMN timestamp_timestamp INTEGER`);
  run(`ALTER TABLE user_listening_behavior ADD COLUMN created_at_timestamp INTEGER`);
  run(`UPDATE user_listening_behavior SET timestamp_timestamp = strftime('%s', timestamp) WHERE timestamp_timestamp IS NULL AND timestamp IS NOT NULL`);
  run(`UPDATE user_listening_behavior SET created_at_timestamp = strftime('%s', created_at) WHERE created_at_timestamp IS NULL AND created_at IS NOT NULL`);
  // user_preferences
  run(`ALTER TABLE user_preferences ADD COLUMN updated_at_timestamp INTEGER`);
  run(`ALTER TABLE user_preferences ADD COLUMN created_at_timestamp INTEGER`);
  run(`UPDATE user_preferences SET updated_at_timestamp = strftime('%s', updated_at) WHERE updated_at_timestamp IS NULL AND updated_at IS NOT NULL`);
  run(`UPDATE user_preferences SET created_at_timestamp = strftime('%s', created_at) WHERE created_at_timestamp IS NULL AND created_at IS NOT NULL`);
  // user_preference_updates
  run(`ALTER TABLE user_preference_updates ADD COLUMN updated_at_timestamp INTEGER`);
  run(`UPDATE user_preference_updates SET updated_at_timestamp = strftime('%s', updated_at) WHERE updated_at_timestamp IS NULL AND updated_at IS NOT NULL`);
  // user_recommended_tracks
  run(`ALTER TABLE user_recommended_tracks ADD COLUMN created_at_timestamp INTEGER`);
  run(`UPDATE user_recommended_tracks SET created_at_timestamp = strftime('%s', created_at) WHERE created_at_timestamp IS NULL AND created_at IS NOT NULL`);
  // user_playlist
  run(`ALTER TABLE user_playlist ADD COLUMN updated_at_timestamp INTEGER`);
  run(`UPDATE user_playlist SET updated_at_timestamp = strftime('%s', updated_at) WHERE updated_at_timestamp IS NULL AND updated_at IS NOT NULL`);
  // user_conversations
  run(`ALTER TABLE user_conversations ADD COLUMN created_at_timestamp INTEGER`);
  run(`UPDATE user_conversations SET created_at_timestamp = strftime('%s', created_at) WHERE created_at_timestamp IS NULL AND created_at IS NOT NULL`);
  run(`ALTER TABLE user_conversations ADD COLUMN message_buttons TEXT`);
  run(`ALTER TABLE user_conversations ADD COLUMN user_button_choice TEXT`);
  // user_conversations_history
  run(`ALTER TABLE user_conversations_history ADD COLUMN created_at_timestamp INTEGER`);
  run(`UPDATE user_conversations_history SET created_at_timestamp = strftime('%s', created_at) WHERE created_at_timestamp IS NULL AND created_at IS NOT NULL`);
  run(`ALTER TABLE user_conversations_history ADD COLUMN message_buttons TEXT`);
  run(`ALTER TABLE user_conversations_history ADD COLUMN user_button_choice TEXT`);
  saveDatabase();
}

// 保存数据库
function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error('保存数据库失败:', err);
  }
}

// 初始化数据库 → 异步加载推荐 TSV（避免首请求卡死）→ 再启动 HTTP
loadDatabase()
  .then(() => {
    console.log('正在加载推荐数据（raw.tsv）...');
    return loadTrackTagsAsync();
  })
  .then(() => {
    const HOST = process.env.HOST || '0.0.0.0';
    app.listen(PORT, HOST, () => {
      console.log(`服务器运行在 http://${HOST}:${PORT}`);
      console.log(`数据库文件位置: ${dbPath}`);
      console.log('系统日志：此处输出会同步到前端的「系统日志」tab');
    });
  })
  .catch((err) => {
    console.error('启动失败:', err);
    process.exit(1);
  });

// 系统日志（供前端「系统日志」tab 原样展示 terminal 日志）
app.get('/api/logs', (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(logBuffer.join('\n'));
  } catch (e) {
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
});

// 前端上报日志（推荐日志、用户偏好更新等）写入 logBuffer，在系统日志 tab 展示
app.post('/api/logs', (req, res) => {
  try {
    const { message } = req.body || {};
    if (message != null && typeof message === 'string') {
      pushToLogBuffer(message);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: '写入日志失败' });
  }
});

// 验证用户登录
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
  }

  const stmt = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?');
  stmt.bind([username, password]);
  
  let user = null;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    user = {
      id: row.id,
      username: row.username,
      password: row.password
    };
  }
  stmt.free();

  if (user) {
    res.json({ 
      success: true, 
      message: '登录成功',
      user: { username: user.username, id: user.id }
    });
  } else {
    res.status(401).json({ success: false, message: '用户名或密码错误' });
  }
});

// 获取所有用户（仅用于测试，生产环境应该移除或添加权限验证）
app.get('/api/users', (req, res) => {
  const result = db.exec('SELECT id, username, created_at FROM users');
  const users = result.length > 0 
    ? result[0].values.map(row => ({
        id: row[0],
        username: row[1],
        created_at: row[2]
      }))
    : [];
  res.json({ success: true, users });
});

// 添加新用户
app.post('/api/users', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
  }

  try {
    const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    stmt.run([username, password]);
    const lastId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    stmt.free();
    saveDatabase();
    
    res.json({ 
      success: true, 
      message: '用户创建成功',
      user: { id: lastId, username }
    });
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE constraint')) {
      res.status(409).json({ success: false, message: '用户名已存在' });
    } else {
      res.status(500).json({ success: false, message: '创建用户失败' });
    }
  }
});

// 记录用户听歌行为
app.post('/api/behavior/log', (req, res) => {
  const { username, system_type: systemType, track_name, artist_name, track_id, listen_duration, is_favorited, rating } = req.body;
  const sys = (systemType === 'B' ? 'B' : 'A');

  if (!username || !track_name || !artist_name || !track_id) {
    return res.status(400).json({ success: false, message: '必填字段不能为空' });
  }

  if (!db) {
    console.error('行为记录失败: 数据库未就绪');
    return res.status(503).json({ success: false, message: '数据库未就绪' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO user_listening_behavior 
      (username, system_type, track_name, artist_name, track_id, listen_duration, is_favorited, rating, timestamp, timestamp_timestamp, created_at_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ` + DB_NOW + `, ` + DB_UNIX + `, ` + DB_UNIX + `)
    `);

    stmt.run([
      username,
      sys,
      track_name,
      artist_name,
      track_id,
      listen_duration || 0,
      is_favorited ? 1 : 0,
      rating || 0
    ]);
    stmt.free();
    saveDatabase();

    res.json({
      success: true,
      message: '行为记录成功'
    });
  } catch (error) {
    console.error('记录行为失败:', error);
    res.status(500).json({ success: false, message: '记录行为失败: ' + error.message });
  }
});

// 气泡展示记录：插入一条展示记录，返回 log_id 供后续点击时更新
app.post('/api/bubble/log', (req, res) => {
  const { username, bubble_type: bubbleType, content } = req.body;
  if (!username || !bubbleType) {
    return res.status(400).json({ success: false, message: 'username、bubble_type 不能为空' });
  }
  if (!db) {
    return res.status(503).json({ success: false, message: '数据库未就绪' });
  }
  try {
    const stmt = db.prepare(`
      INSERT INTO bubble_display_log (username, shown_at, shown_at_timestamp, bubble_type, was_clicked, content)
      VALUES (?, ${DB_NOW}, ${DB_UNIX}, ?, 0, ?)
    `);
    stmt.run([username, bubbleType, content ?? '']);
    const logId = db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0];
    stmt.free();
    saveDatabase();
    res.json({ success: true, log_id: logId });
  } catch (error) {
    console.error('气泡展示记录失败:', error);
    res.status(500).json({ success: false, message: '记录失败: ' + error.message });
  }
});

// 气泡点击：将指定 log_id 的 was_clicked 置为 1
app.post('/api/bubble/click', (req, res) => {
  const { log_id: logId } = req.body;
  if (logId == null) {
    return res.status(400).json({ success: false, message: 'log_id 不能为空' });
  }
  if (!db) {
    return res.status(503).json({ success: false, message: '数据库未就绪' });
  }
  try {
    const stmt = db.prepare('UPDATE bubble_display_log SET was_clicked = 1 WHERE id = ?');
    stmt.run([logId]);
    stmt.free();
    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    console.error('气泡点击记录失败:', error);
    res.status(500).json({ success: false, message: '更新失败: ' + error.message });
  }
});

// 对话框按钮展示记录：插入一条「展示给用户的按钮」记录，返回 log_id
app.post('/api/dialog-button/log', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const session_id = typeof req.body?.session_id === 'string' ? req.body.session_id.trim() : '';
  const message_sequence_no = typeof req.body?.message_sequence_no === 'number' ? req.body.message_sequence_no : -1;
  const buttons = req.body?.buttons;
  if (!username || !session_id || message_sequence_no < 0 || !Array.isArray(buttons)) {
    return res.status(400).json({ success: false, message: 'username、session_id、message_sequence_no、buttons 必填且 buttons 为数组' });
  }
  if (!db) {
    return res.status(503).json({ success: false, message: '数据库未就绪' });
  }
  try {
    const buttonsJson = JSON.stringify(buttons);
    const stmt = db.prepare(`
      INSERT INTO dialog_button_log (username, session_id, message_sequence_no, shown_at, shown_at_timestamp, buttons_json)
      VALUES (?, ?, ?, ${DB_NOW}, ${DB_UNIX}, ?)
    `);
    stmt.run([username, session_id, message_sequence_no, buttonsJson]);
    const logId = db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0];
    stmt.free();
    saveDatabase();
    res.json({ success: true, log_id: logId });
  } catch (error) {
    console.error('对话框按钮展示记录失败:', error);
    res.status(500).json({ success: false, message: '记录失败: ' + error.message });
  }
});

// 对话框按钮点击：记录被点击的按钮文字与 action，可选传 next_text（点击后展示的下一个文字）
app.post('/api/dialog-button/click', (req, res) => {
  const { log_id: logId, clicked_label: clickedLabel, clicked_action: clickedAction, next_text: nextText } = req.body;
  if (logId == null) {
    return res.status(400).json({ success: false, message: 'log_id 不能为空' });
  }
  if (!db) {
    return res.status(503).json({ success: false, message: '数据库未就绪' });
  }
  try {
    const stmt = db.prepare(`
      UPDATE dialog_button_log SET clicked_button_label = ?, clicked_button_action = ?, next_text_after_click = COALESCE(?, next_text_after_click) WHERE id = ?
    `);
    stmt.run([clickedLabel ?? '', clickedAction ?? '', nextText ?? null, logId]);
    stmt.free();
    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    console.error('对话框按钮点击记录失败:', error);
    res.status(500).json({ success: false, message: '更新失败: ' + error.message });
  }
});

// 对话框按钮：更新「点击之后的下一个文字」（若点击时未传，可后续补传）
app.post('/api/dialog-button/next-text', (req, res) => {
  const { log_id: logId, next_text: nextText } = req.body;
  if (logId == null) {
    return res.status(400).json({ success: false, message: 'log_id 不能为空' });
  }
  if (!db) {
    return res.status(503).json({ success: false, message: '数据库未就绪' });
  }
  try {
    const stmt = db.prepare('UPDATE dialog_button_log SET next_text_after_click = ? WHERE id = ?');
    stmt.run([nextText ?? '', logId]);
    stmt.free();
    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    console.error('对话框按钮 next_text 更新失败:', error);
    res.status(500).json({ success: false, message: '更新失败: ' + error.message });
  }
});

// 「为什么推荐这首」按钮：记录点击时间、用户名、系统返回的解释消息
app.post('/api/log/why-this-track', (req, res) => {
  const { username, track_id: trackId, track_name: trackName, explanation } = req.body;
  if (!username || explanation == null || explanation === '') {
    return res.status(400).json({ success: false, message: 'username 和 explanation 不能为空' });
  }
  if (!db) {
    return res.status(503).json({ success: false, message: '数据库未就绪' });
  }
  try {
    const stmt = db.prepare(`
      INSERT INTO why_this_track_log (username, track_id, track_name, explanation)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run([username, trackId ?? null, trackName ?? null, String(explanation)]);
    stmt.free();
    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    console.error('为什么推荐这首 记录失败:', error);
    res.status(500).json({ success: false, message: '记录失败: ' + error.message });
  }
});

// 保存用户偏好：每次偏好更新都必须同时写入 user_preferences（当前快照）与 user_preference_updates（变更记录）
app.post('/api/preferences/save', (req, res) => {
  const { username, system_type: systemType, preferences, operation, conversation_content: conversationContent } = req.body;
  const sys = (systemType === 'B' ? 'B' : 'A');

  if (!username) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
  }

  if (!preferences) {
    return res.status(400).json({ success: false, message: '偏好数据不能为空' });
  }

  const op = operation || 'unknown';
  const conversation_content = conversationContent ?? null;

  try {
    const weights = {
      genres: preferences.genres_weights || preferences.genresWeights || {},
      instruments: preferences.instruments_weights || preferences.instrumentsWeights || {},
      moods: preferences.moods_weights || preferences.moodsWeights || {},
      themes: preferences.themes_weights || preferences.themesWeights || {},
    };
    const formatTagsWithWeights = (tags, w) => {
      if (!Array.isArray(tags) || tags.length === 0) return '';
      const obj = typeof w === 'object' && w !== null ? w : {};
      return tags.map(t => (obj[t] != null ? `${t}(${Number(obj[t])})` : t)).join(', ');
    };
    const formatCategoryForLog = (label, tags, w) => {
      const s = formatTagsWithWeights(Array.isArray(tags) ? tags : [], w || {});
      return s ? `  ${label}: ${s}` : null;
    };

    // 每次偏好更新都需同时更新 DB 两表：先写 user_preference_updates（变更记录），再写 user_preferences（当前快照）
    // 读取当前偏好（用于记录更新前后差异并写 user_preference_updates）
    let oldRow = null;
    const selectStmt = db.prepare('SELECT genres, instruments, moods, themes, genres_weights, instruments_weights, moods_weights, themes_weights FROM user_preferences WHERE username = ? AND system_type = ?');
    selectStmt.bind([username, sys]);
    if (selectStmt.step()) {
      oldRow = selectStmt.getAsObject();
    }
    selectStmt.free();

    // Terminal 日志：用户偏好更新，明确展示更新前 / 更新后（tag 增减与权重）
    const oldGenres = oldRow ? (JSON.parse(oldRow.genres || '[]')) : [];
    const oldInstruments = oldRow ? (JSON.parse(oldRow.instruments || '[]')) : [];
    const oldMoods = oldRow ? (JSON.parse(oldRow.moods || '[]')) : [];
    const oldThemes = oldRow ? (JSON.parse(oldRow.themes || '[]')) : [];
    const oldW = {
      genres: oldRow && oldRow.genres_weights ? (typeof oldRow.genres_weights === 'string' ? JSON.parse(oldRow.genres_weights) : oldRow.genres_weights) : {},
      instruments: oldRow && oldRow.instruments_weights ? (typeof oldRow.instruments_weights === 'string' ? JSON.parse(oldRow.instruments_weights) : oldRow.instruments_weights) : {},
      moods: oldRow && oldRow.moods_weights ? (typeof oldRow.moods_weights === 'string' ? JSON.parse(oldRow.moods_weights) : oldRow.moods_weights) : {},
      themes: oldRow && oldRow.themes_weights ? (typeof oldRow.themes_weights === 'string' ? JSON.parse(oldRow.themes_weights) : oldRow.themes_weights) : {},
    };
    const newGenresArr = preferences.genres || [];
    const newInstrumentsArr = preferences.instruments || [];
    const newMoodsArr = preferences.moods || [];
    const newThemesArr = preferences.themes || [];
    const reasonLabel = PREFERENCE_UPDATE_REASON_LABELS[op] || op || '未指定';
    console.log('\n📝 ========== 用户偏好更新 ==========');
    console.log(`🕐 时间: ${getTimestamp()}`);
    console.log(`👤 用户: ${username} (系统: ${sys}) | 更新原因: ${reasonLabel}`);
    console.log('📤 更新前:');
    [formatCategoryForLog('风格', oldGenres, oldW.genres), formatCategoryForLog('乐器', oldInstruments, oldW.instruments), formatCategoryForLog('情绪', oldMoods, oldW.moods), formatCategoryForLog('主题', oldThemes, oldW.themes)].forEach(line => { if (line) console.log(line); });
    if (!oldGenres.length && !oldInstruments.length && !oldMoods.length && !oldThemes.length) console.log('  (无)');
    console.log('📥 更新后:');
    [formatCategoryForLog('风格', newGenresArr, weights.genres), formatCategoryForLog('乐器', newInstrumentsArr, weights.instruments), formatCategoryForLog('情绪', newMoodsArr, weights.moods), formatCategoryForLog('主题', newThemesArr, weights.themes)].forEach(line => { if (line) console.log(line); });
    if (!newGenresArr.length && !newInstrumentsArr.length && !newMoodsArr.length && !newThemesArr.length) console.log('  (无)');
    if (conversation_content) console.log(`💬 会话摘要: ${conversation_content.slice(0, 80)}${conversation_content.length > 80 ? '...' : ''}`);

    const newGenres = JSON.stringify(preferences.genres || []);
    const newInstruments = JSON.stringify(preferences.instruments || []);
    const newMoods = JSON.stringify(preferences.moods || []);
    const newThemes = JSON.stringify(preferences.themes || []);
    const newGenresWeights = JSON.stringify(weights.genres);
    const newInstrumentsWeights = JSON.stringify(weights.instruments);
    const newMoodsWeights = JSON.stringify(weights.moods);
    const newThemesWeights = JSON.stringify(weights.themes);

    // 对每个有变化的分类写入一条更新记录（显式写入 updated_at / updated_at_timestamp，确保生效）
    const logStmt = db.prepare(`
      INSERT INTO user_preference_updates (username, system_type, tag_category, old_tags, new_tags, operation, conversation_content, updated_at, updated_at_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ` + DB_NOW + `, ` + DB_UNIX + `)
    `);
    const categories = [
      ['genres', newGenres],
      ['instruments', newInstruments],
      ['moods', newMoods],
      ['themes', newThemes],
    ];
    for (const [tag_category, newTags] of categories) {
      const oldTags = oldRow ? (oldRow[tag_category] || '[]') : '[]';
      if (oldTags !== newTags) {
        logStmt.run([username, sys, tag_category, oldTags, newTags, op, conversation_content]);
      }
    }
    logStmt.free();

    // 检查用户偏好是否存在（按 username + system_type）
    const checkStmt = db.prepare('SELECT id FROM user_preferences WHERE username = ? AND system_type = ?');
    checkStmt.bind([username, sys]);
    const exists = checkStmt.step();
    checkStmt.free();

    if (exists) {
      // 更新现有记录（含权重）
      const updateStmt = db.prepare(`
        UPDATE user_preferences 
        SET genres = ?, instruments = ?, moods = ?, themes = ?,
            genres_weights = ?, instruments_weights = ?, moods_weights = ?, themes_weights = ?,
            updated_at = ` + DB_NOW + `,
            updated_at_timestamp = ` + DB_UNIX + `
        WHERE username = ? AND system_type = ?
      `);
      updateStmt.run([
        newGenres,
        newInstruments,
        newMoods,
        newThemes,
        newGenresWeights,
        newInstrumentsWeights,
        newMoodsWeights,
        newThemesWeights,
        username,
        sys
      ]);
      updateStmt.free();
      console.log(`✅ 已更新用户偏好`);
    } else {
      // 插入新记录（含 system_type 与权重）
      const insertStmt = db.prepare(`
        INSERT INTO user_preferences (username, system_type, genres, instruments, moods, themes, genres_weights, instruments_weights, moods_weights, themes_weights, updated_at, updated_at_timestamp, created_at, created_at_timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ` + DB_NOW + `, ` + DB_UNIX + `, ` + DB_NOW + `, ` + DB_UNIX + `)
      `);
      insertStmt.run([
        username,
        sys,
        newGenres,
        newInstruments,
        newMoods,
        newThemes,
        newGenresWeights,
        newInstrumentsWeights,
        newMoodsWeights,
        newThemesWeights
      ]);
      insertStmt.free();
      console.log(`✅ 已创建用户偏好记录`);
    }

    saveDatabase();
    console.log('===================================\n');

    res.json({
      success: true,
      message: '偏好保存成功'
    });
  } catch (error) {
    console.error('❌ 保存偏好失败:', error);
    res.status(500).json({ success: false, message: '保存偏好失败: ' + error.message });
  }
});

// 清除用户偏好内容（冷启动重置）：只清空 user_preferences 表该用户的 tag 与权重，不删除 user_preference_updates
app.post('/api/preferences/clear', (req, res) => {
  const rawUsername = req.body?.username;
  const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
  const systemType = req.body?.system_type === 'B' ? 'B' : 'A';
  if (!username) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
  }
  try {
    const emptyJson = '[]';
    const emptyWeights = '{}';
    const delStmt = db.prepare('DELETE FROM user_preferences WHERE username = ? AND system_type = ?');
    delStmt.run([username, systemType]);
    delStmt.free();
    const insertStmt = db.prepare(`
      INSERT INTO user_preferences (username, system_type, genres, instruments, moods, themes, genres_weights, instruments_weights, moods_weights, themes_weights, updated_at, updated_at_timestamp, created_at, created_at_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ` + DB_NOW + `, ` + DB_UNIX + `, ` + DB_NOW + `, ` + DB_UNIX + `)
    `);
    insertStmt.run([username, systemType, emptyJson, emptyJson, emptyJson, emptyJson, emptyWeights, emptyWeights, emptyWeights, emptyWeights]);
    insertStmt.free();
    saveDatabase();
    console.log(`✅ 已清除用户偏好（冷启动）: ${username}`);
    res.json({ success: true, message: '已清除偏好，保留更新记录' });
  } catch (error) {
    console.error('清除偏好失败:', error);
    res.status(500).json({ success: false, message: '清除偏好失败: ' + error.message });
  }
});

// 追加一条对话：同时写入 user_conversations（当前会话）和 user_conversations_history（永久保留，永不删除）
// body 可选 message_buttons: [{label, action}]（该条消息附带的操作按钮）、user_button_choice: 暂由 record-button-choice 写入
app.post('/api/conversation/append', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const session_id = typeof req.body?.session_id === 'string' ? req.body.session_id.trim() : '';
  const sender = typeof req.body?.sender === 'string' ? req.body.sender.trim() : '';
  const content = typeof req.body?.content === 'string' ? req.body.content : String(req.body?.content ?? '');
  const sequence_no = typeof req.body?.sequence_no === 'number' ? req.body.sequence_no : 0;
  const message_buttons = req.body?.message_buttons != null
    ? (typeof req.body.message_buttons === 'string' ? req.body.message_buttons : JSON.stringify(req.body.message_buttons))
    : null;
  if (!username || !session_id || !sender) {
    return res.status(400).json({ success: false, message: 'username、session_id、sender 不能为空' });
  }
  try {
    const insertConv = db.prepare(`
      INSERT INTO user_conversations (username, session_id, sender, content, sequence_no, message_buttons, created_at, created_at_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ${DB_NOW}, ${DB_UNIX})
    `);
    const insertHist = db.prepare(`
      INSERT INTO user_conversations_history (username, session_id, sender, content, sequence_no, message_buttons, created_at, created_at_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ${DB_NOW}, ${DB_UNIX})
    `);
    insertConv.run([username, session_id, sender, content, sequence_no, message_buttons]);
    insertHist.run([username, session_id, sender, content, sequence_no, message_buttons]);
    insertConv.free();
    insertHist.free();
    saveDatabase();
    res.json({ success: true, message: '已追加对话' });
  } catch (error) {
    console.error('追加对话失败:', error);
    res.status(500).json({ success: false, message: '追加对话失败: ' + error.message });
  }
});

// 记录用户对某条助手消息的操作按钮选择（更新该条的 user_button_choice）
app.post('/api/conversation/record-button-choice', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const session_id = typeof req.body?.session_id === 'string' ? req.body.session_id.trim() : '';
  const sequence_no = typeof req.body?.sequence_no === 'number' ? req.body.sequence_no : -1;
  const choice_label = typeof req.body?.choice_label === 'string' ? req.body.choice_label.trim() : '';
  const choice_action = typeof req.body?.choice_action === 'string' ? req.body.choice_action.trim() : '';
  if (!username || !session_id || sequence_no < 0) {
    return res.status(400).json({ success: false, message: 'username、session_id、sequence_no 不能为空且 sequence_no 需为非负' });
  }
  const user_button_choice = JSON.stringify({ label: choice_label, action: choice_action });
  try {
    const updateConv = db.prepare(`
      UPDATE user_conversations SET user_button_choice = ? WHERE username = ? AND session_id = ? AND sequence_no = ? AND sender = 'assistant'
    `);
    const updateHist = db.prepare(`
      UPDATE user_conversations_history SET user_button_choice = ? WHERE username = ? AND session_id = ? AND sequence_no = ? AND sender = 'assistant'
    `);
    const rc = updateConv.run([user_button_choice, username, session_id, sequence_no]);
    updateHist.run([user_button_choice, username, session_id, sequence_no]);
    updateConv.free();
    updateHist.free();
    saveDatabase();
    res.json({ success: true, message: '已记录用户操作', updated: rc.changes > 0 });
  } catch (error) {
    console.error('记录按钮选择失败:', error);
    res.status(500).json({ success: false, message: '记录按钮选择失败: ' + error.message });
  }
});

// 清除用户当前会话对话（仅 user_conversations；user_conversations_history 永不删除）
app.post('/api/conversation/clear', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  if (!username) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
  }
  try {
    const stmt = db.prepare('DELETE FROM user_conversations WHERE username = ?');
    stmt.run([username]);
    stmt.free();
    saveDatabase();
    res.json({ success: true, message: '已清除当前会话对话（历史表保留）' });
  } catch (error) {
    console.error('清除对话历史失败:', error);
    res.status(500).json({ success: false, message: '清除对话历史失败: ' + error.message });
  }
});

// 清除当前用户全部数据，回到冷启动：偏好、对话、听歌行为、已推荐记录一并清除（LLM 与推荐系统均不再保留过去行为）
app.post('/api/user/clear-all', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  if (!username) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
  }
  try {
    const emptyJson = '[]';
    const emptyWeights = '{}';
    const CLEAR_OPERATION = '清除数据';

    // 1. 读取当前偏好（用于写入 user_preference_updates），再清空 user_preferences
    const selectPref = db.prepare('SELECT system_type, genres, instruments, moods, themes FROM user_preferences WHERE username = ?');
    selectPref.bind([username]);
    const oldPrefsBySys = {};
    while (selectPref.step()) {
      const row = selectPref.getAsObject();
      const sys = row.system_type === 'B' ? 'B' : 'A';
      oldPrefsBySys[sys] = {
        genres: row.genres || '[]',
        instruments: row.instruments || '[]',
        moods: row.moods || '[]',
        themes: row.themes || '[]',
      };
    }
    selectPref.free();

    // Terminal 日志：用户偏好更新（清除），更新前 / 更新后
    console.log('\n📝 ========== 用户偏好更新（清除数据） ==========');
    console.log(`🕐 时间: ${getTimestamp()}`);
    console.log(`👤 用户: ${username}`);
    for (const sys of ['A', 'B']) {
      const old = oldPrefsBySys[sys] || { genres: '[]', instruments: '[]', moods: '[]', themes: '[]' };
      const hasAny = [old.genres, old.instruments, old.moods, old.themes].some(s => s && s !== '[]');
      if (hasAny) {
        console.log(`📤 更新前 (系统 ${sys}): 风格 ${old.genres || '[]'}, 乐器 ${old.instruments || '[]'}, 情绪 ${old.moods || '[]'}, 主题 ${old.themes || '[]'}`);
      }
    }
    console.log('📥 更新后: (无)');
    console.log('===================================\n');

    const delPref = db.prepare('DELETE FROM user_preferences WHERE username = ?');
    delPref.run([username]);
    delPref.free();

    const insertPref = db.prepare(`
      INSERT INTO user_preferences (username, system_type, genres, instruments, moods, themes, genres_weights, instruments_weights, moods_weights, themes_weights, updated_at, updated_at_timestamp, created_at, created_at_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ` + DB_NOW + `, ` + DB_UNIX + `, ` + DB_NOW + `, ` + DB_UNIX + `)
    `);
    for (const sys of ['A', 'B']) {
      insertPref.run([username, sys, emptyJson, emptyJson, emptyJson, emptyJson, emptyWeights, emptyWeights, emptyWeights, emptyWeights]);
    }
    insertPref.free();

    // 写入 user_preference_updates：记录变空，并标记为清除数据导致（显式写入时间戳）
    const logStmt = db.prepare(`
      INSERT INTO user_preference_updates (username, system_type, tag_category, old_tags, new_tags, operation, conversation_content, updated_at, updated_at_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ` + DB_NOW + `, ` + DB_UNIX + `)
    `);
    for (const sys of ['A', 'B']) {
      const old = oldPrefsBySys[sys] || { genres: '[]', instruments: '[]', moods: '[]', themes: '[]' };
      for (const cat of ['genres', 'instruments', 'moods', 'themes']) {
        const oldTags = old[cat] || '[]';
        logStmt.run([username, sys, cat, oldTags, emptyJson, CLEAR_OPERATION, null]);
      }
    }
    logStmt.free();

    // 2. 清空对话历史（LLM 不再有该用户过往对话上下文）
    const delConv = db.prepare('DELETE FROM user_conversations WHERE username = ?');
    delConv.run([username]);
    delConv.free();
    // 3. 清空听歌行为（推荐算法不再使用该用户历史行为）
    const delBehavior = db.prepare('DELETE FROM user_listening_behavior WHERE username = ?');
    delBehavior.run([username]);
    delBehavior.free();
    // 4. 清空已推荐曲目记录（冷启动后推荐不再排除“已推荐过”）
    const delRec = db.prepare('DELETE FROM user_recommended_tracks WHERE username = ?');
    delRec.run([username]);
    delRec.free();
    saveDatabase();
    console.log(`✅ 已清除用户全部数据（冷启动）: ${username}`);
    // #region agent log
    debugLog({ location: 'server.js:clear-all', message: 'clear-all_done', data: { username }, hypothesisId: 'H1' });
    // #endregion
    res.json({ success: true, message: '已清除偏好、对话、听歌行为与已推荐记录，已回到冷启动' });
  } catch (error) {
    console.error('清除用户全部数据失败:', error);
    res.status(500).json({ success: false, message: '清除失败: ' + error.message });
  }
});

// 获取用户偏好
app.get('/api/preferences/:username', (req, res) => {
  const { username } = req.params;
  const systemType = req.query.system_type === 'B' ? 'B' : 'A';

  try {
    const stmt = db.prepare('SELECT * FROM user_preferences WHERE username = ? AND system_type = ?');
    stmt.bind([username, systemType]);
    
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      
      res.json({
        success: true,
        preferences: {
          genres: JSON.parse(row.genres || '[]'),
          instruments: JSON.parse(row.instruments || '[]'),
          moods: JSON.parse(row.moods || '[]'),
          themes: JSON.parse(row.themes || '[]'),
          genres_weights: JSON.parse(row.genres_weights || '{}'),
          instruments_weights: JSON.parse(row.instruments_weights || '{}'),
          moods_weights: JSON.parse(row.moods_weights || '{}'),
          themes_weights: JSON.parse(row.themes_weights || '{}')
        }
      });
    } else {
      stmt.free();
      res.json({
        success: true,
        preferences: {
          genres: [],
          instruments: [],
          moods: [],
          themes: [],
          genres_weights: {},
          instruments_weights: {},
          moods_weights: {},
          themes_weights: {}
        }
      });
    }
  } catch (error) {
    console.error('获取用户偏好失败:', error);
    res.status(500).json({ success: false, message: '获取用户偏好失败: ' + error.message });
  }
});

// 获取用户行为历史（按系统 A/B 维度）
function getUserBehaviorHistory(username, systemType = 'A') {
  const sys = systemType === 'B' ? 'B' : 'A';
  try {
    const stmt = db.prepare(`
      SELECT track_id, listen_duration, is_favorited, rating, timestamp
      FROM user_listening_behavior
      WHERE username = ? AND system_type = ?
      ORDER BY timestamp DESC
    `);
    stmt.bind([username, sys]);
    
    const behaviors = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      behaviors.push({
        track_id: row.track_id,
        listen_duration: row.listen_duration || 0,
        is_favorited: row.is_favorited === 1,
        rating: row.rating || 0,
        timestamp: row.timestamp
      });
    }
    stmt.free();
    
    return behaviors;
  } catch (error) {
    console.error('获取用户行为历史失败:', error);
    return [];
  }
}

// 获取该用户历史上被推荐过的 track_id 列表（按系统 A/B 维度）
function getRecommendedTrackIds(username, systemType = 'A') {
  const sys = systemType === 'B' ? 'B' : 'A';
  if (!db) return [];
  try {
    const stmt = db.prepare(`
      SELECT DISTINCT track_id FROM user_recommended_tracks WHERE username = ? AND system_type = ?
    `);
    stmt.bind([username, sys]);
    const ids = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.track_id) ids.push(row.track_id);
    }
    stmt.free();
    return ids;
  } catch (error) {
    console.error('获取已推荐曲目列表失败:', error);
    return [];
  }
}

// 记录本次推荐给该用户的曲目（按系统 A/B 维度）
function saveRecommendedTrackIds(username, trackIds, systemType = 'A') {
  const sys = systemType === 'B' ? 'B' : 'A';
  if (!db || !Array.isArray(trackIds) || trackIds.length === 0) return;
  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO user_recommended_tracks (username, system_type, track_id, created_at, created_at_timestamp)
      VALUES (?, ?, ?, ${DB_NOW}, ${DB_UNIX})
    `);
    for (const trackId of trackIds) {
      if (trackId) stmt.run([username, sys, String(trackId)]);
    }
    stmt.free();
    saveDatabase();
  } catch (error) {
    console.error('记录已推荐曲目失败:', error);
  }
}

// 待播列表：读取（按系统 A/B 维度）
function getPlaylistTrackIds(username, systemType = 'A') {
  const sys = systemType === 'B' ? 'B' : 'A';
  if (!db) return [];
  try {
    const stmt = db.prepare('SELECT track_ids FROM user_playlist WHERE username = ? AND system_type = ?');
    stmt.bind([username, sys]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      const ids = JSON.parse(row.track_ids || '[]');
      return Array.isArray(ids) ? ids : [];
    }
    stmt.free();
    return [];
  } catch (error) {
    console.error('读取待播列表失败:', error);
    return [];
  }
}

// 待播列表：写入（按系统 A/B 维度）
function setPlaylistTrackIds(username, trackIds, systemType = 'A') {
  const sys = systemType === 'B' ? 'B' : 'A';
  if (!db) return;
  try {
    const ids = Array.isArray(trackIds) ? trackIds : [];
    const stmt = db.prepare(`
      REPLACE INTO user_playlist (username, system_type, track_ids, updated_at, updated_at_timestamp) VALUES (?, ?, ?, ` + DB_NOW + `, ` + DB_UNIX + `)
    `);
    stmt.run([username, sys, JSON.stringify(ids)]);
    stmt.free();
    saveDatabase();
  } catch (error) {
    console.error('写入待播列表失败:', error);
  }
}

// 为待播列表生成推荐（按系统 A/B 维度）
function getRecommendationsForPlaylist(username, count, extraExcludedIds = [], systemType = 'A') {
  const behaviorHistory = getUserBehaviorHistory(username, systemType);
  let dbPreferences = { genres: [], instruments: [], moods: [], themes: [] };
  try {
    const prefStmt = db.prepare('SELECT * FROM user_preferences WHERE username = ? AND system_type = ?');
    prefStmt.bind([username, systemType === 'B' ? 'B' : 'A']);
    if (prefStmt.step()) {
      const row = prefStmt.getAsObject();
      dbPreferences = {
        genres: JSON.parse(row.genres || '[]'),
        instruments: JSON.parse(row.instruments || '[]'),
        moods: JSON.parse(row.moods || '[]'),
        themes: JSON.parse(row.themes || '[]')
      };
    }
    prefStmt.free();
  } catch (e) {}
  const alreadyRecommendedIds = getRecommendedTrackIds(username, systemType);
  const additionalExcludedIds = [...alreadyRecommendedIds, ...(Array.isArray(extraExcludedIds) ? extraExcludedIds : [])];
  return generateRecommendations(
    dbPreferences,
    behaviorHistory,
    '',
    count,
    {},
    additionalExcludedIds
  );
}

// 单曲详情请求超时（毫秒），避免 Jamendo 慢时阻塞整次推荐
const FULL_TRACK_DETAILS_TIMEOUT_MS = 10000;

// 获取歌曲完整详情（供推荐接口返回首曲，减少前端再请求 Jamendo 的耗时）
async function getFullTrackDetails(trackId) {
  const trackTagsMap = getTrackTagsMap();
  const tags = trackTagsMap.get(trackId) || { genres: [], instruments: [], moods: [], themes: [] };
  const numericId = (trackId || '').replace(/^track_0*/, '') || '0';
  const url = `https://api.jamendo.com/v3.0/tracks/?client_id=1ccf1f44&id=${numericId}&format=json`;
  try {
    const fetch = (await import('node-fetch')).default;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FULL_TRACK_DETAILS_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      const t = data.results[0];
      return {
        id: trackId, // 与 recommendedTracks 格式一致，便于前端匹配
        name: t.name || 'Unknown',
        artist_name: t.artist_name || 'Unknown Artist',
        album_name: t.album_name || 'Unknown Album',
        image: t.image || t.album_image || '',
        audio: t.audio || t.audiodownload || '',
        duration: t.duration || 0,
        releasedate: t.releasedate || '',
        tags,
      };
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`getFullTrackDetails(${trackId}) 超时 ${FULL_TRACK_DETAILS_TIMEOUT_MS}ms`);
    } else {
      console.warn(`getFullTrackDetails(${trackId}) 失败:`, err.message);
    }
  }
  return null;
}

// 获取歌曲信息（从用户行为历史中查找，如果找不到则尝试从Jamendo API获取）
async function getTrackInfo(trackId) {
  try {
    // 首先从数据库查找
    const stmt = db.prepare(`
      SELECT track_name, artist_name
      FROM user_listening_behavior
      WHERE track_id = ?
      LIMIT 1
    `);
    stmt.bind([trackId]);
    
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return {
        name: row.track_name,
        artist: row.artist_name
      };
    }
    stmt.free();
    
    // 如果数据库中没有，尝试从Jamendo API获取
    try {
      const numericId = trackId.replace('track_', '').replace(/^0+/, '') || '0';
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`https://api.jamendo.com/v3.0/tracks/?client_id=1ccf1f44&id=${numericId}&format=json`);
      const data = await response.json();
      
      if (data.results && data.results.length > 0) {
        const track = data.results[0];
        return {
          name: track.name || 'Unknown',
          artist: track.artist_name || 'Unknown Artist'
        };
      }
    } catch (apiError) {
      // API获取失败，返回null
      console.warn(`无法从Jamendo API获取track_id: ${trackId}的信息:`, apiError.message);
    }
    
    return null;
  } catch (error) {
    console.error('获取歌曲信息失败:', error);
    return null;
  }
}

// 推荐算法文档（供小助手回答「怎么推荐的」等问题时查询）
app.get('/api/docs/recommendation-algorithm', (req, res) => {
  try {
    const docPath = join(__dirname, '..', '推荐算法设计文档.md');
    const content = readFileSync(docPath, 'utf-8');
    res.json({ success: true, content });
  } catch (e) {
    console.warn('读取推荐算法文档失败:', e?.message);
    res.status(404).json({ success: false, message: '文档不存在' });
  }
});

// ========== 待播列表（按顺序播放，按系统 A/B 维度） ==========
app.get('/api/playlist', (req, res) => {
  const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';
  const currentIndex = typeof req.query.currentIndex === 'string' ? parseInt(req.query.currentIndex, 10) : undefined;
  const systemType = req.query.system_type === 'B' ? 'B' : 'A';
  if (!username) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
  }
  try {
    let trackIds = getPlaylistTrackIds(username, systemType);
    if (trackIds.length === 0) {
      trackIds = getRecommendationsForPlaylist(username, 10, [], systemType);
      if (trackIds.length > 0) {
        saveRecommendedTrackIds(username, trackIds, systemType);
        setPlaylistTrackIds(username, trackIds, systemType);
        console.log(`📋 待播列表初始化: ${username} [${systemType}]，共 ${trackIds.length} 首`);
      }
      return res.json({ success: true, trackIds });
    }
    const listExhausted = typeof currentIndex === 'number' && !isNaN(currentIndex) && currentIndex >= trackIds.length && trackIds.length > 0;
    if (listExhausted) {
      trackIds = getRecommendationsForPlaylist(username, 10, [], systemType);
      if (trackIds.length > 0) {
        saveRecommendedTrackIds(username, trackIds, systemType);
        setPlaylistTrackIds(username, trackIds, systemType);
        console.log(`📋 待播列表已播完，重新生成: ${username} [${systemType}]，共 ${trackIds.length} 首`);
      }
      return res.json({ success: true, trackIds });
    }
    // 待播列表只剩 2 首或更少时即开始请求并追加，避免播完才拉
    const remaining = trackIds.length - (typeof currentIndex === 'number' && !isNaN(currentIndex) ? currentIndex : 0);
    const shouldExtend = remaining <= 2;
    if (shouldExtend) {
      const extra = getRecommendationsForPlaylist(username, 5, trackIds, systemType);
      if (extra.length > 0) {
        saveRecommendedTrackIds(username, extra, systemType);
        trackIds = [...trackIds, ...extra];
        setPlaylistTrackIds(username, trackIds, systemType);
        console.log(`📋 待播列表追加 5 首（剩余 ${remaining} 首时自动扩展）: ${username} [${systemType}]，当前共 ${trackIds.length} 首`);
      }
    }
    res.json({ success: true, trackIds });
  } catch (error) {
    console.error('获取待播列表失败:', error);
    res.status(500).json({ success: false, message: '获取待播列表失败: ' + error.message });
  }
});

app.post('/api/playlist', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const trackIds = Array.isArray(req.body?.trackIds) ? req.body.trackIds : [];
  const systemType = req.body?.system_type === 'B' ? 'B' : 'A';
  if (!username) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
  }
  try {
    const ids = trackIds.map((id) => String(id)).filter(Boolean);
    setPlaylistTrackIds(username, ids, systemType);
    res.json({ success: true, trackIds: ids, message: '待播列表已更新' });
  } catch (error) {
    console.error('更新待播列表失败:', error);
    res.status(500).json({ success: false, message: '更新待播列表失败: ' + error.message });
  }
});

// 推荐请求触发原因 -> 中文日志
const TRIGGER_LABELS = {
  user_expressed_preference: '用户主动表达喜好',
  user_dislike_remove: '用户表达讨厌并移除 tag',
  preferences_updated: '用户偏好已更新',
  preload_next_batch: '待播列表剩余不多，预拉下一批',
  playlist_finished: '当前播放列表播放完毕',
  user_request_rerecommend: '用户请求重新推荐/换一批',
};

// 用户偏好更新原因（operation）-> 终端日志明确展示：收藏、评分高、听歌完播、用户主动表达喜欢、用户主动表达厌恶 等
const PREFERENCE_UPDATE_REASON_LABELS = {
  favorite: '收藏',
  rating_confirm: '评分高',
  ninety_five_confirm: '听歌完播',
  one_minute_confirm: '听满1分钟',
  conversation: '用户主动表达喜欢',
  dislike_remove: '用户主动表达厌恶',
  first_login: '冷启动',
  conflict_confirm: '说的不对后确认',
  unknown: '未指定',
};

// 推荐歌曲接口（按系统 A/B 维度，推荐算法一致）
app.post('/api/recommend', async (req, res) => {
  const { username, systemType: reqSystemType, currentTrackId, explicitPreferences, count = 3, trigger, excludedTags, current_playlist: currentPlaylist, preferenceUpdateReason, triggerUserMessage } = req.body;
  const systemType = reqSystemType === 'B' ? 'B' : 'A';

  if (!username) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
  }

  const RECOMMEND_TIMEOUT_MS = 30000;
  const timeoutId = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({ success: false, message: '推荐请求超时，请稍后重试' });
    }
  }, RECOMMEND_TIMEOUT_MS);

  const recommendStartMs = Date.now();
  console.log('[recommend] 开始', recommendStartMs);
  try {
    const hasExplicit = explicitPreferences && (
      (explicitPreferences.genres?.length > 0) || (explicitPreferences.instruments?.length > 0) ||
      (explicitPreferences.moods?.length > 0) || (explicitPreferences.themes?.length > 0)
    );

    const behaviorHistory = getUserBehaviorHistory(username, systemType);
    // 仅冷启动阶段「仅用显式偏好、不参与行为历史」：首次表达喜好且尚无行为历史
    const isColdStart = hasExplicit && trigger === 'user_expressed_preference' && behaviorHistory.length === 0;

    let dbPreferences = {
      genres: [],
      instruments: [],
      moods: [],
      themes: []
    };
    try {
      const prefStmt = db.prepare('SELECT * FROM user_preferences WHERE username = ? AND system_type = ?');
      prefStmt.bind([username, systemType]);
      if (prefStmt.step()) {
        const row = prefStmt.getAsObject();
        dbPreferences = {
          genres: JSON.parse(row.genres || '[]'),
          instruments: JSON.parse(row.instruments || '[]'),
          moods: JSON.parse(row.moods || '[]'),
          themes: JSON.parse(row.themes || '[]')
        };
      }
      prefStmt.free();
    } catch (error) {
      console.error('读取数据库偏好失败:', error);
    }

    // 用户主动表达喜好插播 3 首：只按本次表达的标签推荐，不融合 DB 已有偏好
    const useOnlyExpressed = trigger === 'user_expressed_preference' && hasExplicit;
    const finalPrefs = useOnlyExpressed
      ? {
          genres: explicitPreferences.genres || [],
          instruments: explicitPreferences.instruments || [],
          moods: explicitPreferences.moods || [],
          themes: explicitPreferences.themes || []
        }
      : isColdStart
      ? {
          genres: explicitPreferences.genres || [],
          instruments: explicitPreferences.instruments || [],
          moods: explicitPreferences.moods || [],
          themes: explicitPreferences.themes || []
        }
      : {
          genres: [...new Set([...dbPreferences.genres, ...(explicitPreferences?.genres || [])])],
          instruments: [...new Set([...dbPreferences.instruments, ...(explicitPreferences?.instruments || [])])],
          moods: [...new Set([...dbPreferences.moods, ...(explicitPreferences?.moods || [])])],
          themes: [...new Set([...dbPreferences.themes, ...(explicitPreferences?.themes || [])])]
        };

    // 输出日志到终端（当前歌曲信息改为后台获取，不阻塞响应）
    let triggerLabel = TRIGGER_LABELS[trigger] || trigger || '未指定';
    if (trigger === 'preferences_updated' && preferenceUpdateReason) {
      const reasonLabel = PREFERENCE_UPDATE_REASON_LABELS[preferenceUpdateReason] || preferenceUpdateReason;
      triggerLabel = `用户偏好已更新（原因：${reasonLabel}）`;
    }
    if (trigger === 'user_expressed_preference' && triggerUserMessage) {
      triggerLabel = triggerLabel + '；用户消息原文：「' + triggerUserMessage + '」';
    }
    console.log('\n' + '='.repeat(60));
    console.log('🎵 推荐请求');
    console.log('【请求原因】' + triggerLabel);
    console.log('='.repeat(60));
    console.log(`🕐 时间: ${getTimestamp()}`);
    console.log(`👤 用户: ${username}`);
    if (currentTrackId) {
      getTrackInfo(currentTrackId).then((currentTrackInfo) => {
        if (currentTrackInfo) console.log(`🎧 当前歌曲: ${currentTrackInfo.name} - ${currentTrackInfo.artist} (track_id: ${currentTrackId})`);
        else console.log(`🎧 当前歌曲ID: track_id: ${currentTrackId}`);
      }).catch(() => {});
    } else {
      console.log(`🎧 当前歌曲: 无`);
    }
    
    // 显示数据库中的偏好
    console.log(`📊 数据库中的用户偏好:`);
    if (dbPreferences.genres.length > 0 || dbPreferences.instruments.length > 0 || 
        dbPreferences.moods.length > 0 || dbPreferences.themes.length > 0) {
      if (dbPreferences.genres.length > 0) {
        console.log(`   风格: ${dbPreferences.genres.join(', ')}`);
      }
      if (dbPreferences.instruments.length > 0) {
        console.log(`   乐器: ${dbPreferences.instruments.join(', ')}`);
      }
      if (dbPreferences.moods.length > 0) {
        console.log(`   情绪: ${dbPreferences.moods.join(', ')}`);
      }
      if (dbPreferences.themes.length > 0) {
        console.log(`   主题: ${dbPreferences.themes.join(', ')}`);
      }
    } else {
      console.log(`   (数据库无偏好记录)`);
    }
    
    // 显示本次传入的偏好
    if (explicitPreferences && (explicitPreferences.genres?.length > 0 || explicitPreferences.instruments?.length > 0 || 
        explicitPreferences.moods?.length > 0 || explicitPreferences.themes?.length > 0)) {
      console.log(`📝 本次传入的偏好:`);
      if (explicitPreferences.genres?.length > 0) {
        console.log(`   风格: ${explicitPreferences.genres.join(', ')}`);
      }
      if (explicitPreferences.instruments?.length > 0) {
        console.log(`   乐器: ${explicitPreferences.instruments.join(', ')}`);
      }
      if (explicitPreferences.moods?.length > 0) {
        console.log(`   情绪: ${explicitPreferences.moods.join(', ')}`);
      }
      if (explicitPreferences.themes?.length > 0) {
        console.log(`   主题: ${explicitPreferences.themes.join(', ')}`);
      }
    }
    
    // 显示最终合并的偏好
    console.log(`🔀 最终使用的偏好 (合并后):`);
    if (finalPrefs.genres.length > 0 || finalPrefs.instruments.length > 0 || 
        finalPrefs.moods.length > 0 || finalPrefs.themes.length > 0) {
      if (finalPrefs.genres.length > 0) {
        console.log(`   风格: ${finalPrefs.genres.join(', ')}`);
      }
      if (finalPrefs.instruments.length > 0) {
        console.log(`   乐器: ${finalPrefs.instruments.join(', ')}`);
      }
      if (finalPrefs.moods.length > 0) {
        console.log(`   情绪: ${finalPrefs.moods.join(', ')}`);
      }
      if (finalPrefs.themes.length > 0) {
        console.log(`   主题: ${finalPrefs.themes.join(', ')}`);
      }
    } else {
      console.log(`   (无偏好，将使用冷启动策略)`);
    }
    
    // 仅冷启动阶段不掺入行为历史；其余情况（含传入显式偏好）均参与行为历史；清空记录后行为历史与已推荐数均为 0
    const behaviorForRecommend = isColdStart ? [] : behaviorHistory;
    const alreadyRecommendedIds = getRecommendedTrackIds(username, systemType);
    // #region agent log
    debugLog({ location: 'server.js:recommend', message: 'recommend_counts', data: { username, systemType, behaviorLen: behaviorHistory.length, alreadyLen: alreadyRecommendedIds.length }, hypothesisId: 'H2' });
    // #endregion
    console.log(`📈 行为历史记录数: ${behaviorHistory.length}${behaviorHistory.length === 0 ? '（清空记录后无历史行为）' : ''}${isColdStart ? ' (冷启动，仅用显式偏好，不参与)' : ''}`);
    console.log(`📋 历史已推荐曲目数（本次排除）: ${alreadyRecommendedIds.length}${alreadyRecommendedIds.length === 0 ? '（清空记录后从 0 考虑，无历史推荐）' : ''}`);
    console.log(`🎯 请求推荐数量: ${count}`);
    
    // 生成推荐（用户明确不喜欢时传入 excludedTags；历史已推荐过的曲目不再推荐）
    console.log('[recommend] 即将调用 generateRecommendations', Date.now());
    const useOnlyExplicitPrefs = trigger === 'user_expressed_preference';
    const { trackIds: recommendedTracks, scores: recommendedScores } = generateRecommendations(
      finalPrefs,
      behaviorForRecommend,
      currentTrackId || '',
      count,
      excludedTags || {},
      alreadyRecommendedIds,
      useOnlyExplicitPrefs
    );
    console.log('[recommend] generateRecommendations 返回', Date.now(), '耗时(ms)', Date.now() - recommendStartMs);

    // 不惜一切代价：打好分后立刻把 trackIds 返回给前端，待播列表立刻可用；写库和日志放到后台
    let filteredPlaylist = [];
    if (trigger === 'user_dislike_remove' && Array.isArray(currentPlaylist) && currentPlaylist.length > 0 && excludedTags) {
      const trackTagsMap = getTrackTagsMap();
      const hasExcluded = (tags, type) => {
        const arr = excludedTags[type];
        if (!Array.isArray(arr) || arr.length === 0) return false;
        const list = tags && tags[type] ? tags[type] : [];
        return list.some((t) => arr.includes(t));
      };
      filteredPlaylist = currentPlaylist.filter((trackId) => {
        const tags = getTrackTagsByAnyId(trackTagsMap, trackId);
        if (hasExcluded(tags, 'genres') || hasExcluded(tags, 'instruments') || hasExcluded(tags, 'moods') || hasExcluded(tags, 'themes')) return false;
        return true;
      });
    }
    const durationMs = Date.now() - recommendStartMs;
    console.log(`⏱ 推荐请求耗时: ${durationMs}ms`);

    // 立刻返回 trackIds，不等待 Jamendo 拉取首曲详情，避免后端被 Jamendo 拖死；前端用 getTrackById 按需拉首曲
    clearTimeout(timeoutId);
    console.log('[recommend] 即将 res.json，总耗时(ms)', Date.now() - recommendStartMs);
    res.json({
      success: true,
      recommendedTracks,
      recommendedScores: recommendedScores || recommendedTracks.map(() => 0),
      count: recommendedTracks.length,
      firstTrack: undefined,
      firstTracks: [],
      filteredPlaylist: filteredPlaylist.length > 0 ? filteredPlaylist : undefined
    });

    // 写库与详细日志放到下一 tick，不阻塞响应
    setImmediate(() => {
      if (recommendedTracks.length > 0) {
        saveRecommendedTrackIds(username, recommendedTracks, systemType);
      }
      console.log(`✅ 推荐结果: ${recommendedTracks.length} 首歌曲，耗时 ${durationMs}ms`);
      if (filteredPlaylist.length > 0) {
        console.log(`📋 待播列表过滤（排除含厌恶 tag 的曲目）: 原 ${currentPlaylist.length} 首 → 保留 ${filteredPlaylist.length} 首`);
      }
      if (recommendedTracks.length > 0) {
        const trackInfoPromises = recommendedTracks.slice(0, 10).map(tid => getTrackInfo(tid));
        Promise.all(trackInfoPromises).then((trackInfos) => {
          const resultReasonLabel = (trigger === 'user_expressed_preference' && triggerUserMessage)
            ? `${triggerLabel}；用户消息原文：「${triggerUserMessage}」`
            : triggerLabel;
          console.log(`   推荐歌曲:（本结果对应请求原因: ${resultReasonLabel}）`);
          recommendedTracks.slice(0, 10).forEach((tid, index) => {
            const info = trackInfos[index];
            const cur = currentTrackId === tid ? ' ⭐当前播放' : '';
            if (info) console.log(`     ${index + 1}. ${info.name} - ${info.artist} (track_id: ${tid})${cur}`);
            else console.log(`     ${index + 1}. track_id: ${tid} (信息未找到)${cur}`);
          });
          if (recommendedTracks.length > 10) console.log(`     ... 还有 ${recommendedTracks.length - 10} 首歌曲`);
        }).catch(() => {});
      }
      console.log('===================================\n');
    });
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('❌ 推荐失败:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: '推荐失败: ' + error.message });
    }
  }
});

// 为什么推荐这首：返回单曲的推荐理由（内容分、行为分、匹配标签）
// 若 trackId 不在本地标签库，可传 trackTags（前端 currentTrack.tags）用内容匹配生成理由
app.post('/api/recommend/why', async (req, res) => {
  const { username, trackId, trackTags: bodyTrackTags } = req.body;
  if (!username || !trackId) {
    return res.status(400).json({ success: false, message: '用户名和歌曲ID不能为空' });
  }
  try {
    const behaviorHistory = getUserBehaviorHistory(username);
    let dbPreferences = { genres: [], instruments: [], moods: [], themes: [] };
    try {
      const prefStmt = db.prepare('SELECT * FROM user_preferences WHERE username = ?');
      prefStmt.bind([username]);
      if (prefStmt.step()) {
        const row = prefStmt.getAsObject();
        dbPreferences = {
          genres: JSON.parse(row.genres || '[]'),
          instruments: JSON.parse(row.instruments || '[]'),
          moods: JSON.parse(row.moods || '[]'),
          themes: JSON.parse(row.themes || '[]')
        };
      }
      prefStmt.free();
    } catch (e) { /* ignore */ }
    const finalPrefs = {
      genres: [...(dbPreferences.genres || [])],
      instruments: [...(dbPreferences.instruments || [])],
      moods: [...(dbPreferences.moods || [])],
      themes: [...(dbPreferences.themes || [])]
    };
    const combinedPrefs = getCombinedPreferences(finalPrefs, behaviorHistory);
    let reason = getTrackRecommendationReason(combinedPrefs, behaviorHistory, String(trackId));
    if (!reason && bodyTrackTags && (bodyTrackTags.genres?.length || bodyTrackTags.instruments?.length || bodyTrackTags.moods?.length || bodyTrackTags.themes?.length)) {
      reason = getTrackRecommendationReasonFromTags(combinedPrefs, bodyTrackTags);
    }
    if (!reason) {
      return res.status(404).json({ success: false, message: '未找到该歌曲的推荐理由' });
    }
    res.json({ success: true, data: reason });
  } catch (error) {
    console.error('❌ 获取推荐理由失败:', error);
    res.status(500).json({ success: false, message: '获取推荐理由失败: ' + error.message });
  }
});

// 多样性推荐接口（用户没有表达过厌恶，但也没有展示过喜爱的tag的歌）
app.post('/api/recommend/diversity', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
  }

  try {
    // 获取用户行为历史
    const behaviorHistory = getUserBehaviorHistory(username);
    
    // 从数据库读取用户偏好
    let dbPreferences = {
      genres: [],
      instruments: [],
      moods: [],
      themes: []
    };
    try {
      const prefStmt = db.prepare('SELECT * FROM user_preferences WHERE username = ?');
      prefStmt.bind([username]);
      if (prefStmt.step()) {
        const row = prefStmt.getAsObject();
        dbPreferences = {
          genres: JSON.parse(row.genres || '[]'),
          instruments: JSON.parse(row.instruments || '[]'),
          moods: JSON.parse(row.moods || '[]'),
          themes: JSON.parse(row.themes || '[]')
        };
      }
      prefStmt.free();
    } catch (error) {
      console.error('读取数据库偏好失败:', error);
    }

    // 获取trackTagsMap（必须在所有使用之前获取）
    const trackTagsMap = getTrackTagsMap();
    
    // 获取所有用户表达过厌恶的标签（评分1-2星的歌曲的标签）
    const dislikedTags = {
      genres: new Set(),
      instruments: new Set(),
      moods: new Set(),
      themes: new Set()
    };

    behaviorHistory.forEach(record => {
      if (record.rating && record.rating <= 2) {
        // 获取该歌曲的标签
        const trackTags = getTrackTagsByAnyId(trackTagsMap, record.track_id);
        if (trackTags) {
          trackTags.genres?.forEach(tag => dislikedTags.genres.add(tag));
          trackTags.instruments?.forEach(tag => dislikedTags.instruments.add(tag));
          trackTags.moods?.forEach(tag => dislikedTags.moods.add(tag));
          trackTags.themes?.forEach(tag => dislikedTags.themes.add(tag));
        }
      }
    });

    // 获取所有用户展示过喜爱的标签（评分4-5星、收藏、或听歌时长>60秒的歌曲的标签）
    const likedTags = {
      genres: new Set(),
      instruments: new Set(),
      moods: new Set(),
      themes: new Set()
    };

    behaviorHistory.forEach(record => {
      const isLiked = (record.rating && record.rating >= 4) || 
                     record.is_favorited || 
                     (record.listen_duration && record.listen_duration > 60);
      
      if (isLiked) {
        const trackTags = getTrackTagsByAnyId(trackTagsMap, record.track_id);
        if (trackTags) {
          trackTags.genres?.forEach(tag => likedTags.genres.add(tag));
          trackTags.instruments?.forEach(tag => likedTags.instruments.add(tag));
          trackTags.moods?.forEach(tag => likedTags.moods.add(tag));
          trackTags.themes?.forEach(tag => likedTags.themes.add(tag));
        }
      }
    });

    // 从所有歌曲中筛选：没有表达过厌恶，但也没有展示过喜爱的tag的歌
    const candidateTracks = [];
    
    for (const [trackId, trackTags] of trackTagsMap.entries()) {
      // 检查是否有厌恶的标签
      const hasDislikedTag = 
        trackTags.genres?.some(tag => dislikedTags.genres.has(tag)) ||
        trackTags.instruments?.some(tag => dislikedTags.instruments.has(tag)) ||
        trackTags.moods?.some(tag => dislikedTags.moods.has(tag)) ||
        trackTags.themes?.some(tag => dislikedTags.themes.has(tag));

      // 检查是否有喜爱的标签
      const hasLikedTag = 
        trackTags.genres?.some(tag => likedTags.genres.has(tag)) ||
        trackTags.instruments?.some(tag => likedTags.instruments.has(tag)) ||
        trackTags.moods?.some(tag => likedTags.moods.has(tag)) ||
        trackTags.themes?.some(tag => likedTags.themes.has(tag));

      // 如果没有厌恶标签，且没有喜爱标签，则符合条件
      if (!hasDislikedTag && !hasLikedTag) {
        candidateTracks.push(trackId);
      }
    }

    // 如果没有符合条件的歌曲，返回空
    if (candidateTracks.length === 0) {
      return res.json({
        success: false,
        message: '没有找到符合条件的多样性推荐歌曲'
      });
    }

    // 随机选择一首
    const randomIndex = Math.floor(Math.random() * candidateTracks.length);
    const selectedTrackId = candidateTracks[randomIndex];

    console.log(`🎲 多样性推荐: 为用户 ${username} 推荐 track_id: ${selectedTrackId}`);
    console.log(`   候选歌曲数量: ${candidateTracks.length}`);

    res.json({
      success: true,
      trackId: selectedTrackId
    });
  } catch (error) {
    console.error('❌ 多样性推荐失败:', error);
    res.status(500).json({ success: false, message: '多样性推荐失败: ' + error.message });
  }
});

// 偏好热力图接口：从 user_preferences 表读取 tags 与权重（支持 system_type）
app.post('/api/preferences/heatmap', async (req, res) => {
  const { username, system_type: systemType } = req.body;
  if (!username) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
  }
  const systemTypeNorm = systemType === 'B' ? 'B' : 'A';

  try {
    const stmt = db.prepare('SELECT genres, instruments, moods, themes, genres_weights, instruments_weights, moods_weights, themes_weights FROM user_preferences WHERE username = ? AND system_type = ?');
    stmt.bind([username, systemTypeNorm]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();

    const parseJson = (val) => {
      if (val == null) return null;
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch (e) { return null; }
      }
      return val;
    };

    const tagsByCat = {
      genres: row ? parseJson(row.genres) || [] : [],
      instruments: row ? parseJson(row.instruments) || [] : [],
      moods: row ? parseJson(row.moods) || [] : [],
      themes: row ? parseJson(row.themes) || [] : []
    };
    const weightsByCat = {
      genres: row ? parseJson(row.genres_weights) || {} : {},
      instruments: row ? parseJson(row.instruments_weights) || {} : {},
      moods: row ? parseJson(row.moods_weights) || {} : {},
      themes: row ? parseJson(row.themes_weights) || {} : {}
    };

    // 按 user_preferences 的 tag 列表 + 权重构建 [{ tag, weight }]，按权重降序
    const buildCategory = (cat) => {
      const tags = Array.isArray(tagsByCat[cat]) ? tagsByCat[cat] : [];
      const weights = weightsByCat[cat] && typeof weightsByCat[cat] === 'object' ? weightsByCat[cat] : {};
      return tags
        .map((tag) => ({ tag, weight: Number(weights[tag]) || 1 }))
        .sort((a, b) => b.weight - a.weight);
    };

    const result = {
      genres: buildCategory('genres'),
      instruments: buildCategory('instruments'),
      moods: buildCategory('moods'),
      themes: buildCategory('themes')
    };

    console.log(`📊 偏好热力图(来自 user_preferences): 用户 ${username} 系统 ${systemTypeNorm}, genres=${result.genres.length}, instruments=${result.instruments.length}, moods=${result.moods.length}, themes=${result.themes.length}`);

    res.json({
      success: true,
      genres: result.genres,
      instruments: result.instruments,
      moods: result.moods,
      themes: result.themes
    });
  } catch (error) {
    console.error('❌ 获取偏好热力图失败:', error);
    res.status(500).json({ success: false, message: '获取偏好热力图失败: ' + error.message });
  }
});

// 记录「系统眼中的你」请求：请求时间、返回文字、treemap tag 与权重
app.post('/api/system-eyes/log', (req, res) => {
  const { username, system_type: systemType, explanation_text: explanationText, treemap_data: treemapData } = req.body;
  if (!username) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
  }
  const systemTypeNorm = systemType === 'B' ? 'B' : 'A';
  try {
    const treemapJson = typeof treemapData === 'string' ? treemapData : JSON.stringify(treemapData ?? {});
    const stmt = db.prepare(`
      INSERT INTO user_system_eyes_log (username, system_type, requested_at, requested_at_timestamp, explanation_text, treemap_data)
      VALUES (?, ?, ${DB_NOW}, ${DB_UNIX}, ?, ?)
    `);
    stmt.run([username, systemTypeNorm, explanationText ?? '', treemapJson]);
    stmt.free();
    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    console.error('❌ 记录系统眼中的你失败:', error);
    res.status(500).json({ success: false, message: '记录失败: ' + error.message });
  }
});

// 生产部署：若有 public 目录则托管前端静态文件并 SPA 回退（前端 build 产物放入 backend/public）
const publicPath = join(__dirname, 'public');
if (existsSync(publicPath)) {
  app.use(express.static(publicPath));
  app.get('*', (req, res) => {
    res.sendFile(join(publicPath, 'index.html'), (err) => { if (err) res.status(500).send('Not found'); });
  });
}

// 服务器在 loadDatabase().then() 中启动
