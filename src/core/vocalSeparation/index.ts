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
import AsyncStorage from '@react-native-async-storage/async-storage'
import { toast } from '@/utils/tools'
import { vocalMixPlayer } from '@/utils/nativeModules/vocalMixPlayer'
import {
  separateSong,
  isSongSeparated,
  getStemPaths,
  clearSeparationCache,
  getSeparationCacheInfo,
} from '@/utils/vocalSeparation'

export type VocalMode = 'original' | 'accompaniment' | 'vocals'

export interface SepTaskState {
  status: 'idle' | 'downloading' | 'decoding' | 'inferring' | 'done' | 'error'
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

const sanitizeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_')

const extFromUrl = (url: string) => {
  const m = url.split('?')[0].match(/\.(mp3|flac|m4a|aac|ogg|wav)$/i)
  return m ? m[1].toLowerCase() : 'mp3'
}

const getCurrentSong = async(): Promise<{ id: string, url: string } | null> => {
  try {
    const trackId = await TrackPlayer.getCurrentTrack()
    if (trackId == null) return null
    const track = await TrackPlayer.getTrack(trackId)
    if (!track || !track.url) return null
    return { id: sanitizeId(String(track.id)), url: track.url as string }
  } catch {
    return null
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

const startSync = () => {
  if (syncTimer) return
  syncTimer = setInterval(async() => {
    try {
      const pos = await TrackPlayer.getPosition()
      const tpState = await TrackPlayer.getState()
      vocalMixPlayer.syncTo(pos * 1000, tpState === TPState.Playing)
    } catch { /* 忽略 */ }
  }, 500)
}

const stopMix = () => {
  stopSync()
  vocalMixPlayer.stop()
}

/** 启动双轨混音播放（调用前已确认缓存存在） */
const startMix = async(mode: Exclude<VocalMode, 'original'>) => {
  const song = await getCurrentSong()
  if (!song) return
  const paths = await getStemPaths(song.id)
  if (!paths) return
  stopMix()
  const pos = await TrackPlayer.getPosition().catch(() => 0)
  await vocalMixPlayer.prepare(paths.vocals, paths.accompaniment)
  vocalMixPlayer.play(pos * 1000, mode === 'vocals' ? 2 : 1, state.strength)
  await TrackPlayer.setVolume(0)
  state.activeMode = mode
  startSync()
  emit()
}

const backToOriginal = async() => {
  stopMix()
  await TrackPlayer.setVolume(1).catch(() => {})
  state.activeMode = 'original'
  emit()
}

// ---------------- 分离任务 ----------------

const startSeparation = async(song: { id: string, url: string }) => {
  setTask({ status: 'downloading', progress: 0, songId: song.id, message: '准备中…' })
  try {
    await separateSong({
      songId: song.id,
      audioUrl: song.url,
      ext: extFromUrl(song.url),
      ep: 'xnnpack',
      onProgress: (progress, stage, message) => {
        setTask({
          status: stage === 'downloading-model' || stage === 'downloading-audio'
            ? 'downloading'
            : stage === 'decoding' ? 'decoding' : 'inferring',
          progress,
          message,
          songId: song.id,
        })
      },
    })
    setTask({ status: 'done', progress: 1, songId: song.id })

    // 完成后若仍停在同一首歌且用户选择了非原唱模式，自动切换
    const now = await getCurrentSong()
    if (now && now.id === song.id && state.desiredMode !== 'original') {
      await startMix(state.desiredMode as Exclude<VocalMode, 'original'>)
    }
  } catch (e: any) {
    setTask({ status: 'error', progress: 0, songId: song.id, message: e?.message ?? '分离失败' })
    // 失败回退原唱
    if (state.activeMode === 'original') {
      state.desiredMode = 'original'
      emit()
    }
    toast(`人声分离失败：${e?.message ?? '未知错误'}`)
  }
}

// ---------------- 对外操作 ----------------

/** 用户切换模式（三档） */
export const setVocalMode = async(mode: VocalMode) => {
  state.desiredMode = mode
  emit()

  if (mode === 'original') {
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
    const busy = state.task.status === 'downloading' ||
      state.task.status === 'decoding' ||
      state.task.status === 'inferring'
    if (!busy || state.task.songId !== song.id) {
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

  // 切歌
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
        void startSeparation(song)
      }
    } else {
      await TrackPlayer.setVolume(1).catch(() => {})
    }
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
