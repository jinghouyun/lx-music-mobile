/**
 * 人声分离功能协调核心（阶段 3）。
 *
 * 架构：
 *  - TrackPlayer 始终是主播放器/主时钟（进度条、seek、切歌、通知栏、自动下一首全部复用）。
 *  - 伴奏/人声模式下：TrackPlayer 音量置 0 继续播放原曲（做时钟），原生 MixPlayer
 *    双轨混音跟随其进度（每 500ms syncTo 一次，自动追赶/等待缓冲）。
 *  - 切歌后模式保持（sticky）：已缓存立即混音；未缓存则播原唱并后台分离，完成自动切换。
 */
import TrackPlayer, { State as TPState, Event as TPEvent } from 'react-native-track-player'
import { PermissionsAndroid, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { toast } from '@/utils/tools'
import { vocalMixPlayer } from '@/utils/nativeModules/vocalMixPlayer'
import { getMusicUrl } from '@/core/music'
import { getList } from '@/core/player/playInfo'
import playerState from '@/store/player/state'
import {
  separateSong,
  cancelSeparation,
  SeparationCancelledError,
  isSongSeparated,
  getStemPaths,
  clearSeparationCache,
  getSeparationCacheInfo,
  exportStem,
} from '@/utils/vocalSeparation'
import type { StemType } from '@/utils/nativeModules/vocalSeparator'

export type VocalMode = 'original' | 'accompaniment' | 'vocals'

export interface SepTaskState {
  status: 'idle' | 'downloading' | 'queued' | 'decoding' | 'inferring' | 'done' | 'error'
  progress: number
  message?: string
  songId?: string
}

interface VocalState {
  /** 当前正在听到的模式 */
  activeMode: VocalMode
  /** 用户选择的模式（切歌后保持） */
  desiredMode: VocalMode
  /** 当前歌曲的分离任务状态 */
  task: SepTaskState
  /** 去人声强度 0..1（1=纯伴奏） */
  strength: number
  /** 混音引擎启动/播放失败原因（常驻面板，便于定位"没声音"） */
  mixError?: string | null
}

const STORAGE_STRENGTH = 'vocalSep_strength'

const state: VocalState = {
  activeMode: 'original',
  desiredMode: 'original',
  task: { status: 'idle', progress: 0 },
  strength: 1,
}

type Listener = (s: VocalState) => void
const listeners = new Set<Listener>()
const emit = () => {
  const snapshot = { ...state, task: { ...state.task } }
  listeners.forEach(l => l(snapshot))
}
export const addVocalStateListener = (cb: Listener) => {
  listeners.add(cb)
  cb({ ...state, task: { ...state.task } })
  return () => { listeners.delete(cb) }
}

let syncTimer: ReturnType<typeof setInterval> | null = null
let inited = false

/**
 * 当前正在播放歌曲的稳定缓存 id（每次 getCurrentSong 解析时刷新）。
 * 用途：把"分离进度/失败"这类 UI 状态严格限定在【当前歌曲】上。
 * 切歌后上一首会在原生后台继续分离并落盘缓存（设计如此，避免重复计算），
 * 但它的进度事件不应再回灌到当前歌曲的面板——否则回到一首"已缓存、正在听
 * 纯人声"的歌时，底部仍会被后台其它歌曲的进度刷成"AI 分离中…"，像又分离了一遍。
 */
let currentSongId: string | null = null

const sanitizeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_')

/**
 * 按真实歌曲 id 解析出完整歌曲对象（用于过期后重新取 URL）。
 * 多来源兜底，覆盖"原源失效自动切备用源"等场景：
 *  当前播放列表 → playMusicInfo → 稍后播放 → 已播列表。
 * 返回 MusicInfo 或已下载项 ListItem（getMusicUrl 两者都接受）。
 */
const resolveMusicInfo = (realId: string): LX.Music.MusicInfo | LX.Download.ListItem | null => {
  const inPlayerList = getList(playerState.playInfo.playerListId).find(m => String(m.id) === realId)
  if (inPlayerList) return inPlayerList

  const pmi = playerState.playMusicInfo?.musicInfo
  if (pmi && String(pmi.id) === realId) return pmi as LX.Music.MusicInfo

  const inTemp = playerState.tempPlayList.find(p => String(p.musicInfo.id) === realId)
  if (inTemp) return inTemp.musicInfo

  const inPlayed = playerState.playedList.find(p => String(p.musicInfo.id) === realId)
  if (inPlayed) return inPlayed.musicInfo

  return null
}

const getCurrentSong = async(): Promise<{ id: string, url: string, musicInfo: LX.Music.MusicInfo | LX.Download.ListItem | null } | null> => {
  try {
    const trackId = await TrackPlayer.getCurrentTrack()
    if (trackId == null) return null
    const track = await TrackPlayer.getTrack(trackId)
    if (!track || !track.url) return null
    // 在线临时音源 track.id 形如 `${id}__//随机__//url`，每次播放随机数/URL 都不同，
    // 绝不能用作缓存键（否则同一首歌每次播放都生成新缓存目录，分离结果永远命中不了）。
    // Track 上的 musicId 字段才是真实稳定的歌曲 id（见 plugins/player/playList.ts buildTracks）。
    const realId = String((track as LX.Player.Track).musicId ?? track.id)
    const id = sanitizeId(realId)
    // 刷新"当前歌曲"标记，供分离任务的进度回调判断是否该更新 UI
    currentSongId = id
    return { id, url: track.url as string, musicInfo: resolveMusicInfo(realId) }
  } catch {
    return null
  }
}

/**
 * 强制向音源重新请求一条新鲜的可播放地址。
 * 各在线源（网易云/QQ/酷狗/酷我）的 CDN 地址普遍带临时签名，播放一段时间后会过期
 * （再下载返回 410/403）；播放器仍有声是因为早已缓冲，但分离需重新下载完整文件。
 * 这里走落雪统一的 getMusicUrl 分发，按 musicInfo.source 路由到对应音源，因此对所有
 * 播放源通用。失败时回退传入的旧地址。
 */
const refreshAudioUrl = async(
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem | null,
  fallbackUrl: string,
): Promise<string> => {
  if (!musicInfo) return fallbackUrl
  // 本地文件 / 已下载歌曲：地址就是本地路径，不会过期，无需刷新
  if (!('progress' in musicInfo) && musicInfo.source === 'local') return fallbackUrl
  try {
    // isRefresh 跳过缓存强制取新地址；允许切换备用源，最大化拿到可用文件
    const fresh = await getMusicUrl({ musicInfo, isRefresh: true })
    return fresh || fallbackUrl
  } catch {
    return fallbackUrl
  }
}

const setTask = (patch: Partial<SepTaskState>) => {
  state.task = { ...state.task, ...patch }
  emit()
}

// ---------------- 混音播放控制 ----------------

const stopSync = () => {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null }
}

/** 立即同步一次（seek/播放/暂停等事件触发，不等 500ms 轮询） */
const syncNow = async() => {
  if (state.activeMode === 'original') return
  try {
    const pos = await TrackPlayer.getPosition()
    const tpState = await TrackPlayer.getState()
    vocalMixPlayer.syncTo(pos * 1000, tpState === TPState.Playing)
  } catch { /* 忽略 */ }
}

const startSync = () => {
  if (syncTimer) return
  syncTimer = setInterval(() => { void syncNow() }, 500)
}

/**
 * 播放器 seek 事件钩子（由 plugins/player 的 setCurrentTime 调用）。
 * 混音进行中立即硬跳到新位置，避免等轮询造成的数百毫秒错位。
 */
export const notifyPlayerSeek = (timeSec: number) => {
  if (state.activeMode === 'original') return
  vocalMixPlayer.seekTo(timeSec * 1000)
  void syncNow()
}

const stopMix = () => {
  stopSync()
  vocalMixPlayer.stop()
}

/** 启动双轨混音播放（调用前已确认缓存存在） */
const startMix = async(mode: Exclude<VocalMode, 'original'>) => {
  const song = await getCurrentSong()
  if (!song) {
    state.mixError = '未获取到当前播放歌曲'
    emit()
    return
  }
  const paths = await getStemPaths(song.id)
  if (!paths) {
    state.mixError = '找不到分离结果文件（可能已被清理），请重新分离'
    emit()
    return
  }
  try {
    stopMix()
    const pos = await TrackPlayer.getPosition().catch(() => 0)
    await vocalMixPlayer.prepare(paths.vocals, paths.accompaniment)
    vocalMixPlayer.play(pos * 1000, mode === 'vocals' ? 2 : 1, state.strength)
    // 混音引擎确认启动后再把原唱静音，避免引擎没出声导致整首无声
    await TrackPlayer.setVolume(0)
    state.activeMode = mode
    state.mixError = null
    startSync()
    emit()
  } catch (e: any) {
    // 混音启动失败：务必恢复原唱音量，并把原因常驻面板，避免只弹一闪而过的 toast
    stopMix()
    await TrackPlayer.setVolume(1).catch(() => {})
    state.activeMode = 'original'
    state.mixError = `混音启动失败：${e?.message ?? e?.code ?? e}`
    emit()
    toast(`混音播放失败，已恢复原唱：${e?.message ?? e}`)
  }
}

const backToOriginal = async() => {
  stopMix()
  await TrackPlayer.setVolume(1).catch(() => {})
  state.activeMode = 'original'
  emit()
}

// ---------------- 分离任务 ----------------

const startSeparation = async(song: { id: string, url: string, musicInfo: LX.Music.MusicInfo | LX.Download.ListItem | null }) => {
  // 该任务是否仍属于"当前正在播放的歌"。切歌后旧任务转为后台任务（原生继续跑完落盘），
  // 此时它的进度/完成/失败都不应再动当前歌曲的面板 UI。
  const isForCurrent = () => currentSongId === song.id
  if (isForCurrent()) {
    setTask({ status: 'downloading', progress: 0, songId: song.id, message: '准备中…' })
  }
  // 任务是否已进入原生 Service 队列：未进入前的失败（模型/音频下载失败）
  // 需要主动关闭 warmup 保活通知；进入后的失败由 Service 队列自行处理，不能误杀其它歌
  let enqueued = false
  try {
    // 主动刷新一次播放地址：track.url 是起播时取的临时签名地址，
    // 用户往往在播放一会儿后才打开分离，旧地址可能已过期（网易云返回 410）。
    const freshUrl = await refreshAudioUrl(song.musicInfo, song.url)
    await separateSong({
      songId: song.id,
      audioUrl: freshUrl,
      // 下载仍失败（410/403）时，下载器会再调一次这里取新地址重试
      refreshAudioUrl: () => refreshAudioUrl(song.musicInfo, freshUrl),
      ep: 'xnnpack',
      onProgress: (progress, stage, message) => {
        // 排队事件发生在入队后，标记一下（原生生命周期，与是否当前歌曲无关）
        if (stage === 'queued' || stage === 'decoding' || stage === 'inferring') enqueued = true
        // 仅当前歌曲的进度才回灌面板；后台其它歌曲静默分离、落盘缓存即可
        if (!isForCurrent()) return
        setTask({
          status: stage === 'downloading-model' || stage === 'downloading-audio'
            ? 'downloading'
            : stage === 'queued' ? 'queued'
            : stage === 'decoding' ? 'decoding' : 'inferring',
          progress: stage === 'queued' ? 0 : progress,
          message,
          songId: song.id,
        })
      },
    })
    enqueued = true
    if (isForCurrent()) {
      setTask({ status: 'done', progress: 1, songId: song.id })
    }

    // 完成后若仍停在同一首歌且用户选择了非原唱模式，自动切换
    const now = await getCurrentSong()
    if (now && now.id === song.id && state.desiredMode !== 'original') {
      await startMix(state.desiredMode as Exclude<VocalMode, 'original'>)
    }
  } catch (e: any) {
    // 切歌/切回原唱触发的取消、或队列超员丢弃：非异常，不弹提示
    if (e instanceof SeparationCancelledError) {
      if (state.task.songId === song.id) setTask({ status: 'idle', progress: 0 })
      return
    }
    // 下载阶段就失败：Service 只有 warmup 保活、没有实际任务，立即关闭通知，
    // 否则前台通知会一直挂到 60s 超时
    if (!enqueued) cancelSeparation()
    if (state.task.songId === song.id) {
      setTask({ status: 'error', progress: 0, songId: song.id, message: e?.message ?? '分离失败' })
    }
    // 仅当前歌曲失败才回退模式并提示；后台歌曲失败保持静默（切到该歌时会自动重试），
    // 避免用户正听着已缓存歌曲时被无关的后台失败打断或重置模式。
    if (isForCurrent()) {
      // 失败回退原唱
      if (state.activeMode === 'original') {
        state.desiredMode = 'original'
        emit()
      }
      toast(`人声分离失败：${e?.message ?? '未知错误'}`)
    }
  }
}

/** 是否有针对指定歌曲（或任意歌曲）的分离任务正在进行（含排队等待） */
const isTaskBusy = (songId?: string) => {
  const busy = state.task.status === 'downloading' ||
    state.task.status === 'queued' ||
    state.task.status === 'decoding' ||
    state.task.status === 'inferring'
  return busy && (songId == null || state.task.songId === songId)
}

// ---------------- 对外操作 ----------------

/** 用户切换模式（三档） */
export const setVocalMode = async(mode: VocalMode) => {
  state.desiredMode = mode
  state.mixError = null
  emit()

  if (mode === 'original') {
    // 切回原唱：进行中的分离任务没有继续的必要，取消省电（Service 会清理临时文件）
    if (isTaskBusy()) cancelSeparation()
    await backToOriginal()
    return
  }

  // 已在混音中：伴奏/人声之间直接切，无需重启
  if (state.activeMode !== 'original') {
    vocalMixPlayer.setMode(mode === 'vocals' ? 2 : 1)
    state.activeMode = mode
    emit()
    return
  }

  const song = await getCurrentSong()
  if (!song) return

  if (await isSongSeparated(song.id)) {
    await startMix(mode)
  } else {
    // 未分离：原唱继续放，后台分离，完成自动切
    if (!isTaskBusy(song.id)) {
      void startSeparation(song)
    }
    toast('人声分离中，完成后自动切换')
  }
}

/** 实时调节去人声强度 0..1 */
export const setVocalStrength = async(value: number) => {
  state.strength = Math.min(1, Math.max(0, value))
  emit()
  vocalMixPlayer.setStrength(state.strength)
  void AsyncStorage.setItem(STORAGE_STRENGTH, String(state.strength))
}

/** 当前播放歌曲是否已完成分离（缓存可用） */
export const isCurrentSongSeparated = async(): Promise<boolean> => {
  const song = await getCurrentSong()
  return !!song && await isSongSeparated(song.id)
}

/** 从歌曲对象（在线/本地/已下载项）取 "歌手 - 歌名" 作为文件名主体 */
const buildSongFileName = (mi: LX.Music.MusicInfo | LX.Download.ListItem | null): string => {
  const info: any = mi
    ? ('musicInfo' in (mi as any) ? (mi as any).musicInfo : mi)
    : null
  const name: string = info?.name ?? ''
  const singer: string = info?.singer ?? ''
  const base = [singer, name].filter(Boolean).join(' - ').trim()
  return base || '人声分离'
}

/**
 * 把当前歌曲的某一轨（人声/伴奏）保存到手机公共音乐目录。
 * Android 10+ 走 MediaStore 无需权限；Android 9 及以下需写存储权限。
 */
export const saveStem = async(stem: StemType) => {
  const song = await getCurrentSong()
  if (!song) {
    toast('未获取到当前歌曲')
    return
  }
  if (!(await isSongSeparated(song.id))) {
    toast('请先完成人声分离再保存')
    return
  }

  // 旧机型（Android 9 及以下）直写公共目录需要运行时存储权限
  if (Platform.OS === 'android' && Platform.Version < 29) {
    const perm = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
    if (!(await PermissionsAndroid.check(perm))) {
      const r = await PermissionsAndroid.request(perm)
      if (r !== PermissionsAndroid.RESULTS.GRANTED) {
        toast('需要存储权限才能保存到本地')
        return
      }
    }
  }

  const suffix = stem === 'vocals' ? '人声' : '伴奏'
  const displayName = `${buildSongFileName(song.musicInfo)} - ${suffix}`
  try {
    const res = await exportStem(song.id, stem, displayName)
    toast(`已保存：${res.path}`)
  } catch (e: any) {
    toast(`保存失败：${e?.message ?? e}`)
  }
}

export const getVocalState = (): VocalState => ({
  ...state,
  task: { ...state.task },
})

// ---------------- 初始化 ----------------

export const initVocalSeparation = async() => {
  if (inited) return
  inited = true

  // 恢复强度设置
  const saved = await AsyncStorage.getItem(STORAGE_STRENGTH)
  if (saved != null) {
    const v = Number(saved)
    if (!Number.isNaN(v)) state.strength = Math.min(1, Math.max(0, v))
  }

  // 安全兜底：启动时确保主播放器有声
  await TrackPlayer.setVolume(1).catch(() => {})

  // 切歌（含播完自动切下一首）：
  //  - 混音必须停（双轨是上一首歌的），UI 状态重置
  //  - 但【不取消】旧歌的原生分离任务：让它在后台跑完并落盘缓存，
  //    新歌进入 Service FIFO 队列等待。这样旧歌分离到一半切走再切回不用重算，
  //    锁屏后歌曲自动连播也能逐首完成分离。用户主动切回「原唱」才会取消队列。
  TrackPlayer.addEventListener(TPEvent.PlaybackTrackChanged, async() => {
    stopMix()
    state.activeMode = 'original'
    setTask({ status: 'idle', progress: 0 })

    const song = await getCurrentSong()
    if (state.desiredMode !== 'original' && song) {
      if (await isSongSeparated(song.id)) {
        // 等 TrackPlayer 起播后再跟（缓冲期间 syncTo 会自动等待）
        setTimeout(() => { void startMix(state.desiredMode as Exclude<VocalMode, 'original'>) }, 1200)
      } else {
        await TrackPlayer.setVolume(1).catch(() => {})
        // 同一首未缓存歌曲已在分离中则不重复发起（原生侧对同 songId 进行中/排队任务
        // 也会去重，双保险，避免切走又切回时重复计算）。
        if (!isTaskBusy(song.id)) void startSeparation(song)
      }
    } else {
      await TrackPlayer.setVolume(1).catch(() => {})
    }
  })

  // 播放/暂停状态变化：立即同步混音引擎（不等 500ms 轮询）
  TrackPlayer.addEventListener(TPEvent.PlaybackState, () => {
    void syncNow()
  })

  // 混音播完（曲终）：恢复音量，TrackPlayer 会自动切下一首
  vocalMixPlayer.addEndedListener(() => {
    stopMix()
    state.activeMode = 'original'
    void TrackPlayer.setVolume(1).catch(() => {})
    emit()
  })

  // 混音异常：回退原唱
  vocalMixPlayer.addErrorListener((e) => {
    void backToOriginal()
    state.desiredMode = 'original'
    emit()
    toast(`人声播放异常，已恢复原唱：${e.message}`)
  })
}

// ---------------- 缓存管理（设置页用） ----------------

export const clearVocalCache = async(songId?: string) => {
  // 清理前先停止混音（mmap 占用会导致文件删除失败）
  if (!songId) {
    stopMix()
    state.activeMode = 'original'
    state.desiredMode = 'original'
    await TrackPlayer.setVolume(1).catch(() => {})
    emit()
  }
  const bytes = await clearSeparationCache(songId)
  return bytes
}

export const getVocalCacheInfo = () => getSeparationCacheInfo()

/** 导出人声分离缓存为 zip 包到指定目录 */
export const exportVocalCache = (targetDirPath: string, fileName: string) => {
  return vocalSeparator.exportCache(targetDirPath, fileName)
}

/** 从 zip 包导入人声分离缓存 */
export const importVocalCache = (zipFilePath: string) => {
  return vocalSeparator.importCache(zipFilePath)
}
