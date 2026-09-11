import { NativeModules, NativeEventEmitter } from 'react-native'

const { VocalSeparator } = NativeModules

export interface VocalSepProgressEvent {
  songId: string
  /** decoding | inferring | done | error | cancelled */
  status: 'decoding' | 'inferring' | 'done' | 'error' | 'cancelled'
  /** 0 ~ 1 */
  progress: number
  message?: string
}

export interface StemPaths {
  vocals: string
  accompaniment: string
}

export interface CacheInfo {
  sizeBytes: number
  songCount: number
}

export interface ExportedStem {
  /** content:// uri 或 file:// uri */
  uri: string
  /** 对用户友好的保存位置，如 Music/AppleMusic/歌名 - 伴奏.wav */
  path: string
}

export interface CacheExportResult {
  path: string
  songCount: number
  totalBytes: number
}

export interface CacheImportResult {
  importedCount: number
  skippedCount: number
  totalBytes: number
}

export type StemType = 'vocals' | 'accompaniment'

type ProgressListener = (e: VocalSepProgressEvent) => void

const emitter = new NativeEventEmitter(VocalSeparator)

/**
 * 人声分离原生模块（Kotlin 实现，后台线程执行）。
 * 管线：MediaCodec 硬解 -> 44.1k sinc 重采样 -> htdemucs 分块推理 -> 双轨 WAV
 */
export const vocalSeparator = {
  /**
   * 启动分离（异步，结果通过 progress 事件回调）。
   * @param modelPath 本地 onnx 模型绝对路径
   * @param audioPath 本地音频文件绝对路径（mp3/aac/flac 等均可）
   * @param songId    歌曲唯一 id，用作缓存目录名
   * @param ep        执行提供者：'xnnpack'（默认）| 'nnapi' | 'cpu'
   */
  separate(modelPath: string, audioPath: string, songId: string, ep: 'xnnpack' | 'nnapi' | 'cpu' = 'xnnpack') {
    VocalSeparator.separate(modelPath, audioPath, songId, ep)
  },

  /** 取消当前正在进行的分离任务（分块间隙生效，最多数秒延迟） */
  cancel() {
    VocalSeparator.cancel()
  },

  isCached(songId: string): Promise<boolean> {
    return VocalSeparator.isCached(songId)
  },

  getStemPaths(songId: string): Promise<StemPaths | null> {
    return VocalSeparator.getStemPaths(songId)
  },

  /** songId 传空/不传则清空全部缓存。返回释放的字节数 */
  clearCache(songId?: string): Promise<number> {
    return VocalSeparator.clearCache(songId ?? null)
  },

  getCacheInfo(): Promise<CacheInfo> {
    return VocalSeparator.getCacheInfo()
  },

  /**
   * 将某一轨保存到手机公共音乐目录（Music/AppleMusic/），系统媒体库可见。
   * @param songId      分离时使用的歌曲 id
   * @param stem        'vocals'（人声）或 'accompaniment'（伴奏）
   * @param displayName 不含扩展名的文件名（会在原生侧再清洗一次）
   */
  exportStem(songId: string, stem: StemType, displayName: string): Promise<ExportedStem> {
    return VocalSeparator.exportStem(songId, stem, displayName)
  },

  /**
   * 导出所有人声分离缓存为 zip 包。
   * @param targetDirPath 目标目录绝对路径
   * @param fileName      不含 .zip 后缀的文件名
   */
  exportCache(targetDirPath: string, fileName: string): Promise<CacheExportResult> {
    return VocalSeparator.exportCache(targetDirPath, fileName)
  },

  /**
   * 从 zip 包导入人声分离缓存（已存在的歌曲会跳过不覆盖）。
   * @param zipFilePath zip 文件绝对路径
   */
  importCache(zipFilePath: string): Promise<CacheImportResult> {
    return VocalSeparator.importCache(zipFilePath)
  },

  addProgressListener(listener: ProgressListener) {
    return emitter.addListener('VocalSepProgress', listener)
  },
}
