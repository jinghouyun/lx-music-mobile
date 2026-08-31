import { NativeModules, NativeEventEmitter } from 'react-native'

const { VocalMixPlayer } = NativeModules

export type MixMode = 1 // 伴奏
  | 2 // 纯人声

interface PreparedInfo {
  durationMs: number
}

const emitter = new NativeEventEmitter(VocalMixPlayer)

/**
 * 双轨混音原生播放器（AudioTrack 单输出，双轨采样级同步）。
 * 时钟由 TrackPlayer 主导，JS 定时调用 syncTo 跟随。
 */
export const vocalMixPlayer = {
  prepare(vocalsPath: string, accPath: string): Promise<PreparedInfo> {
    return VocalMixPlayer.prepare(vocalsPath, accPath)
  },

  /**
   * @param startMs 起始位置
   * @param mode 1=伴奏 2=纯人声
   * @param strength 去人声强度 0..1（伴奏模式下人声增益 = 1-strength）
   */
  play(startMs: number, mode: MixMode, strength: number) {
    VocalMixPlayer.play(startMs, mode, strength)
  },

  pause() { VocalMixPlayer.pause() },
  resume() { VocalMixPlayer.resume() },
  stop() { VocalMixPlayer.stop() },
  setMode(mode: MixMode) { VocalMixPlayer.setMode(mode) },
  setStrength(strength: number) { VocalMixPlayer.setStrength(strength) },
  seekTo(ms: number) { VocalMixPlayer.seekTo(ms) },

  /** 时钟同步：targetMs = TrackPlayer 进度，isPlaying = TP 是否在播放 */
  syncTo(targetMs: number, isPlaying: boolean) {
    VocalMixPlayer.syncTo(targetMs, isPlaying)
  },

  getPosition(): Promise<number> {
    return VocalMixPlayer.getPosition()
  },

  addEndedListener(cb: () => void) {
    return emitter.addListener('VocalMixPlayer_ended', cb)
  },
  addErrorListener(cb: (e: { message: string }) => void) {
    return emitter.addListener('VocalMixPlayer_error', cb)
  },
}
