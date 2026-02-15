// 推荐算法实现模块

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 解析TAGS字符串
function parseTags(tagsString) {
  const tags = {
    genres: [],
    instruments: [],
    moods: [],
    themes: [],
  };

  if (!tagsString) return tags;

  const tagList = tagsString.split('\t').filter(t => t.trim());
  
  tagList.forEach(tag => {
    const trimmed = tag.trim();
    if (trimmed.startsWith('genre---')) {
      tags.genres.push(trimmed.replace('genre---', ''));
    } else if (trimmed.startsWith('instrument---')) {
      tags.instruments.push(trimmed.replace('instrument---', ''));
    } else if (trimmed.startsWith('mood---')) {
      tags.moods.push(trimmed.replace('mood---', ''));
    } else if (trimmed.startsWith('theme---')) {
      tags.themes.push(trimmed.replace('theme---', ''));
    } else if (trimmed.startsWith('mood/theme---')) {
      // mood/theme格式的标签，只添加到themes（mood/theme是同一种标签）
      const value = trimmed.replace('mood/theme---', '');
      tags.themes.push(value);
    }
  });

  return tags;
}

// 加载标签数据
let trackTagsMap = new Map();
let allTrackIds = [];

function loadTrackTags() {
  try {
    // raw.tsv文件路径（优先使用当前目录，如果不存在则使用上一级目录）
    let tsvPath = join(__dirname, 'raw.tsv');
    if (!existsSync(tsvPath)) {
      tsvPath = join(__dirname, '..', 'raw.tsv');
    }
    const content = readFileSync(tsvPath, 'utf-8');
    const lines = content.split('\n');
    
    trackTagsMap.clear();
    allTrackIds = [];
    
    // 跳过表头
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        const columns = line.split('\t');
        if (columns[0]) {
          const trackId = columns[0];
          allTrackIds.push(trackId);
          
          // 解析tags（从第6列开始）
          if (columns.length > 5) {
            const tagsString = columns.slice(5).join('\t');
            const tags = parseTags(tagsString);
            trackTagsMap.set(trackId, tags);
          }
        }
      }
    }
    
    console.log(`已加载 ${allTrackIds.length} 首歌曲的标签数据`);
    return true;
  } catch (error) {
    console.error('加载标签数据失败:', error);
    return false;
  }
}

// 计算内容匹配分数
function calculateContentScore(trackTags, userPreferences) {
  let score = 0;
  
  // Genre匹配（权重：3.0）
  if (userPreferences.genres && userPreferences.genres.length > 0) {
    const genreMatches = trackTags.genres.filter(g => 
      userPreferences.genres.includes(g)
    ).length;
    score += genreMatches * 3.0;
  }
  
  // Instrument匹配（权重：2.0）
  if (userPreferences.instruments && userPreferences.instruments.length > 0) {
    const instrumentMatches = trackTags.instruments.filter(i => 
      userPreferences.instruments.includes(i)
    ).length;
    score += instrumentMatches * 2.0;
  }
  
  // Mood匹配（权重：2.0）
  if (userPreferences.moods && userPreferences.moods.length > 0) {
    const moodMatches = trackTags.moods.filter(m => 
      userPreferences.moods.includes(m)
    ).length;
    score += moodMatches * 2.0;
  }
  
  // Theme匹配（权重：1.0）
  if (userPreferences.themes && userPreferences.themes.length > 0) {
    const themeMatches = trackTags.themes.filter(t => 
      userPreferences.themes.includes(t)
    ).length;
    score += themeMatches * 1.0;
  }
  
  // 标签覆盖率加成
  const totalTags = trackTags.genres.length + 
                    trackTags.instruments.length + 
                    trackTags.moods.length + 
                    trackTags.themes.length;
  if (totalTags > 0) {
    const matchedTags = (userPreferences.genres || []).filter(g => 
      trackTags.genres.includes(g)
    ).length +
    (userPreferences.instruments || []).filter(i => 
      trackTags.instruments.includes(i)
    ).length +
    (userPreferences.moods || []).filter(m => 
      trackTags.moods.includes(m)
    ).length +
    (userPreferences.themes || []).filter(t => 
      trackTags.themes.includes(t)
    ).length;
    
    const coverage = matchedTags / totalTags;
    score *= (1 + coverage * 0.2); // 覆盖率加成最高20%
  }
  
  return score;
}

// 计算行为权重
function calculateBehaviorWeight(rating, duration, isFavorited, timestamp = null, favoriteCount = 1) {
  // 评分权重
  const ratingWeight = rating === 5 ? 1.0 :
                       rating === 4 ? 0.8 :
                       rating === 3 ? 0.5 :
                       rating === 2 ? 0.2 : 0.1;
  
  // 听歌时长权重
  const durationWeight = duration >= 60 ? 1.0 :
                         duration >= 30 ? 0.7 :
                         duration >= 10 ? 0.4 : 0.1;
  
  // 收藏权重 - 根据收藏次数和时间衰减计算
  let favoriteWeight = 1.0;
  if (isFavorited) {
    // 基础收藏权重
    favoriteWeight = 1.5;
    
    // 重复收藏的权重加成（每次收藏增加0.3）
    favoriteWeight += (favoriteCount - 1) * 0.3;
    
    // 时间衰减：最近收藏的歌曲给予更高权重
    if (timestamp) {
      const now = new Date();
      const recordTime = new Date(timestamp);
      const hoursAgo = (now - recordTime) / (1000 * 60 * 60);
      
      // 24小时内收藏的歌曲给予额外权重
      if (hoursAgo < 24) {
        favoriteWeight *= (1 + (24 - hoursAgo) / 24 * 0.5); // 最多额外50%权重
      }
    }
  }
  
  // 综合权重
  return (ratingWeight * 0.6 + durationWeight * 0.3) * favoriteWeight;
}

// 从行为历史中提取隐式偏好
function extractImplicitPreferences(behaviorHistory) {
  const tagWeights = {
    genres: new Map(),
    instruments: new Map(),
    moods: new Map(),
    themes: new Map()
  };
  
  // 统计每个track_id的收藏次数
  const favoriteCounts = new Map();
  behaviorHistory.forEach(record => {
    if (record.is_favorited) {
      const count = favoriteCounts.get(record.track_id) || 0;
      favoriteCounts.set(record.track_id, count + 1);
    }
  });
  
  behaviorHistory.forEach(record => {
    const favoriteCount = favoriteCounts.get(record.track_id) || (record.is_favorited ? 1 : 0);
    const behaviorWeight = calculateBehaviorWeight(
      record.rating || 0,
      record.listen_duration || 0,
      record.is_favorited || false,
      record.timestamp,
      favoriteCount
    );
    
    const trackTags = getTrackTagsByAnyId(trackTagsMap, record.track_id);
    if (trackTags) {
      trackTags.genres.forEach(g => {
        tagWeights.genres.set(g, 
          (tagWeights.genres.get(g) || 0) + behaviorWeight
        );
      });
      trackTags.instruments.forEach(i => {
        tagWeights.instruments.set(i, 
          (tagWeights.instruments.get(i) || 0) + behaviorWeight
        );
      });
      trackTags.moods.forEach(m => {
        tagWeights.moods.set(m, 
          (tagWeights.moods.get(m) || 0) + behaviorWeight
        );
      });
      trackTags.themes.forEach(t => {
        tagWeights.themes.set(t, 
          (tagWeights.themes.get(t) || 0) + behaviorWeight
        );
      });
    }
  });
  
  // 返回Top N标签
  function getTopNTags(tagMap, n) {
    return Array.from(tagMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([tag]) => tag);
  }
  
  return {
    genres: getTopNTags(tagWeights.genres, 5),
    instruments: getTopNTags(tagWeights.instruments, 5),
    moods: getTopNTags(tagWeights.moods, 5),
    themes: getTopNTags(tagWeights.themes, 5)
  };
}

// 合并显式和隐式偏好
function combinePreferences(explicitPrefs, implicitPrefs, behaviorCount) {
  // 根据行为数据量调整权重
  let explicitWeight, implicitWeight;
  if (behaviorCount < 5) {
    explicitWeight = 0.8;
    implicitWeight = 0.2;
  } else {
    explicitWeight = 0.6;
    implicitWeight = 0.4;
  }
  
  function mergeTagLists(explicit, implicit) {
    const merged = new Set(explicit || []);
    implicit.forEach(tag => merged.add(tag));
    return Array.from(merged);
  }
  
  return {
    genres: mergeTagLists(explicitPrefs.genres, implicitPrefs.genres),
    instruments: mergeTagLists(explicitPrefs.instruments, implicitPrefs.instruments),
    moods: mergeTagLists(explicitPrefs.moods, implicitPrefs.moods),
    themes: mergeTagLists(explicitPrefs.themes, implicitPrefs.themes)
  };
}

// 计算标签相似度
function calculateTagSimilarity(tags1, tags2) {
  const allTags1 = new Set([
    ...tags1.genres,
    ...tags1.instruments,
    ...tags1.moods,
    ...tags1.themes
  ]);
  const allTags2 = new Set([
    ...tags2.genres,
    ...tags2.instruments,
    ...tags2.moods,
    ...tags2.themes
  ]);
  
  const intersection = new Set([...allTags1].filter(x => allTags2.has(x)));
  const union = new Set([...allTags1, ...allTags2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}

// 确保多样性
function ensureDiversity(recommendedTracks, maxSimilarity = 0.7) {
  const diverseTracks = [];
  
  recommendedTracks.forEach(({ trackId, score }) => {
    const trackTags = trackTagsMap.get(trackId);
    if (!trackTags) return;
    
    const isDiverse = diverseTracks.every(existing => {
      const existingTags = trackTagsMap.get(existing.trackId);
      if (!existingTags) return true;
      
      const similarity = calculateTagSimilarity(trackTags, existingTags);
      return similarity < maxSimilarity;
    });
    
    if (isDiverse) {
      diverseTracks.push({ trackId, score });
    }
  });
  
  return diverseTracks;
}

// 生成推荐
// excludedTags: 用户明确不喜欢的 tag，带这些 tag 的歌曲一律不推荐 { genres: [], instruments: [], moods: [], themes: [] }
// additionalExcludedIds: 额外要排除的 track_id 列表（如历史已推荐过的曲目），不再推荐
export function generateRecommendations(
  explicitPrefs,
  behaviorHistory,
  currentTrackId,
  count = 3,
  excludedTags = {},
  additionalExcludedIds = []
) {
  // 如果标签数据未加载，先加载
  if (trackTagsMap.size === 0) {
    loadTrackTags();
  }

  const excluded = {
    genres: Array.isArray(excludedTags.genres) ? excludedTags.genres : [],
    instruments: Array.isArray(excludedTags.instruments) ? excludedTags.instruments : [],
    moods: Array.isArray(excludedTags.moods) ? excludedTags.moods : [],
    themes: Array.isArray(excludedTags.themes) ? excludedTags.themes : []
  };
  const hasExcludedTag = (trackTags) => {
    if (!trackTags) return false;
    if (excluded.genres.length && (trackTags.genres || []).some(t => excluded.genres.includes(t))) return true;
    if (excluded.instruments.length && (trackTags.instruments || []).some(t => excluded.instruments.includes(t))) return true;
    if (excluded.moods.length && (trackTags.moods || []).some(t => excluded.moods.includes(t))) return true;
    if (excluded.themes.length && (trackTags.themes || []).some(t => excluded.themes.includes(t))) return true;
    return false;
  };
  if (excluded.genres.length || excluded.instruments.length || excluded.moods.length || excluded.themes.length) {
    console.log(`🚫 排除标签 (用户明确不喜欢，带这些 tag 的歌曲不推荐):`);
    if (excluded.genres.length) console.log(`   风格: ${excluded.genres.join(', ')}`);
    if (excluded.instruments.length) console.log(`   乐器: ${excluded.instruments.join(', ')}`);
    if (excluded.moods.length) console.log(`   情绪: ${excluded.moods.join(', ')}`);
    if (excluded.themes.length) console.log(`   主题: ${excluded.themes.join(', ')}`);
  }
  
  // 提取隐式偏好
  const implicitPrefs = extractImplicitPreferences(behaviorHistory);
  
  if (implicitPrefs.genres.length > 0 || implicitPrefs.instruments.length > 0 || 
      implicitPrefs.moods.length > 0 || implicitPrefs.themes.length > 0) {
    console.log(`📊 隐式偏好 (从行为历史提取):`);
    if (implicitPrefs.genres.length > 0) {
      console.log(`   风格: ${implicitPrefs.genres.join(', ')}`);
    }
    if (implicitPrefs.instruments.length > 0) {
      console.log(`   乐器: ${implicitPrefs.instruments.join(', ')}`);
    }
    if (implicitPrefs.moods.length > 0) {
      console.log(`   情绪: ${implicitPrefs.moods.join(', ')}`);
    }
    if (implicitPrefs.themes.length > 0) {
      console.log(`   主题: ${implicitPrefs.themes.join(', ')}`);
    }
  }
  
  // 合并偏好
  const combinedPrefs = combinePreferences(
    explicitPrefs,
    implicitPrefs,
    behaviorHistory.length
  );
  
  console.log(`🔀 合并后的偏好:`);
  if (combinedPrefs.genres.length > 0) {
    console.log(`   风格: ${combinedPrefs.genres.join(', ')}`);
  }
  if (combinedPrefs.instruments.length > 0) {
    console.log(`   乐器: ${combinedPrefs.instruments.join(', ')}`);
  }
  if (combinedPrefs.moods.length > 0) {
    console.log(`   情绪: ${combinedPrefs.moods.join(', ')}`);
  }
  if (combinedPrefs.themes.length > 0) {
    console.log(`   主题: ${combinedPrefs.themes.join(', ')}`);
  }
  
  // 已推荐/播放过的歌曲不再推荐：当前歌曲 + 行为历史 + 历史已推荐过的曲目（统一用无前缀 id 比较）
  const normalizeId = (id) => (id == null || id === '' ? '' : String(id).replace(/^track_/, ''));
  const excludedIds = new Set([
    normalizeId(currentTrackId),
    ...behaviorHistory.map((r) => normalizeId(r.track_id)),
    ...(Array.isArray(additionalExcludedIds) ? additionalExcludedIds : []).map(normalizeId).filter(Boolean)
  ]);
  
  // 计算候选歌曲的分数（全量打分，不抽样）
  const scoredTracks = allTrackIds
    .map(trackId => {
      const trackTags = trackTagsMap.get(trackId);
      if (!trackTags) return { trackId, score: 0, contentScore: 0, behaviorScore: 0 };
      
      // 排除当前歌曲和已推荐/播放过的歌曲
      if (excludedIds.has(normalizeId(trackId))) return { trackId, score: 0, contentScore: 0, behaviorScore: 0 };
      // 排除含有用户明确不喜欢 tag 的歌曲
      if (hasExcludedTag(trackTags)) return { trackId, score: 0, contentScore: 0, behaviorScore: 0 };
      
      // 内容匹配分数
      const contentScore = calculateContentScore(trackTags, combinedPrefs);
      
      // 行为分数（基于历史行为）
      let behaviorScore = 0;
      
      // 统计每个 track_id 的收藏次数（用 normalizeId 统一格式，避免 track_123 与 123 重复计）
      const favoriteCounts = new Map();
      behaviorHistory.forEach(record => {
        if (record.is_favorited) {
          const nid = normalizeId(record.track_id);
          const count = favoriteCounts.get(nid) || 0;
          favoriteCounts.set(nid, count + 1);
        }
      });
      
      behaviorHistory.forEach(record => {
        const nidRec = normalizeId(record.track_id);
        const favoriteCount = favoriteCounts.get(nidRec) || (record.is_favorited ? 1 : 0);
        if (nidRec === normalizeId(trackId)) {
          const weight = calculateBehaviorWeight(
            record.rating || 0,
            record.listen_duration || 0,
            record.is_favorited || false,
            record.timestamp,
            favoriteCount
          );
          behaviorScore += weight;
        } else {
          // 计算标签相似度（需能根据行为里的 track_id 查到 tag，getTrackTagsByAnyId 已兼容多种 id 格式）
          const recordTags = getTrackTagsByAnyId(trackTagsMap, record.track_id);
          if (recordTags) {
            const similarity = calculateTagSimilarity(trackTags, recordTags);
            if (similarity > 0.3) {
              const weight = calculateBehaviorWeight(
                record.rating || 0,
                record.listen_duration || 0,
                record.is_favorited || false,
                record.timestamp,
                favoriteCount
              );
              behaviorScore += similarity * weight;
            }
          }
        }
      });
      
      // 归一化行为分数
      if (behaviorHistory.length > 0) {
        behaviorScore = behaviorScore / behaviorHistory.length;
      }
      
      // 最终分数
      let finalScore = contentScore * 0.6 + behaviorScore * 0.3;
      
      // 如果用户没有任何偏好和行为数据，给所有歌曲一个基础分数（随机推荐）
      const hasPreferences = (combinedPrefs.genres && combinedPrefs.genres.length > 0) ||
                            (combinedPrefs.instruments && combinedPrefs.instruments.length > 0) ||
                            (combinedPrefs.moods && combinedPrefs.moods.length > 0) ||
                            (combinedPrefs.themes && combinedPrefs.themes.length > 0);
      
      if (!hasPreferences && behaviorHistory.length === 0) {
        // 冷启动：给所有歌曲一个小的随机分数，确保有推荐
        finalScore = Math.random() * 0.1; // 0-0.1之间的随机分数
      }
      
      return { trackId, score: finalScore, contentScore, behaviorScore, trackTags };
    })
    .filter(t => t.score > 0) // 只保留有分数的
    .sort((a, b) => b.score - a.score); // 按分数降序排序
  
  // 输出前10个推荐的详细信息（包含打分细则）
  if (scoredTracks.length > 0) {
    console.log(`📊 推荐分数详情 (前10名，包含打分细则):`);
    scoredTracks.slice(0, 10).forEach((track, index) => {
      const tags = track.trackTags || trackTagsMap.get(track.trackId);
      const matchedTags = [];
      if (tags) {
        if (combinedPrefs.genres && combinedPrefs.genres.length > 0) {
          const matchedGenres = tags.genres.filter(g => combinedPrefs.genres.includes(g));
          if (matchedGenres.length > 0) matchedTags.push(`风格:${matchedGenres.join(',')}`);
        }
        if (combinedPrefs.instruments && combinedPrefs.instruments.length > 0) {
          const matchedInstruments = tags.instruments.filter(i => combinedPrefs.instruments.includes(i));
          if (matchedInstruments.length > 0) matchedTags.push(`乐器:${matchedInstruments.join(',')}`);
        }
        if (combinedPrefs.moods && combinedPrefs.moods.length > 0) {
          const matchedMoods = tags.moods.filter(m => combinedPrefs.moods.includes(m));
          if (matchedMoods.length > 0) matchedTags.push(`情绪:${matchedMoods.join(',')}`);
        }
        if (combinedPrefs.themes && combinedPrefs.themes.length > 0) {
          const matchedThemes = tags.themes.filter(t => combinedPrefs.themes.includes(t));
          if (matchedThemes.length > 0) matchedTags.push(`主题:${matchedThemes.join(',')}`);
        }
      }
      
      // 显示详细的打分细则
      console.log(`   ${index + 1}. ${track.trackId}:`);
      console.log(`      ├─ 内容匹配分数: ${track.contentScore.toFixed(3)} (权重60%)`);
      console.log(`      ├─ 行为历史分数: ${track.behaviorScore.toFixed(3)} (权重30%)`);
      console.log(`      ├─ 最终分数: ${track.score.toFixed(3)}`);
      if (matchedTags.length > 0) {
        console.log(`      └─ 匹配标签: ${matchedTags.join(', ')}`);
      } else {
        console.log(`      └─ 匹配标签: 无`);
      }
    });
  }
  
  // 如果过滤后没有歌曲，返回随机选择（仍排除已推荐/播放过的、以及含排除 tag 的）
  if (scoredTracks.length === 0) {
    console.warn('推荐算法没有找到匹配的歌曲，返回随机选择');
    const availableTracks = allTrackIds.filter(id => {
      if (excludedIds.has(normalizeId(id))) return false;
      const tags = trackTagsMap.get(id);
      return !hasExcludedTag(tags);
    });
    const shuffled = availableTracks.sort(() => Math.random() - 0.5);
    const ids = shuffled.slice(0, count);
    return { trackIds: ids, scores: ids.map(() => 0) };
  }
  
  // 确保多样性
  const diverseTracks = ensureDiversity(scoredTracks, 0.7);
  
  // 如果多样性处理后没有足够的歌曲，补充随机选择（仍排除已推荐/播放过的、以及含排除 tag 的）
  if (diverseTracks.length < count) {
    const diverseTrackIds = new Set(diverseTracks.map(t => t.trackId));
    const remainingTracks = allTrackIds
      .filter(id => !excludedIds.has(normalizeId(id)) && !diverseTrackIds.has(id) && !hasExcludedTag(trackTagsMap.get(id)))
      .sort(() => Math.random() - 0.5)
      .slice(0, count - diverseTracks.length);
    const trackIds = [...diverseTracks.map(t => t.trackId), ...remainingTracks].slice(0, count);
    const scoreMap = new Map(diverseTracks.map(t => [t.trackId, t.score]));
    const scores = trackIds.map(id => scoreMap.get(id) ?? 0);
    return { trackIds, scores };
  }
  
  // 返回Top N（含召回分数）
  const top = diverseTracks.slice(0, count);
  return { trackIds: top.map(t => t.trackId), scores: top.map(t => t.score) };
}

/**
 * 根据显式偏好与行为历史得到合并后的偏好（与 generateRecommendations 内逻辑一致）
 */
export function getCombinedPreferences(finalPrefs, behaviorHistory) {
  const implicitPrefs = extractImplicitPreferences(behaviorHistory);
  return combinePreferences(finalPrefs, implicitPrefs, behaviorHistory.length);
}

/**
 * 获取单曲的推荐理由（内容分、行为分、匹配标签），供「为什么推荐这首」使用
 * @param {Object} combinedPrefs - 合并后的用户偏好 { genres, instruments, moods, themes }
 * @param {Array} behaviorHistory - 用户行为历史
 * @param {string} trackId - 歌曲 ID
 * @returns {Object|null} { contentScore, behaviorScore, finalScore, matchedTags: { genres, instruments, moods, themes }, trackTags } 或 null
 */
export function getTrackRecommendationReason(combinedPrefs, behaviorHistory, trackId) {
  if (trackTagsMap.size === 0) loadTrackTags();
  const trackTags = getTrackTagsByAnyId(trackTagsMap, trackId);
  if (!trackTags) return null;

  const contentScore = calculateContentScore(trackTags, combinedPrefs);

  let behaviorScore = 0;
  const favoriteCounts = new Map();
  behaviorHistory.forEach(record => {
    if (record.is_favorited) {
      const count = favoriteCounts.get(record.track_id) || 0;
      favoriteCounts.set(record.track_id, count + 1);
    }
  });
  behaviorHistory.forEach(record => {
    const favoriteCount = favoriteCounts.get(record.track_id) || (record.is_favorited ? 1 : 0);
    if (record.track_id === trackId) {
      const weight = calculateBehaviorWeight(
        record.rating || 0,
        record.listen_duration || 0,
        record.is_favorited || false,
        record.timestamp,
        favoriteCount
      );
      behaviorScore += weight;
    } else {
      const recordTags = getTrackTagsByAnyId(trackTagsMap, record.track_id);
      if (recordTags) {
        const similarity = calculateTagSimilarity(trackTags, recordTags);
        if (similarity > 0.5) {
          const weight = calculateBehaviorWeight(
            record.rating || 0,
            record.listen_duration || 0,
            record.is_favorited || false,
            record.timestamp,
            favoriteCount
          );
          behaviorScore += similarity * weight;
        }
      }
    }
  });
  if (behaviorHistory.length > 0) behaviorScore = behaviorScore / behaviorHistory.length;

  let finalScore = contentScore * 0.6 + behaviorScore * 0.3;
  const hasPreferences = (combinedPrefs.genres && combinedPrefs.genres.length > 0) ||
    (combinedPrefs.instruments && combinedPrefs.instruments.length > 0) ||
    (combinedPrefs.moods && combinedPrefs.moods.length > 0) ||
    (combinedPrefs.themes && combinedPrefs.themes.length > 0);
  if (!hasPreferences && behaviorHistory.length === 0) {
    finalScore = Math.random() * 0.1;
  }

  const matchedTags = {
    genres: (trackTags.genres || []).filter(g => combinedPrefs.genres && combinedPrefs.genres.includes(g)),
    instruments: (trackTags.instruments || []).filter(i => combinedPrefs.instruments && combinedPrefs.instruments.includes(i)),
    moods: (trackTags.moods || []).filter(m => combinedPrefs.moods && combinedPrefs.moods.includes(m)),
    themes: (trackTags.themes || []).filter(t => combinedPrefs.themes && combinedPrefs.themes.includes(t)),
  };

  return {
    contentScore,
    behaviorScore,
    finalScore,
    matchedTags,
    trackTags: { genres: trackTags.genres || [], instruments: trackTags.instruments || [], moods: trackTags.moods || [], themes: trackTags.themes || [] },
  };
}

/**
 * 仅根据歌曲标签与用户偏好计算推荐理由（无行为分），用于 trackId 不在 raw.tsv 时由前端传入 trackTags
 * @param {Object} combinedPrefs - 合并后的用户偏好
 * @param {Object} trackTags - 歌曲标签 { genres, instruments, moods, themes }
 * @returns {Object} { contentScore, behaviorScore, finalScore, matchedTags, trackTags }
 */
export function getTrackRecommendationReasonFromTags(combinedPrefs, trackTags) {
  if (!trackTags) return null;
  const genres = trackTags.genres || [];
  const instruments = trackTags.instruments || [];
  const moods = trackTags.moods || [];
  const themes = trackTags.themes || [];
  const normalized = { genres, instruments, moods, themes };
  const contentScore = calculateContentScore(normalized, combinedPrefs);
  const behaviorScore = 0;
  const finalScore = contentScore * 0.6;
  const matchedTags = {
    genres: genres.filter(g => combinedPrefs.genres && combinedPrefs.genres.includes(g)),
    instruments: instruments.filter(i => combinedPrefs.instruments && combinedPrefs.instruments.includes(i)),
    moods: moods.filter(m => combinedPrefs.moods && combinedPrefs.moods.includes(m)),
    themes: themes.filter(t => combinedPrefs.themes && combinedPrefs.themes.includes(t)),
  };
  return {
    contentScore,
    behaviorScore,
    finalScore,
    matchedTags,
    trackTags: normalized,
  };
}

// 按任意 ID 格式查找标签：行为表可能存 track_xxx 或数字，raw.tsv 的 key 可能是 track_xxx 或数字，需双向兼容
function getTrackTagsByAnyId(map, id) {
  if (id == null || id === '') return undefined;
  const s = String(id).trim();
  const withoutPrefix = s.replace(/^track_/, '');
  return map.get(s) || map.get('track_' + s) || (withoutPrefix !== s ? map.get(withoutPrefix) : null);
}

// 导出trackTagsMap和allTrackIds供其他模块使用
export function getTrackTagsMap() {
  return trackTagsMap;
}

export function getAllTrackIds() {
  return allTrackIds;
}

export { getTrackTagsByAnyId };

// 初始化加载标签数据
loadTrackTags();
