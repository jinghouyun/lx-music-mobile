package com.kugou.android.vocalsep

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * 双轨混音播放器 RN 桥。
 * 与 TrackPlayer 的协调逻辑在 JS 侧：TrackPlayer 作为主时钟（音量置 0），
 * 本引擎作为"影子播放器"跟随其进度（syncTo），切歌/seek/进度条全部免费复用。
 */
class MixPlayerModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "VocalMixPlayer"

  private val engine = MixPlayerEngine().apply {
    onEnded = { emit("ended", null) }
    onError = { msg ->
      val m = Arguments.createMap()
      m.putString("message", msg)
      emit("error", m)
    }
  }

  private fun emit(event: String, params: WritableMap?) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      ?.emit("VocalMixPlayer_$event", params)
  }

  @ReactMethod
  fun prepare(vocalsPath: String, accPath: String, promise: Promise) {
    try {
      engine.prepare(vocalsPath, accPath)
      val m = Arguments.createMap()
      m.putDouble("durationMs", engine.getDurationMs().toDouble())
      promise.resolve(m)
    } catch (t: Throwable) {
      promise.reject("PREPARE_FAILED", t.message, t)
    }
  }

  /**
   * @param startMs 起始位置
   * @param mode 1=伴奏 2=纯人声
   * @param strength 去人声强度 0..1
   */
  @ReactMethod
  fun play(startMs: Double, mode: Int, strength: Float) {
    engine.setMode(mode)
    engine.setStrength(strength)
    engine.play(startMs.toLong())
  }

  @ReactMethod fun pause() = engine.pause()
  @ReactMethod fun resume() = engine.resumePlayback()
  @ReactMethod fun stop() = engine.stop()

  @ReactMethod fun setMode(mode: Int) = engine.setMode(mode)
  @ReactMethod fun setStrength(strength: Float) = engine.setStrength(strength)

  @ReactMethod
  fun seekTo(ms: Double) = engine.seekTo(ms.toLong())

  /** JS 定时喂入 TrackPlayer 进度做时钟同步 */
  @ReactMethod
  fun syncTo(targetMs: Double, isPlaying: Boolean) =
    engine.syncTo(targetMs.toLong(), isPlaying)

  @ReactMethod
  fun getPosition(promise: Promise) = promise.resolve(engine.getPositionMs().toDouble())

  @ReactMethod
  fun getDuration(promise: Promise) = promise.resolve(engine.getDurationMs().toDouble())

  // NativeEventEmitter 订阅桩
  @ReactMethod fun addListener(eventName: String) { /* 占位 */ }
  @ReactMethod fun removeListeners(count: Int) { /* 占位 */ }
}
