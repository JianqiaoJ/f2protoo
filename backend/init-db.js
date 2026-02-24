import initSqlJs from 'sql.js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 数据库文件路径
const dbPath = join(__dirname, 'users.db');

async function initDatabase() {
  // 初始化 SQL.js
  const SQL = await initSqlJs();
  
  // 创建新数据库
  const db = new SQL.Database();

  // 创建用户表
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at_timestamp INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // 创建用户听歌行为表
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

  // 对话历史表：与上面结构一致，永不删除，仅追加
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

  // 「为什么推荐这首」按钮点击记录：时间、用户名、点击后系统返回的解释消息
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

  // 插入初始用户数据（user1～user10 与 user11～user20）
  const initialUsers = [
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

  const stmt = db.prepare('INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)');
  
  for (const user of initialUsers) {
    stmt.run([user.username, user.password]);
  }
  stmt.free();

  // 保存数据库到文件
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);

  console.log('数据库初始化完成！');
  console.log('数据库文件位置:', dbPath);
  console.log('已创建用户表并插入初始数据：');
  
  const result = db.exec('SELECT * FROM users');
  if (result.length > 0) {
    const users = result[0].values.map(row => ({
      id: row[0],
      username: row[1],
      password: row[2],
      created_at: row[3]
    }));
    console.table(users);
  }

  db.close();
}

initDatabase().catch(console.error);
