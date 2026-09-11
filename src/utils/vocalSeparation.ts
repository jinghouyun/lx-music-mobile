import RNFS from 'react-native-fs'
import { downloadFile, existsFile, mkdirp, unlink } from './fs'
import { vocalSeparator, type StemPaths, type StemType, type ExportedStem } from './nativeModules/vocalSeparator'

/**
 * 人声分离编排层（阶段 2）。
 *
 * 职责：
 *  - htdemucs FP16 ONNX 模型的下载 / 校验 / 路径管理（hf-mirror 国内镜像）
 *  - 播放音源 URL 下载到本地临时文件
 *  - 调用原生分离模块并把进度事件 Promise 化
 *  - 双轨 WAV 缓存查询/清理
 *
 * 模型：StemSplitio/htdemucs-onnx（MIT），FP16 权重存储、FP32 运算，
 * 输入 mix (1,2,343980) @44.1kHz，输出 stems (1,4,2,343980)。
 */

const MODEL_FILE_NAME = 'htdemucs_fp16weights.onnx'
const MODEL_SIZE = 165_612_636 // 字节，下载后校验，防半截文件

// 主：hf-mirror（国内直连，实测 10MB/s+）；备：HuggingFace 官方
const MODEL_URLS = [
  'https://hf-mirror.com/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx',
  'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx',
]

const modelDir = `${RNFS.DocumentDirectoryPath}/models`
const modelPath = `${modelDir}/${MODEL_FILE_NAME}`
const audioCacheDir = `${RNFS.CachesDirectoryPath}/vocal_sep_audio`

const extFromUrl = (url: string): string => {
  const m = url.split('?')[0].match(/\.(mp3|flac|m4a|aac|ogg|wav)$/i)
  return m ? m[1].toLowerCase() : 'mp3'
}

/**
 * 把外部 songId 映射成定长、文件系统安全的缓存键。
 *
 * 必要：部分音源（如网易云临时 URL 音源）的 songId 会把整段下载 URL 编码进去，
 * 长度可达 280+ 字符，直接用作文件名会超过文件系统 255 字节限制
 * （RNFS 下载时 open `.download` 临时文件报 ENOENT）。
 * cyrb53 哈希 -> 16 位 hex，同一首歌稳定、碰撞概率可忽略，纯 hex 无特殊字符。
 */
const cacheKeyOf = (songId: string): string => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < songId.length; i++) {
    const ch = songId.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const hex = (x: number) => (x >>> 0).toString(16).padStart(8, '0')
  return `vs_${hex(h2)}${hex(h1)}`
}

export interface SeparateOptions {
  /** 歌曲稳定唯一 id（如 音源_songmid_quality），用作缓存键 */
  songId: string
  /** 当前播放音源的可下载 URL（http/https） */
  audioUrl: string
  /**
   * URL 失效（如网易云临时签名地址过期返回 410/403）时，用来重新获取一条新鲜地址。
   * 不传则失败即报错。
   */
  refreshAudioUrl?: () => Promise<string>
  /** 进度回调 0~1 */
  onProgress?: (progress: number, stage: 'downloading-model' | 'downloading-audio' | 'decoding' | 'inferring', message?: string) => void
  /** 执行提供者，默认 xnnpack */
  ep?: 'xnnpack' | 'nnapi' | 'cpu'
}

export interface SeparateResult extends StemPaths {
  songId: string
}

/** 模型是否已下载且完整 */
export const isModelReady = async(): Promise<boolean> => {
  try {
    if (!await existsFile(modelPath)) return false
    const stat = await RNFS.stat(modelPath)
    return Number(stat.size) === MODEL_SIZE
  } catch {
    return false
  }
}

/** 模型路径（不检查完整性，调用前先 ensureModel） */
export const getModelPath = () => modelPath

/**
 * 确保模型可用，返回模型绝对路径。
 * 已存在且大小正确则直接返回；否则依次尝试镜像下载。
 */
export const ensureModel = async(onProgress?: (fraction: number) => void): Promise<string> => {
  if (await isModelReady()) return modelPath

  await mkdirp(modelDir)
  const tmpPath = `${modelPath}.download`

  let lastError: unknown = null
  for (const url of MODEL_URLS) {
    try {
      await new Promise<void>((resolve, reject) => {
        const job = downloadFile(url, tmpPath, {
          progressInterval: 500,
          begin: () => {},
          progress: (res) => {
            onProgress?.(res.bytesWritten / (res.contentLength || MODEL_SIZE))
          },
        })
        job.promise.then((r) => {
          if (r.statusCode >= 200 && r.statusCode < 300) resolve()
          else reject(new Error(`模型下载 HTTP ${r.statusCode}`))
        }).catch(reject)
      })

      const stat = await RNFS.stat(tmpPath)
      if (Number(stat.size) !== MODEL_SIZE) {
        throw new Error(`模型大小不符：${stat.size} != ${MODEL_SIZE}`)
      }
      await RNFS.moveFile(tmpPath, modelPath)
      return modelPath
    } catch (e) {
      lastError = e
      try { await unlink(tmpPath) } catch { /* 忽略 */ }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('模型下载失败')
}

/** 下载音源到本地缓存（已存在则复用）。URL 失效时刷新地址重试一次 */
const ensureLocalAudio = async(
  cacheId: string,
  initialUrl: string,
  refreshUrl: (() => Promise<string>) | undefined,
  onProgress?: (fraction: number) => void,
): Promise<string> => {
  await mkdirp(audioCacheDir)
  let url = initialUrl

  // 最多两轮：第一轮用传入地址；若失败（典型：网易云临时签名过期 → 410/403），
  // 通过 refreshUrl 重新取一条新鲜地址再试，避免"原唱还在放、分离却下载失败"。
  for (let attempt = 0; attempt < 2; attempt++) {
    const ext = extFromUrl(url)
    const target = `${audioCacheDir}/${cacheId}.${ext}`
    if (await existsFile(target)) return target

    const tmp = `${target}.download`
    try {
      await new Promise<void>((resolve, reject) => {
        const job = downloadFile(url, tmp, {
          progressInterval: 500,
          begin: () => {},
          progress: (res) => {
            if (res.contentLength > 0) onProgress?.(res.bytesWritten / res.contentLength)
          },
        })
        job.promise.then((r) => {
          if (r.statusCode >= 200 && r.statusCode < 300) resolve()
          else reject(new Error(`音频下载 HTTP ${r.statusCode}`))
        }).catch(reject)
      })
      await RNFS.moveFile(tmp, target)
      return target
    } catch (e) {
      try { await unlink(tmp) } catch { /* 忽略 */ }
      // 仅第一轮、且提供了刷新函数时才重试
      if (attempt !== 0 || !refreshUrl) throw e
      try {
        const fresh = await refreshUrl()
        if (fresh) url = fresh
        else throw e
      } catch {
        throw e // 刷新也失败：抛出原始下载错误
      }
    }
  }
  throw new Error('音频下载失败')
}

/**
 * 执行人声分离（后台原生线程）。
 * 已缓存则直接返回路径；否则 下载模型/音频 -> 原生分离 -> 返回双轨 WAV 路径。
 */
export const separateSong = async(options: SeparateOptions): Promise<SeparateResult> => {
  const { songId, audioUrl, refreshAudioUrl, onProgress, ep = 'xnnpack' } = options
  // 文件系统/原生缓存一律用定长哈希键（原始 songId 可能超长，见 cacheKeyOf）
  const cacheId = cacheKeyOf(songId)

  // 1. 已缓存直接返回
  const cached = await vocalSeparator.getStemPaths(cacheId)
  if (cached) return { songId, ...cached }

  // 2. 模型
  onProgress?.(0, 'downloading-model')
  const mPath = await ensureModel((f) => onProgress?.(f * 0.3, 'downloading-model', '正在下载人声分离模型…'))

  // 3. 音频（URL 可能已过期，下载器内部会在失败时用 refreshAudioUrl 刷新重试）
  onProgress?.(0.3, 'downloading-audio')
  const audioPath = await ensureLocalAudio(cacheId, audioUrl, refreshAudioUrl, (f) =>
    onProgress?.(0.3 + f * 0.1, 'downloading-audio', '正在获取音频…'))

  // 4. 原生分离（事件转 Promise）
  return await new Promise<SeparateResult>((resolve, reject) => {
    let settled = false
    const sub = vocalSeparator.addProgressListener((e) => {
      if (e.songId !== cacheId) return
      if (e.status === 'inferring') {
        // 解码占 0.4~0.5，推理占 0.5~1
        onProgress?.(0.5 + e.progress * 0.5, 'inferring', e.message)
      } else if (e.status === 'decoding') {
        onProgress?.(0.42, 'decoding', e.message)
      } else if (e.status === 'done') {
        if (settled) return
        settled = true
        sub.remove()
        vocalSeparator.getStemPaths(cacheId).then((paths) => {
          if (paths) resolve({ songId, ...paths })
          else reject(new Error('分离完成但找不到输出文件'))
        })
      } else if (e.status === 'cancelled') {
        if (settled) return
        settled = true
        sub.remove()
        reject(new SeparationCancelledError())
      } else if (e.status === 'error') {
        if (settled) return
        settled = true
        sub.remove()
        reject(new Error(e.message || '人声分离失败'))
      }
    })

    try {
      vocalSeparator.separate(mPath, audioPath, cacheId, ep)
    } catch (e) {
      sub.remove()
      reject(e)
    }
  })
}

/** 分离被取消（切歌/切回原唱），非异常，UI 不弹错误 */
export class SeparationCancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'SeparationCancelledError'
  }
}

/** 取消当前原生分离任务 */
export const cancelSeparation = () => {
  vocalSeparator.cancel()
}

export const isSongSeparated = (songId: string): Promise<boolean> =>
  vocalSeparator.isCached(cacheKeyOf(songId))

export const getStemPaths = (songId: string): Promise<StemPaths | null> =>
  vocalSeparator.getStemPaths(cacheKeyOf(songId))

export const clearSeparationCache = (songId?: string): Promise<number> =>
  vocalSeparator.clearCache(songId ? cacheKeyOf(songId) : undefined)

export const getSeparationCacheInfo = vocalSeparator.getCacheInfo

/**
 * 把某首歌分离出的一轨保存到手机公共音乐目录（Music/AppleMusic/）。
 * @param songId      与分离时一致的外部歌曲 id（内部会再哈希成缓存键）
 * @param stem        'vocals' 人声 | 'accompaniment' 伴奏
 * @param displayName 不含扩展名的文件名，如 "孤雏 - 伴奏"
 */
export const exportStem = (songId: string, stem: StemType, displayName: string): Promise<ExportedStem> =>
  vocalSeparator.exportStem(cacheKeyOf(songId), stem, displayName)
