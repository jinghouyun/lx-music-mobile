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
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

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
      if (status == "inferring" || status == "decoding" || status == "queued" ||
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
    // 委托前台 Service：保活 + 通知进度/取消 + FIFO 队列（切歌不打断当前任务）
    VocalSepService.start(reactContext, modelPath, audioPath, songId, ep ?: "xnnpack")
  }

  /**
   * 提前启动前台 Service 保活（不带实际任务）。
   * JS 侧下载模型（约 165MB）/音频可能耗时数十秒，这期间若没有前台服务，
   * 锁屏/切后台后国产 ROM 会冻结网络与 JS，导致下载停滞、亮屏后像"重新开始"。
   * 入队实际任务后保活自动延续；任务取消或 60s 空闲后 Service 自行停止。
   */
  @ReactMethod
  fun warmup() {
    try {
      VocalSepService.warmup(reactContext)
    } catch (_: Throwable) { /* 后台启动受限等，忽略；真正入队时会再试 */ }
  }

  /**
   * JS 下载阶段（模型/音频）进度转发到前台通知，使通知栏与面板进度完全一致。
   * 原生解码/推理开始后 Service 会自行渲染通知并忽略这里的转发。
   */
  @ReactMethod
  fun notifyProgress(stage: String, fraction: Double, message: String?) {
    try {
      VocalSepService.postExternalProgress(stage, fraction, message)
    } catch (_: Throwable) { /* 忽略 */ }
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
        // 与分离完成判定(isCached)/导出口径一致：双轨齐全才算一首已分离，
        // 半成品目录（仅一轨、.tmp、_import_tmp_、.cachever 文件）不计入。
        val hasVocals = File(d, "vocals.wav").exists()
        val hasAcc = File(d, "accompaniment.wav").exists()
        if (d.isDirectory && hasVocals && hasAcc) {
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

  /**
   * 把所有人声分离缓存（每首歌的 vocals.wav + accompaniment.wav）打包成 zip。
   *
   * @param targetDirPath 目标目录（用户在 ChoosePath 里选的文件夹）
   * @param fileName      不含 .zip 后缀的文件名，如 "vocal_sep_cache"
   * 返回 { path, songCount, totalBytes }
   */
  @ReactMethod
  fun exportCache(targetDirPath: String, fileName: String, promise: Promise) {
    try {
      val root = cacheRoot()
      if (!root.exists()) {
        promise.reject("E_NO_CACHE", "没有可导出的缓存")
        return
      }
      val songs = root.listFiles()?.filter { d ->
        File(d, "vocals.wav").exists() && File(d, "accompaniment.wav").exists()
      } ?: emptyList()
      if (songs.isEmpty()) {
        promise.reject("E_NO_CACHE", "没有可导出的缓存")
        return
      }

      val safeName = sanitizeFileName(fileName.ifBlank { "vocal_sep_cache" })
      val outFile = File(targetDirPath, "$safeName.zip")
      // 同名自动追加序号
      var finalFile = outFile
      var i = 1
      while (finalFile.exists()) {
        finalFile = File(targetDirPath, "$safeName ($i).zip")
        i++
      }

      var totalBytes = 0L
      ZipOutputStream(FileOutputStream(finalFile)).use { zos ->
        val buf = ByteArray(8192)
        for (songDir in songs) {
          val songId = songDir.name
          for (stem in arrayOf("vocals.wav", "accompaniment.wav")) {
            val f = File(songDir, stem)
            if (!f.exists()) continue
            totalBytes += f.length()
            val entry = ZipEntry("$songId/$stem")
            zos.putNextEntry(entry)
            FileInputStream(f).use { fis ->
              var len: Int
              while (fis.read(buf).also { len = it } > 0) {
                zos.write(buf, 0, len)
              }
            }
            zos.closeEntry()
          }
        }
      }

      val m = Arguments.createMap()
      m.putString("path", finalFile.absolutePath)
      m.putInt("songCount", songs.size)
      m.putDouble("totalBytes", totalBytes.toDouble())
      promise.resolve(m)
    } catch (e: Throwable) {
      promise.reject("E_EXPORT", "导出失败: ${e.message}", e)
    }
  }

  /**
   * 从 zip 包导入人声分离缓存，恢复到 filesDir/vocalsep/ 下。
   * 已存在的歌曲会跳过（不覆盖），避免破坏已有缓存。
   *
   * @param zipFilePath zip 文件路径
   * 返回 { importedCount, skippedCount, totalBytes }
   */
  @ReactMethod
  fun importCache(zipFilePath: String, promise: Promise) {
    try {
      val zipFile = File(zipFilePath)
      if (!zipFile.exists()) {
        promise.reject("E_NO_FILE", "文件不存在")
        return
      }

      val root = cacheRoot()
      if (!root.exists()) root.mkdirs()

      var importedCount = 0
      var skippedCount = 0
      var totalBytes = 0L
      val buf = ByteArray(8192)
      val tmpDir = File(root, "_import_tmp_${System.currentTimeMillis()}")
      tmpDir.mkdirs()

      try {
        ZipInputStream(FileInputStream(zipFile)).use { zis ->
          var entry: ZipEntry?
          while (zis.nextEntry.also { entry = it } != null) {
            val e = entry ?: continue
            if (e.isDirectory) continue

            val parts = e.name.split('/', limit = 2)
            if (parts.size != 2) continue
            val songId = parts[0]
            val stemName = parts[1]
            if (stemName != "vocals.wav" && stemName != "accompaniment.wav") continue

            // 目标目录已存在完整缓存则跳过
            val targetDir = File(root, songId)
            val vExists = File(targetDir, "vocals.wav").exists()
            val aExists = File(targetDir, "accompaniment.wav").exists()
            if (vExists && aExists) {
              // 累计两首 wav 才算一次 skip，但只在遇到第一首时记
              if (stemName == "vocals.wav") skippedCount++
              continue
            }

            // 先写到临时目录，两首都齐了再重命名过去（原子性）
            val tmpSongDir = File(tmpDir, songId)
            if (!tmpSongDir.exists()) tmpSongDir.mkdirs()
            val tmpFile = File(tmpSongDir, stemName)
            FileOutputStream(tmpFile).use { fos ->
              var len: Int
              while (zis.read(buf).also { len = it } > 0) {
                fos.write(buf, 0, len)
              }
            }
            totalBytes += tmpFile.length()

            // 如果两首都写完了，把临时目录移到正式目录
            if (File(tmpSongDir, "vocals.wav").exists() && File(tmpSongDir, "accompaniment.wav").exists()) {
              if (!targetDir.exists()) {
                tmpSongDir.renameTo(targetDir)
                importedCount++
              } else {
                // 目标目录存在但不完整，合并文件
                for (stem in arrayOf("vocals.wav", "accompaniment.wav")) {
                  val src = File(tmpSongDir, stem)
                  val dst = File(targetDir, stem)
                  if (src.exists() && !dst.exists()) {
                    src.copyTo(dst, overwrite = false)
                  }
                }
                tmpSongDir.deleteRecursively()
                // 如果之前只有一首不完整，这里也算一次导入
                if (!vExists || !aExists) importedCount++
              }
            }
          }
        }

        // 清理未配对的临时目录（zip 里只有一首 wav 的异常情况）
        if (tmpDir.exists()) tmpDir.deleteRecursively()

        val m = Arguments.createMap()
        m.putInt("importedCount", importedCount)
        m.putInt("skippedCount", skippedCount)
        m.putDouble("totalBytes", totalBytes.toDouble())
        promise.resolve(m)
      } catch (e: Throwable) {
        if (tmpDir.exists()) runCatching { tmpDir.deleteRecursively() }
        throw e
      }
    } catch (e: Throwable) {
      promise.reject("E_IMPORT", "导入失败: ${e.message}", e)
    }
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
