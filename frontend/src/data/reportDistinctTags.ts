/**
 * 与 详细Tags分析报告.md 中所有 distinct tags 严格一致，不得编造。
 * 来源：fffinalproto/mtgdata/详细Tags分析报告.md 中按类别提取的唯一条目。
 */

export const REPORT_GENRES: string[] = [
  '60s', '70s', '80s', '90s', 'acidjazz', 'african', 'alternative', 'alternativerock', 'ambient', 'asian',
  'atmospheric', 'blues', 'bluesrock', 'bossanova', 'breakbeat', 'breakcore', 'cabaret', 'celtic', 'chanson',
  'chansonfrancaise', 'chillout', 'classical', 'classicrock', 'club', 'country', 'dance', 'darkambient', 'darkwave',
  'deathmetal', 'deephouse', 'disco', 'downtempo', 'drumnbass', 'dub', 'dubstep', 'easylistening', 'electrodance',
  'electronic', 'electronica', 'electronik', 'electropop', 'electrorock', 'eletronica', 'ethnicrock', 'ethno',
  'experimental', 'flamenco', 'folk', 'funk', 'fusion', 'gospel', 'gothic', 'grindcore', 'groove', 'grunge',
  'hard', 'hardrock', 'hardtek', 'heavymetal', 'hiphop', 'house', 'idm', 'improvisation', 'indie', 'industrial',
  'instrumentalpop', 'instrumentalrock', 'jazz', 'jazzfunk', 'jazzfusion', 'jungle', 'latin', 'lofi', 'lounge',
  'medieval', 'metal', 'minimal', 'minimaltechno', 'newage', 'newwave', 'orchestral', 'oriental', 'pop', 'popfolk',
  'popfunk', 'poprock', 'postrock', 'progressive', 'psychedelic', 'psytrance', 'punk', 'punkrock', 'ragtime', 'rap',
  'rave', 'reggae', 'reggaeton', 'rhythmandblues', 'rnb', 'rock', 'rockandroll', 'rocknroll', 'salsa', 'singersongwriter',
  'ska', 'smoothjazz', 'soul', 'soundtrack', 'swing', 'symphonic', 'synthpop', 'techhouse', 'techno', 'technoindustrial',
  'trance', 'tribal', 'trip', 'triphop', 'world',
].sort();

export const REPORT_INSTRUMENTS: string[] = [
  'accordion', 'acousticbassguitar', 'acousticguitar', 'bass', 'beat', 'bell', 'bongo', 'brass', 'cello', 'clarinet',
  'classicalguitar', 'computer', 'doublebass', 'drummachine', 'drums', 'electricguitar', 'electricpiano', 'flute',
  'guitar', 'harmonica', 'harp', 'horn', 'keyboard', 'oboe', 'orchestra', 'organ', 'pad', 'panflute', 'percussion',
  'piano', 'pianosolo', 'pipeorgan', 'rhodes', 'sampler', 'saxophone', 'strings', 'synth', 'synthesizer', 'trombone',
  'trumpet', 'ukulele', 'viola', 'violin', 'voice',
].sort();

/** mood/theme 在报告中合并为同一类，冷启动 UI 中 moods 与 themes 使用同一列表 */
export const REPORT_MOODS_THEMES: string[] = [
  'action', 'adventure', 'advertising', 'ambiental', 'background', 'ballad', 'calm', 'children', 'christmas', 'cinema',
  'comedy', 'commercial', 'cool', 'corporate', 'dark', 'deep', 'documentary', 'drama', 'dramatic', 'dream', 'emotional',
  'energetic', 'energy', 'epic', 'fast', 'film', 'fun', 'funny', 'game', 'groovy', 'happy', 'heavy', 'holiday', 'hopeful',
  'horror', 'hypnotic', 'indian', 'inspiring', 'life', 'love', 'meditative', 'melancholic', 'mellow', 'melodic',
  'motivational', 'movie', 'nature', 'party', 'poesia', 'positive', 'powerful', 'relaxation', 'relaxing', 'retro',
  'romantic', 'sad', 'sexy', 'silence', 'slow', 'soft', 'soundscape', 'space', 'sport', 'summer', 'trailer', 'travel',
  'tv', 'upbeat', 'uplifting',
].sort();

/** 冷启动/标签选择用：与报告完全一致的 genres / instruments / moods / themes */
export function getReportDistinctTags(): {
  genres: string[];
  instruments: string[];
  moods: string[];
  themes: string[];
} {
  return {
    genres: [...REPORT_GENRES],
    instruments: [...REPORT_INSTRUMENTS],
    moods: [...REPORT_MOODS_THEMES],
    themes: [...REPORT_MOODS_THEMES],
  };
}
