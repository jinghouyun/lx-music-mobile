import { downloadFile, stopDownload, existsFile, mkdirp, appExternalStorageDirectoryPath, writeFile } from '@/utils/fs'
import { getMusicUrl, getLyricInfo } from '@/core/music/online'
import settingState from '@/store/setting/state'
import { QUALITYS } from '@/utils/musicSdk/utils'
import { getData, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'

export type DownloadTaskStatus = 'run' | 'waiting' | 'pause' | 'error' | 'completed'

export interface DownloadTask {
  id: string
  status: DownloadTaskStatus
  statusText: string
  progress: number
  downloaded: number
  total: number
  speed: string
  metadata: {
    musicInfo: LX.Music.MusicInfoOnline
    url: string | null
    quality: LX.Quality
    ext: string
    fileName: string
    filePath: string
  }
  jobId?: number
}

type Listener = (tasks: DownloadTask[]) => void

const tasks: DownloadTask[] = []
const runningTasks = new Map<string, DownloadTask>()
const listeners = new Set<Listener>()
let isInitialized = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

const downloadListKey = storageDataPrefix.downloadList

const notify = () => {
  const snapshot = [...tasks]
  for (const listener of listeners) listener(snapshot)
}

const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const serializable = tasks.map(t => {
      const { jobId, ...rest } = t
      void jobId
      return {
        ...rest,
        status: rest.status === 'run' ? 'pause' as const : rest.status,
        statusText: rest.status === 'run' ? '已暂停' : rest.statusText,
      }
    })
    void saveData(downloadListKey, serializable)
  }, 500)
}

export const initDownloadTasks = async() => {
  if (isInitialized) return
  isInitialized = true
  try {
    const saved = await getData<DownloadTask[]>(downloadListKey)
    if (saved && Array.isArray(saved)) {
      for (const task of saved) {
        task.jobId = undefined
        if (task.status === 'run' || task.status === 'waiting') {
          task.status = 'pause'
          task.statusText = '已暂停'
        }
        tasks.push(task)
      }
      notify()
    }
  } catch (err) {
    console.error('init download tasks failed', err)
  }
}

export const onDownloadListChange = (listener: Listener) => {
  listeners.add(listener)
  listener([...tasks])
  return () => { listeners.delete(listener) }
}

export const getDownloadTasks = () => [...tasks]

const getDownloadDir = async() => {
  const configured = settingState.setting['download.savePath']
  const dir = configured || `${appExternalStorageDirectoryPath}/Music/LXMusic`
  if (!await existsFile(dir)) await mkdirp(dir)
  return dir
}

const buildFileName = (musicInfo: LX.Music.MusicInfoOnline, ext: string) => {
  const template = settingState.setting['download.fileName'] || '歌名 - 歌手'
  let name = template
    .replace('歌名', musicInfo.name)
    .replace('歌手', musicInfo.singer ?? '未知歌手')
    .replace(/[\\/:*?"<>|]/g, '_')
  return `${name}.${ext}`
}

const getExtByQuality = (quality: LX.Quality): string => {
  switch (quality) {
    case 'flac24bit':
    case 'flac': return 'flac'
    case 'wav': return 'wav'
    case 'ape': return 'ape'
    default: return 'mp3'
  }
}

const genTaskId = (musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality) => {
  return `${musicInfo.source}_${musicInfo.id}_${quality}`
}

const findTask = (id: string) => tasks.find(t => t.id === id)

const patchTask = (id: string, patch: Partial<DownloadTask>) => {
  const task = findTask(id)
  if (!task) return
  Object.assign(task, patch)
  notify()
  scheduleSave()
}

const getMaxDownloadNum = () => settingState.setting['download.maxDownloadNum'] || 3

const checkStartTasks = () => {
  if (runningTasks.size >= getMaxDownloadNum()) return
  for (const task of tasks) {
    if (runningTasks.size >= getMaxDownloadNum()) break
    if (task.status === 'waiting') {
      void runTask(task)
    }
  }
}

const saveLyricFile = async(task: DownloadTask) => {
  if (!settingState.setting['download.isDownloadLrc']) return
  try {
    const lyricInfo = await getLyricInfo({
      musicInfo: task.metadata.musicInfo,
      isRefresh: false,
      allowToggleSource: settingState.setting['download.isUseOtherSource'],
    })
    if (!lyricInfo.lyric) return
    const lrcPath = task.metadata.filePath.replace(/\.[^.]+$/, '.lrc')
    let lrcContent = lyricInfo.lyric
    if (settingState.setting['download.isDownloadTLrc'] && lyricInfo.tlyric) {
      lrcContent += '\n' + lyricInfo.tlyric
    }
    if (settingState.setting['download.isDownloadRLrc'] && lyricInfo.rlyric) {
      lrcContent += '\n' + lyricInfo.rlyric
    }
    await writeFile(lrcPath, lrcContent, 'utf8')
  } catch (err) {
    console.warn('save lyric failed', err)
  }
}

const runTask = async(task: DownloadTask) => {
  if (runningTasks.has(task.id)) return
  runningTasks.set(task.id, task)
  patchTask(task.id, { status: 'run', statusText: '获取下载链接...' })

  try {
    let url = task.metadata.url
    if (!url) {
      url = await getMusicUrl({
        musicInfo: task.metadata.musicInfo,
        quality: task.metadata.quality,
        isRefresh: false,
        allowToggleSource: settingState.setting['download.isUseOtherSource'],
      })
      if (!url) {
        patchTask(task.id, { status: 'error', statusText: '获取下载链接失败' })
        runningTasks.delete(task.id)
        checkStartTasks()
        return
      }
      task.metadata.url = url
    }

    // 跳过已存在文件
    if (settingState.setting['download.skipExistFile'] && await existsFile(task.metadata.filePath)) {
      patchTask(task.id, { status: 'completed', statusText: '文件已存在，已跳过', progress: 100 })
      runningTasks.delete(task.id)
      checkStartTasks()
      return
    }

    patchTask(task.id, { statusText: '下载中...' })

    let lastBytes = 0
    let lastTime = Date.now()
    const result = downloadFile(url, task.metadata.filePath, {
      progressInterval: 500,
      begin: (res) => {
        patchTask(task.id, { total: res.contentLength })
      },
      progress: (res) => {
        const now = Date.now()
        const timeDiff = (now - lastTime) / 1000
        let speedText = ''
        if (timeDiff > 0) {
          const bytesPerSec = (res.bytesWritten - lastBytes) / timeDiff
          if (bytesPerSec > 0) speedText = `${(bytesPerSec / 1024).toFixed(1)} KB/s`
        }
        lastBytes = res.bytesWritten
        lastTime = now
        const progress = res.contentLength > 0 ? (res.bytesWritten / res.contentLength) * 100 : 0
        patchTask(task.id, {
          progress: Math.min(progress, 99.9),
          downloaded: res.bytesWritten,
          total: res.contentLength,
          speed: speedText,
        })
      },
    })

    task.jobId = result.jobId
    const response = await result.promise

    if (response.statusCode === 200) {
      patchTask(task.id, {
        status: 'completed',
        statusText: '下载完成',
        progress: 100,
        speed: '',
      })
      void saveLyricFile(task)
    } else {
      patchTask(task.id, {
        status: 'error',
        statusText: `下载失败 (HTTP ${response.statusCode})`,
        speed: '',
      })
    }
  } catch (err: any) {
    // 用户主动取消不算错误
    if (err?.message?.includes('aborted') || err?.code === 'ABORTED') {
      patchTask(task.id, { status: 'pause', statusText: '已暂停', speed: '' })
    } else {
      patchTask(task.id, {
        status: 'error',
        statusText: err?.message ?? '下载失败',
        speed: '',
      })
    }
  } finally {
    runningTasks.delete(task.id)
    task.jobId = undefined
    checkStartTasks()
  }
}

export const createDownloadTask = async(musicInfo: LX.Music.MusicInfoOnline, quality: LX.Quality) => {
  await initDownloadTasks()
  if (!settingState.setting['download.enable']) return
  const id = genTaskId(musicInfo, quality)
  if (findTask(id)) return

  const ext = getExtByQuality(quality)
  const fileName = buildFileName(musicInfo, ext)
  const dir = await getDownloadDir()
  const filePath = `${dir}/${fileName}`

  const task: DownloadTask = {
    id,
    status: 'waiting',
    statusText: '等待中',
    progress: 0,
    downloaded: 0,
    total: 0,
    speed: '',
    metadata: { musicInfo, url: null, quality, ext, fileName, filePath },
  }
  tasks.push(task)
  notify()
  scheduleSave()
  checkStartTasks()
}

export const startDownloadTasks = async(ids: string[]) => {
  for (const id of ids) {
    const task = findTask(id)
    if (!task) continue
    if (task.status === 'pause' || task.status === 'error') {
      task.status = 'waiting'
      task.statusText = '等待中'
    }
  }
  notify()
  scheduleSave()
  checkStartTasks()
}

export const pauseDownloadTasks = (ids: string[]) => {
  for (const id of ids) {
    const task = findTask(id)
    if (!task) continue
    if (task.jobId) {
      stopDownload(task.jobId)
      task.jobId = undefined
    }
    runningTasks.delete(id)
    if (task.status === 'run' || task.status === 'waiting') {
      task.status = 'pause'
      task.statusText = '已暂停'
      task.speed = ''
    }
  }
  notify()
  scheduleSave()
  checkStartTasks()
}

export const removeDownloadTasks = async(ids: string[]) => {
  const idSet = new Set(ids)
  for (const id of ids) {
    const task = findTask(id)
    if (task?.jobId) {
      stopDownload(task.jobId)
    }
    runningTasks.delete(id)
  }
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (idSet.has(tasks[i].id)) tasks.splice(i, 1)
  }
  notify()
  scheduleSave()
  checkStartTasks()
}

export const retryDownloadTask = async(id: string) => {
  const task = findTask(id)
  if (!task) return
  task.metadata.url = null
  task.status = 'waiting'
  task.statusText = '等待中'
  task.progress = 0
  task.downloaded = 0
  task.speed = ''
  notify()
  scheduleSave()
  checkStartTasks()
}

export const getAvailableQualitys = (musicInfo: LX.Music.MusicInfoOnline): LX.Quality[] => {
  const sourceQualitys = global.lx.qualityList[musicInfo.source] as LX.Quality[] | undefined
  if (!sourceQualitys) return []
  const musicQualitys = musicInfo.meta.qualitys?.map(q => q.type) ?? []
  return (QUALITYS as LX.Quality[]).filter(q => sourceQualitys.includes(q) && musicQualitys.includes(q))
}

export const getQualityLabel = (quality: LX.Quality): string => {
  switch (quality) {
    case 'flac24bit': return '无损 FLAC Hires'
    case 'flac': return '无损 FLAC'
    case 'wav': return '无损 WAV'
    case 'ape': return '无损 APE'
    case '320k': return '高品质 320k'
    case '192k': return '标准 192k'
    case '128k': return '标准 128k'
    default: return quality
  }
}

export const formatFileSize = (bytes: number): string => {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
