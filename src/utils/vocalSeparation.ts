import RNFS from 'react-native-fs'
import { downloadFile, existsFile, mkdirp, unlink } from './fs'
import { vocalSeparator, type StemPaths } from './nativeModules/vocalSeparator'

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

export interface SeparateOptions {
  /** 歌曲稳定唯一 id（如 音源_songmid_quality），用作缓存键 */
  songId: string
  /** 当前播放音源的可下载 URL（http/https） */
  audioUrl: string
  /** URL 对应的文件扩展名，如 mp3 / flac / m4a，默认 mp3 */
  ext?: string
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

/** 下载音源到本地缓存（已存在则复用） */
const ensureLocalAudio = async(songId: string, url: string, ext: string, onProgress?: (fraction: number) => void): Promise<string> => {
  await mkdirp(audioCacheDir)
  const target = `${audioCacheDir}/${songId}.${ext}`
  if (await existsFile(target)) return target

  const tmp = `${target}.download`
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
}

/**
 * 执行人声分离（后台原生线程）。
 * 已缓存则直接返回路径；否则 下载模型/音频 -> 原生分离 -> 返回双轨 WAV 路径。
 */
export const separateSong = async(options: SeparateOptions): Promise<SeparateResult> => {
  const { songId, audioUrl, ext = 'mp3', onProgress, ep = 'xnnpack' } = options

  // 1. 已缓存直接返回
  const cached = await vocalSeparator.getStemPaths(songId)
  if (cached) return { songId, ...cached }

  // 2. 模型
  onProgress?.(0, 'downloading-model')
  const mPath = await ensureModel((f) => onProgress?.(f * 0.3, 'downloading-model', '正在下载人声分离模型…'))

  // 3. 音频
  onProgress?.(0.3, 'downloading-audio')
  const audioPath = await ensureLocalAudio(songId, audioUrl, ext, (f) =>
    onProgress?.(0.3 + f * 0.1, 'downloading-audio', '正在获取音频…'))

  // 4. 原生分离（事件转 Promise）
  return await new Promise<SeparateResult>((resolve, reject) => {
    let settled = false
    const sub = vocalSeparator.addProgressListener((e) => {
      if (e.songId !== songId) return
      if (e.status === 'inferring') {
        // 解码占 0.4~0.5，推理占 0.5~1
        onProgress?.(0.5 + e.progress * 0.5, 'inferring', e.message)
      } else if (e.status === 'decoding') {
        onProgress?.(0.42, 'decoding', e.message)
      } else if (e.status === 'done') {
        if (settled) return
        settled = true
        sub.remove()
        vocalSeparator.getStemPaths(songId).then((paths) => {
          if (paths) resolve({ songId, ...paths })
          else reject(new Error('分离完成但找不到输出文件'))
        })
      } else if (e.status === 'error') {
        if (settled) return
        settled = true
        sub.remove()
        reject(new Error(e.message || '人声分离失败'))
      }
    })

    try {
      vocalSeparator.separate(mPath, audioPath, songId, ep)
    } catch (e) {
      sub.remove()
      reject(e)
    }
  })
}

export const isSongSeparated = (songId: string): Promise<boolean> =>
  vocalSeparator.isCached(songId)

export const getStemPaths = (songId: string): Promise<StemPaths | null> =>
  vocalSeparator.getStemPaths(songId)

export const clearSeparationCache = (songId?: string): Promise<number> =>
  vocalSeparator.clearCache(songId)

export const getSeparationCacheInfo = vocalSeparator.getCacheInfo
