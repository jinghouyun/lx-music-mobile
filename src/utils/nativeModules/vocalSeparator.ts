import { NativeModules, NativeEventEmitter } from 'react-native'

const { VocalSeparator } = NativeModules

export interface VocalSepProgressEvent {
  songId: string
  /** queued（排队等待）| decoding | inferring | done | error | cancelled */
  status: 'queued' | 'decoding' | 'inferring' | 'done' | 'error' | 'cancelled'
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
  /** —— 以下为“缓存目录体检”诊断字段（getCacheInfo 原生回传，排查统计为 0 用）—— */
  rootPath?: string
  rootExists?: boolean
  rootIsDir?: boolean
  filesDir?: string
  cacheDir?: string
  /** vocalsep 根下每个子项：`name|dir/file|V=1/0 A=1/0|字节数` */
  rootEntries?: string[]
  /** cacheDir/vocalsep_work 残留子项（正常应为空） */
  workEntries?: string[]
  /** filesDir 一级子项（确认 vocalsep 是否建在别处） */
  filesDirEntries?: string[]
  /** 原生分离历史（Service 写入 vocalsep/.history 的末尾片段） */
  history?: string
  /** 原生统计自身抛错时回传（用 resolve 而非 reject，避免被 JS catch 吞成 0） */
  diagError?: string
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

  /**
   * 提前启动前台服务保活（下载模型/音频期间调用），
   * 避免锁屏或切后台后下载被系统冻结。无实际任务，60s 空闲自动停止。
   */
  warmup() {
    VocalSeparator.warmup()
  },

  /**
   * 把 JS 下载阶段（模型/音频）的进度同步到前台通知栏。
   * @param stage    downloading-model | downloading-audio
   * @param fraction 0 ~ 1
   */
  notifyProgress(stage: string, fraction: number, message?: string) {
    VocalSeparator.notifyProgress(stage, fraction, message ?? '')
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
