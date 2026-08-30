// 系统媒体会话歌词（lyricInfo）构造工具
//
// vivo 原子岛/原子随身听、OPPO ColorOS 锁屏岛、小米 HyperOS 等系统歌词组件，
// 均通过 MediaSession 元数据 extras 中的 "lyricInfo" 字段读取歌词。
// 该字段不是裸 LRC 文本，而是一个 JSON 字符串（网易云/QQ 音乐与各厂商约定的事实标准）：
// {
//   "songName": "歌名",
//   "artist": "歌手",
//   "album": "专辑",
//   "songId": "歌曲id",
//   "lyric": "[00:00.00]原文\n[00:00.00]翻译",  // 原文与翻译/罗马音按时间戳交错
//   "format": "lrc",       // 普通 LRC；逐字歌词为 elrc
//   "translation": "lrc"   // 存在翻译时为 lrc，否则为空串
// }
// 参考：limczhh/LyricInfo（BaseLyricProvider.putLyricInfo、LxMusicProvider）、
// Halcyon OPlusLyricPayload.buildSystemPayload。

const TIME_TAG_REG = /\[(\d{1,2}):(\d{2})(?:[.:](\d{2,3}))?]/g
// 时间戳模糊匹配窗口（ms），对齐 LyricNormalizer.merge
const FUZZY_MATCH_MS = 1000

type LyricMeta = {
  id: string | null
  name: string
  singer: string
  album: string
}

/** 提取一行 LRC 中的全部时间戳（ms），一行可能有多个时间戳 */
const extractTimestamps = (line: string): number[] => {
  const result: number[] = []
  let match: RegExpExecArray | null
  const reg = new RegExp(TIME_TAG_REG)
  while ((match = reg.exec(line))) {
    const minute = parseInt(match[1])
    const second = parseInt(match[2])
    const fractionStr = match[3] ?? '0'
    // 两位按百分秒（×10ms），三位按毫秒
    const fraction = fractionStr.length === 2
      ? parseInt(fractionStr) * 10
      : parseInt(fractionStr)
    result.push(minute * 60000 + second * 1000 + fraction)
  }
  return result
}

const msToTag = (ms: number): string => {
  const minute = Math.floor(ms / 60000)
  const second = Math.floor((ms % 60000) / 1000)
  const milli = Math.floor(ms % 1000)
  return `[${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(milli).padStart(3, '0')}]`
}

/** 把一份 LRC 解析为 时间戳(ms) -> 原始行 的映射 */
const buildTimeLineMap = (lrc: string): Map<number, string> => {
  const map = new Map<number, string>()
  for (const line of lrc.split(/\r\n|\n|\r/)) {
    if (!line.trim()) continue
    const timestamps = extractTimestamps(line)
    if (!timestamps.length) continue
    for (const ts of timestamps) map.set(ts, line)
  }
  return map
}

/** 把扩展歌词行的时间戳替换为原文行的时间戳，保证系统端能对齐 */
const replaceLineTimestamps = (line: string, originTimestamps: number[]): string => {
  const text = line.replace(new RegExp(TIME_TAG_REG), '').trim()
  return `${originTimestamps.map(msToTag).join('')}${text}`
}

/**
 * 将翻译/罗马音按时间戳交错合并进原文 LRC：
 * 每个原文行之后插入时间差 1s 内的扩展歌词行（时间戳对齐到原文）。
 */
const mergeExtendedLyric = (originLrc: string, extendedList: string[]): string => {
  const maps = extendedList
    .filter(lrc => lrc && lrc.trim())
    .map(buildTimeLineMap)
  if (!maps.length) return originLrc.trim()

  const output: string[] = []
  for (const line of originLrc.split(/\r\n|\n|\r/)) {
    output.push(line)
    const timestamps = extractTimestamps(line)
    if (!timestamps.length) continue
    const targetTs = timestamps[0]
    for (const map of maps) {
      let bestTs: number | null = null
      let bestDiff = FUZZY_MATCH_MS + 1
      for (const ts of map.keys()) {
        const diff = Math.abs(ts - targetTs)
        if (diff < bestDiff) {
          bestDiff = diff
          bestTs = ts
        }
      }
      if (bestTs !== null && bestDiff <= FUZZY_MATCH_MS) {
        const matchedLine = map.get(bestTs)
        if (matchedLine) output.push(replaceLineTimestamps(matchedLine, timestamps))
      }
    }
  }
  return output.join('\n').trim()
}

/**
 * 构造写入 MediaSession 的 lyricInfo JSON 字符串。
 * 原文为空时返回空串（用于切歌/停止时清空系统歌词）。
 */
export const buildMediaSessionLyricInfo = (
  meta: LyricMeta,
  lrc: string | null | undefined,
  tlrc?: string | null | undefined,
  rlrc?: string | null | undefined,
): string => {
  if (!lrc || !lrc.trim()) return ''
  const extended: string[] = []
  if (tlrc && tlrc.trim()) extended.push(tlrc)
  if (rlrc && rlrc.trim()) extended.push(rlrc)
  const merged = mergeExtendedLyric(lrc, extended)
  return JSON.stringify({
    songName: meta.name ?? '',
    artist: meta.singer ?? '',
    album: meta.album ?? '',
    songId: meta.id ?? '',
    lyric: merged,
    format: 'lrc',
    translation: extended.length ? 'lrc' : '',
  })
}
