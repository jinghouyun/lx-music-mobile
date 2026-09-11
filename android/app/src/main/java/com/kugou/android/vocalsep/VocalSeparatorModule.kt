package com.kugou.android.vocalsep

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

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

  init {
    // Service 回调 -> RN 事件（同进程）；任务串行/取消/排队都由 Service 内部队列保证
    VocalSepService.eventListener = { songId, status, fraction, message ->
      if (status == "inferring" || status == "decoding" ||
        status == "done" || status == "error" || status == "cancelled") {
        progress(songId, status, fraction, message)
      }
    }
  }

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
    // 国产 ROM（vivo/小米等）锁屏后会冻结后台：首次分离时引导用户把 App 加入电池优化白名单
    requestIgnoreBatteryOptimizationsOnce()
    // 委托前台 Service：保活 + 通知进度/取消 + 单 worker 队列（切歌自动取消旧任务）
    VocalSepService.start(reactContext, modelPath, audioPath, songId, ep ?: "xnnpack")
  }

  /**
   * 首次分离时弹一次系统对话框，请求"忽略电池优化"。
   * 这是 vivo OriginOS / 小米 MIUI 等保活的关键：否则即便有前台 Service + WakeLock，
   * 锁屏一段时间后进程仍可能被系统冻结/杀死，导致分离中断、亮屏后重新开始。
   * 用 SharedPreferences 保证只问一次，用户拒绝也不再打扰。
   */
  private fun requestIgnoreBatteryOptimizationsOnce() {
    try {
      val pm = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
      if (pm.isIgnoringBatteryOptimizations(reactContext.packageName)) return
      val prefs = reactContext.getSharedPreferences("vocalsep", Context.MODE_PRIVATE)
      if (prefs.getBoolean("battery_opt_asked", false)) return
      prefs.edit().putBoolean("battery_opt_asked", true).apply()
      val activity = reactContext.currentActivity ?: return
      @Suppress("BatteryLife")
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:${reactContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)
    } catch (_: Throwable) { /* 部分机型无该设置页，忽略 */ }
  }

  /** 取消当前分离任务并丢弃排队任务（切歌/切回原唱时调用） */
  @ReactMethod
  fun cancel() {
    VocalSepService.requestCancel()
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

  /**
   * 把某首歌分离出的某一轨（vocals / accompaniment）保存到手机公共音乐目录，
   * 使其出现在系统媒体库/文件管理器中，可被其它播放器识别。
   *
   * @param songId      缓存用的歌曲 id（与 separate 时一致）
   * @param stem        "vocals"（人声）或 "accompaniment"（伴奏）
   * @param displayName 不含扩展名的文件名（JS 侧已做非法字符清洗），如 "歌名 - 伴奏"
   *
   * Android 10+ 走 MediaStore（应用贡献媒体无需存储权限），
   * Android 9 及以下直写公共 Music 目录并触发媒体扫描（依赖已授予的写存储权限）。
   * 返回 { uri, path }。
   */
  @ReactMethod
  fun exportStem(songId: String, stem: String, displayName: String, promise: Promise) {
    try {
      val srcFile = when (stem) {
        "vocals" -> File(songDir(songId), "vocals.wav")
        "accompaniment" -> File(songDir(songId), "accompaniment.wav")
        else -> { promise.reject("E_BAD_STEM", "未知分轨: $stem"); return }
      }
      if (!srcFile.exists()) {
        promise.reject("E_NO_STEM", "分轨文件不存在，请先完成分离")
        return
      }
      val safeName = sanitizeFileName(displayName.ifBlank { songId })
      val result: Pair<String, String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          exportViaMediaStore(srcFile, safeName)
        } else {
          exportLegacy(srcFile, safeName)
        }
      val m = Arguments.createMap()
      m.putString("uri", result.first)
      m.putString("path", result.second)
      promise.resolve(m)
    } catch (e: Throwable) {
      promise.reject("E_EXPORT", "保存失败: ${e.message}", e)
    }
  }

  /** 清洗文件名为各文件系统/媒体库都安全的形式 */
  private fun sanitizeFileName(name: String): String {
    var n = name.replace(Regex("[\\\\/:*?\"<>|\\r\\n\\t]"), "_").trim()
    n = n.replace(Regex("\\s+"), " ").trim()
    if (n.isEmpty()) n = "vocal_sep"
    if (n.length > 120) n = n.substring(0, 120).trim()
    return n
  }

  /** Android 10+：通过 MediaStore 写入 Music/AppleMusic/，无需存储权限 */
  private fun exportViaMediaStore(src: File, baseName: String): Pair<String, String> {
    val resolver = reactContext.contentResolver
    val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val relPath = "${Environment.DIRECTORY_MUSIC}/AppleMusic/"
    val mime = "audio/wav"

    // 同名时自动追加 (1)(2)，避免覆盖用户已有文件
    var finalName = baseName
    var attempt = 0
    while (attempt < 50) {
      val fileName = if (attempt == 0) "$finalName.wav" else "$finalName ($attempt).wav"
      val values = ContentValues().apply {
        put(MediaStore.Audio.Media.DISPLAY_NAME, fileName)
        put(MediaStore.Audio.Media.MIME_TYPE, mime)
        put(MediaStore.Audio.Media.RELATIVE_PATH, relPath)
        put(MediaStore.Audio.Media.IS_MUSIC, 1)
        put(MediaStore.Audio.Media.TITLE, finalName)
        put(MediaStore.Audio.Media.ARTIST, "Apple Music")
        put(MediaStore.Audio.Media.DATE_ADDED, System.currentTimeMillis() / 1000)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          put(MediaStore.Audio.Media.IS_PENDING, 1)
        }
      }
      val uri: Uri? = resolver.insert(collection, values)
      if (uri == null) { attempt++; continue }
      try {
        resolver.openOutputStream(uri, "w")?.use { out ->
          FileInputStream(src).use { it.copyTo(out) }
        } ?: throw IllegalStateException("无法打开输出流")
        values.clear()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          values.put(MediaStore.Audio.Media.IS_PENDING, 0)
        }
        resolver.update(uri, values, null, null)
        val human = "Music/AppleMusic/$fileName"
        return Pair(uri.toString(), human)
      } catch (e: Exception) {
        // 极少见：并发插入同名导致冲突，删除半成品后换名重试
        runCatching { resolver.delete(uri, null, null) }
        attempt++
        if (attempt >= 50) throw e
      }
    }
    throw IllegalStateException("无法创建媒体文件（重名过多）")
  }

  /** Android 9 及以下：直写公共 Music 目录并扫描进媒体库 */
  private fun exportLegacy(src: File, baseName: String): Pair<String, String> {
    @Suppress("DEPRECATION")
    val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC), "AppleMusic")
    if (!dir.exists()) dir.mkdirs()
    var target = File(dir, "$baseName.wav")
    var i = 1
    while (target.exists()) {
      target = File(dir, "$baseName ($i).wav")
      i++
    }
    FileInputStream(src).use { input ->
      FileOutputStream(target).use { output -> input.copyTo(output) }
    }
    // 触发媒体扫描，让系统音乐/文件管理器立即可见
    MediaScannerConnection.scanFile(reactContext, arrayOf(target.absolutePath), arrayOf("audio/wav"), null)
    return Pair(Uri.fromFile(target).toString(), target.absolutePath)
  }
}
