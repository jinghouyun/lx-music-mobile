package com.kugou.android.vocalsep

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/**
 * 人声分离原生模块。
 *
 * JS 侧调用 separate() 后在后台线程执行：
 *   MediaCodec 硬解 -> 44.1k 重采样 -> htdemucs 分块推理 -> 双轨 WAV
 * 全程通过 "VocalSepProgress" 事件上报进度。
 *
 * 缓存目录：filesDir/vocalsep/<songId>/{vocals.wav,accompaniment.wav}
 */
class VocalSeparatorModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "VocalSeparator"

  private val running = java.util.concurrent.atomic.AtomicBoolean(false)

  private fun cacheRoot(): File = File(reactContext.filesDir, "vocalsep")

  private fun songDir(songId: String): File = File(cacheRoot(), songId)

  private fun emit(params: WritableMap) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      ?.emit("VocalSepProgress", params)
  }

  private fun progress(songId: String, status: String, fraction: Double, message: String?) {
    val m = Arguments.createMap()
    m.putString("songId", songId)
    m.putString("status", status)
    m.putDouble("progress", fraction)
    if (message != null) m.putString("message", message)
    emit(m)
  }

  @ReactMethod
  fun separate(modelPath: String, audioPath: String, songId: String, ep: String?) {
    if (!running.compareAndSet(false, true)) {
      progress(songId, "error", 0.0, "已有分离任务在进行中")
      return
    }
    Thread {
      try {
        val outDir = songDir(songId)
        // 已缓存则直接完成
        val v = File(outDir, "vocals.wav")
        val a = File(outDir, "accompaniment.wav")
        if (v.exists() && a.exists()) {
          progress(songId, "done", 1.0, "已缓存")
          return@Thread
        }
        outDir.mkdirs()

        val workDir = File(reactContext.cacheDir, "vocalsep_work/$songId")
        workDir.mkdirs()

        progress(songId, "decoding", 0.0, "正在解码音频…")
        val decoder = AudioDecoder()
        val decoded = decoder.decode(audioPath, workDir)

        progress(songId, "inferring", 0.0, "正在分离人声…")
        val engine = DemucsSeparator(
          modelPath,
          ep ?: "xnnpack",
        ) { fraction, _ ->
          progress(songId, "inferring", fraction, "正在分离人声… ${(fraction * 100).toInt()}%")
        }
        engine.open()
        try {
          engine.separate(decoded.ch0File, decoded.ch1File, decoded.samples, outDir)
        } finally {
          engine.close()
        }

        // 清理临时文件
        decoded.ch0File.delete()
        decoded.ch1File.delete()
        workDir.delete()

        progress(songId, "done", 1.0, "分离完成")
      } catch (t: Throwable) {
        progress(songId, "error", 0.0, t.message ?: t.javaClass.simpleName)
      } finally {
        running.set(false)
      }
    }.start()
  }

  @ReactMethod
  fun isCached(songId: String, promise: Promise) {
    val v = File(songDir(songId), "vocals.wav")
    val a = File(songDir(songId), "accompaniment.wav")
    promise.resolve(v.exists() && a.exists())
  }

  @ReactMethod
  fun getStemPaths(songId: String, promise: Promise) {
    val v = File(songDir(songId), "vocals.wav")
    val a = File(songDir(songId), "accompaniment.wav")
    if (!v.exists() || !a.exists()) {
      promise.resolve(null)
      return
    }
    val m = Arguments.createMap()
    m.putString("vocals", v.absolutePath)
    m.putString("accompaniment", a.absolutePath)
    promise.resolve(m)
  }

  @ReactMethod
  fun clearCache(songId: String?, promise: Promise) {
    var freed = 0L
    if (songId.isNullOrEmpty()) {
      val root = cacheRoot()
      if (root.exists()) {
        freed = dirSize(root)
        root.deleteRecursively()
      }
    } else {
      val d = songDir(songId)
      if (d.exists()) {
        freed = dirSize(d)
        d.deleteRecursively()
      }
    }
    promise.resolve(freed.toDouble())
  }

  @ReactMethod
  fun getCacheInfo(promise: Promise) {
    val root = cacheRoot()
    var size = 0L
    var count = 0
    if (root.exists()) {
      root.listFiles()?.forEach { d ->
        if (File(d, "vocals.wav").exists()) {
          count++
          size += dirSize(d)
        }
      }
    }
    val m = Arguments.createMap()
    m.putDouble("sizeBytes", size.toDouble())
    m.putInt("songCount", count)
    promise.resolve(m)
  }

  private fun dirSize(d: File): Long {
    var s = 0L
    d.listFiles()?.forEach { f ->
      s += if (f.isDirectory) dirSize(f) else f.length()
    }
    return s
  }

  // NativeEventEmitter 在 Android 上要求的订阅桩方法
  @ReactMethod fun addListener(eventName: String) { /* 仅占位 */ }
  @ReactMethod fun removeListeners(count: Int) { /* 仅占位 */ }
}
