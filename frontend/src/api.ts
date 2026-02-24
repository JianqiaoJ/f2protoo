import axios from 'axios';
import { JamendoTrack, TrackTags } from './types';

const JAMENDO_CLIENT_ID = '1ccf1f44';
const JAMENDO_API_BASE = 'https://api.jamendo.com/v3.0';

// 存储track_id到tags的映射
let trackTagsMap: Map<string, TrackTags> = new Map();

// Convert track_0000214 to 214
function extractTrackId(trackId: string): string {
  const match = trackId.match(/track_(\d+)/);
  return match ? match[1] : trackId.replace('track_', '');
}

// 解析TAGS字符串，提取genre、instrument、mood/theme
function parseTags(tagsString: string): TrackTags {
  const tags: TrackTags = {
    genres: [],
    instruments: [],
    moods: [],
    themes: [],
  };

  if (!tagsString) return tags;

  // TAGS字段可能包含多个标签，用制表符分隔
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
      // mood/theme 格式：同时加入情绪与主题，冷启动可展示「情绪」标签
      const value = trimmed.replace('mood/theme---', '');
      tags.moods.push(value);
      tags.themes.push(value);
    }
  });

  return tags;
}

// 存储所有可用的标签
let allAvailableTags: {
  genres: Set<string>;
  instruments: Set<string>;
  moods: Set<string>;
  themes: Set<string>;
} = {
  genres: new Set(),
  instruments: new Set(),
  moods: new Set(),
  themes: new Set(),
};

export const jamendoApi = {
  // 获取所有可用的标签
  getAllAvailableTags(): { genres: string[]; instruments: string[]; moods: string[]; themes: string[] } {
    return {
      genres: Array.from(allAvailableTags.genres).sort(),
      instruments: Array.from(allAvailableTags.instruments).sort(),
      moods: Array.from(allAvailableTags.moods).sort(),
      themes: Array.from(allAvailableTags.themes).sort(),
    };
  },

  // 根据标签推荐歌曲
  async recommendTracksByTags(tags: { genres?: string[]; instruments?: string[]; moods?: string[]; themes?: string[] }, trackIds: string[]): Promise<string[]> {
    const recommendedTrackIds: string[] = [];
    
    for (const trackId of trackIds) {
      const trackTags = trackTagsMap.get(trackId);
      if (!trackTags) continue;

      let matchScore = 0;
      
      // 计算匹配分数
      if (tags.genres && tags.genres.length > 0) {
        const genreMatches = tags.genres.filter(g => trackTags.genres.includes(g)).length;
        matchScore += genreMatches * 3; // 风格匹配权重更高
      }
      if (tags.instruments && tags.instruments.length > 0) {
        const instrumentMatches = tags.instruments.filter(i => trackTags.instruments.includes(i)).length;
        matchScore += instrumentMatches * 2;
      }
      if (tags.moods && tags.moods.length > 0) {
        const moodMatches = tags.moods.filter(m => trackTags.moods.includes(m)).length;
        matchScore += moodMatches * 2;
      }
      if (tags.themes && tags.themes.length > 0) {
        const themeMatches = tags.themes.filter(t => trackTags.themes.includes(t)).length;
        matchScore += themeMatches * 1;
      }

      if (matchScore > 0) {
        recommendedTrackIds.push(trackId);
      }
    }

    // 按匹配分数排序（简单实现，可以优化）
    return recommendedTrackIds.slice(0, 10); // 返回前10个匹配的歌曲
  },

  /** 单曲详情请求超时（毫秒），避免 Jamendo 无响应时推荐列表有但迟迟不播 */
  getTrackByIdTimeoutMs: 15000,

  async getTrackById(trackId: string): Promise<JamendoTrack> {
    const numericId = extractTrackId(trackId);
    try {
      const response = await axios.get(`${JAMENDO_API_BASE}/tracks/`, {
        params: {
          client_id: JAMENDO_CLIENT_ID,
          id: numericId,
          format: 'json',
          limit: 1,
        },
        timeout: this.getTrackByIdTimeoutMs,
      });

      if (response.data?.results && response.data.results.length > 0) {
        const track = response.data.results[0];
        // 获取该track的tags
        const tags = trackTagsMap.get(trackId) || {
          genres: [],
          instruments: [],
          moods: [],
          themes: [],
        };
        
        return {
          id: track.id.toString(),
          name: track.name || 'Unknown',
          artist_name: track.artist_name || 'Unknown Artist',
          album_name: track.album_name || 'Unknown Album',
          image: track.image || track.album_image || '',
          audio: track.audio || track.audiodownload || '',
          duration: track.duration || 0,
          releasedate: track.releasedate || '',
          tags,
        };
      } else {
        throw new Error(`Track ${trackId} not found`);
      }
    } catch (error) {
      console.error('Jamendo API error:', error);
      throw new Error(`Failed to fetch track ${trackId}`);
    }
  },

  /** 按艺术家名取一首随机曲目（用于喜爱艺术家插队），失败返回 null */
  async getOneTrackByArtistName(artistName: string): Promise<JamendoTrack | null> {
    if (!artistName?.trim()) return null;
    try {
      const artistRes = await axios.get(`${JAMENDO_API_BASE}/artists/`, {
        params: { client_id: JAMENDO_CLIENT_ID, namesearch: artistName.trim(), limit: 1, format: 'json' },
        timeout: 8000,
      });
      const artists = artistRes.data?.results;
      if (!artists?.length) return null;
      const artistId = artists[0].id;
      const tracksRes = await axios.get(`${JAMENDO_API_BASE}/artists/tracks/`, {
        params: { client_id: JAMENDO_CLIENT_ID, id: artistId, limit: 50, format: 'json' },
        timeout: 8000,
      });
      const tracks = tracksRes.data?.results;
      if (!tracks?.length) return null;
      const raw = tracks[Math.floor(Math.random() * tracks.length)];
      const trackId = `track_${raw.id}`;
      const tags = trackTagsMap.get(trackId) || { genres: [], instruments: [], moods: [], themes: [] };
      return {
        id: String(raw.id),
        name: raw.name || 'Unknown',
        artist_name: raw.artist_name || artistName,
        album_name: raw.album_name || 'Unknown Album',
        image: raw.image || raw.album_image || '',
        audio: raw.audio || raw.audiodownload || '',
        duration: raw.duration || 0,
        releasedate: raw.releasedate || '',
        tags,
      };
    } catch (e) {
      console.warn('getOneTrackByArtistName failed:', e);
      return null;
    }
  },

  /** 按专辑名取一首随机曲目（用于喜爱专辑插队），失败返回 null */
  async getOneTrackByAlbumName(albumName: string): Promise<JamendoTrack | null> {
    if (!albumName?.trim()) return null;
    try {
      const albumRes = await axios.get(`${JAMENDO_API_BASE}/albums/`, {
        params: { client_id: JAMENDO_CLIENT_ID, namesearch: albumName.trim(), limit: 20, format: 'json' },
        timeout: 8000,
      });
      const albums = albumRes.data?.results;
      if (!albums?.length) return null;
      const album = albums[Math.floor(Math.random() * Math.min(albums.length, 5))];
      const tracksRes = await axios.get(`${JAMENDO_API_BASE}/albums/tracks/`, {
        params: { client_id: JAMENDO_CLIENT_ID, id: album.id, format: 'json' },
        timeout: 8000,
      });
      const tracks = tracksRes.data?.results;
      if (!tracks?.length) return null;
      const raw = tracks[Math.floor(Math.random() * tracks.length)];
      const trackId = `track_${raw.id}`;
      const tags = trackTagsMap.get(trackId) || { genres: [], instruments: [], moods: [], themes: [] };
      return {
        id: String(raw.id),
        name: raw.name || 'Unknown',
        artist_name: raw.artist_name || 'Unknown Artist',
        album_name: raw.album_name || albumName,
        image: raw.image || raw.album_image || '',
        audio: raw.audio || raw.audiodownload || '',
        duration: raw.duration || 0,
        releasedate: raw.releasedate || '',
        tags,
      };
    } catch (e) {
      console.warn('getOneTrackByAlbumName failed:', e);
      return null;
    }
  },

  async loadTrackIdsFromTSV(): Promise<string[]> {
    try {
      const response = await axios.get('/raw.tsv', {
        responseType: 'text',
      });
      
      const lines = response.data.split('\n');
      const trackIds: string[] = [];
      trackTagsMap.clear(); // 清空之前的映射
      
      // Skip header line
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
          const columns = line.split('\t');
          if (columns[0]) {
            const trackId = columns[0];
            trackIds.push(trackId);
            
            // 解析并存储tags（TAGS字段在第6列，索引为5，之后的所有列都是标签）
            if (columns.length > 5) {
              // 从第6列开始的所有列都是标签
              const tagsString = columns.slice(5).join('\t');
              const tags = parseTags(tagsString);
              trackTagsMap.set(trackId, tags);
              
              // 收集所有可用的标签
              tags.genres.forEach(g => allAvailableTags.genres.add(g));
              tags.instruments.forEach(i => allAvailableTags.instruments.add(i));
              tags.moods.forEach(m => allAvailableTags.moods.add(m));
              tags.themes.forEach(t => allAvailableTags.themes.add(t));
            }
          }
        }
      }
      
      return trackIds;
    } catch (error) {
      console.error('Failed to load TSV:', error);
      // Return empty array or fallback to some default IDs
      return [];
    }
  },
};
