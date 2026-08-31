package com.kugou.android.vocalsep

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.Process
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 人声分离前台 Service：
 *  - 前台通知保活（切后台/灭屏不被系统杀死），通知上显示进度并带「取消」按钮
 *  - 工作线程提权到 THREAD_PRIORITY_FOREGROUND（Android EAS 调度下 uclamp 提升，优先派大核；
 *    ORT 原生推理线程由该线程创建，nice 值继承，同样跑在大核）
 *  - 单 worker 任务队列：同一时刻只有一个分离任务；新任务（切歌）入队会立即取消旧任务，
 *    旧任务在分块间隙退出并清理临时文件后，worker 接着跑新任务——绝不会出现两个 ONNX
 *    会话并发争抢 CPU/内存。
 *  - 与 VocalSeparatorModule 同进程，通过 companion 的 eventListener 回传进度事件。
 */
class VocalSepService : Service() {

  private class Job(
    val modelPath: String,
    val audioPath: String,
    val songId: String,
    val ep: String,
    val cancelled: AtomicBoolean = AtomicBoolean(false),
  )

  companion object {
    const val ACTION_START = "com.kugou.android.vocalsep.START"
    const val ACTION_CANCEL = "com.kugou.android.vocalsep.CANCEL"

    private const val CHANNEL_ID = "vocal_sep"
    private const val NOTIF_ID = 4721

    /** Module 注册：把原生进度事件转发给 RN */
    @Volatile
    var eventListener: ((songId: String, status: String, fraction: Double, message: String?) -> Unit)? = null

    @Volatile private var instance: VocalSepService? = null

    /** 通知栏「取消」/ Module.cancel：取消当前任务并丢弃排队任务 */
    fun requestCancel() {
      instance?.cancelAll()
    }

    fun start(context: Context, modelPath: String, audioPath: String, songId: String, ep: String) {
      val intent = Intent(context, VocalSepService::class.java).apply {
        action = ACTION_START
        putExtra("modelPath", modelPath)
        putExtra("audioPath", audioPath)
        putExtra("songId", songId)
        putExtra("ep", ep)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }
  }

  private val lock = Object()
  private var current: Job? = null
  private var pending: Job? = null
  private var workerAlive = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    createChannel()
  }

  override fun onDestroy() {
    instance = null
    super.onDestroy()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_CANCEL -> {
        cancelAll()
        return START_NOT_STICKY
      }
      ACTION_START -> {
        val modelPath = intent.getStringExtra("modelPath")
        val audioPath = intent.getStringExtra("audioPath")
        val songId = intent.getStringExtra("songId")
        val ep = intent.getStringExtra("ep") ?: "xnnpack"
        if (modelPath != null && audioPath != null && songId != null) {
          enqueue(Job(modelPath, audioPath, songId, ep))
        }
      }
    }
    return START_NOT_STICKY
  }

  /** 新任务入队：同歌重复请求忽略；否则取消当前任务、顶替排队任务 */
  private fun enqueue(job: Job) {
    // 尽快进入前台（startForegroundService 后 5s 内必须 startForeground）
    try {
      val notif = buildNotification(0, "正在准备…")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIF_ID, notif, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIF_ID, notif)
      }
    } catch (_: Throwable) { /* 渠道/系统限制，任务仍可跑 */ }

    synchronized(lock) {
      val cur = current
      if (cur != null && cur.songId == job.songId && !cur.cancelled.get()) return // 同歌进行中，忽略重复
      cur?.cancelled?.set(true)
      pending?.let { old ->
        // 被顶替的排队任务还没开始过，直接通知 JS 已取消，避免 Promise 悬挂
        if (old.songId != job.songId) emit(old.songId, "cancelled", 0.0, "已取消")
      }
      pending = job
      if (!workerAlive) {
        workerAlive = true
        Thread({ workerLoop() }, "VocalSepWorker").start()
      } else {
        lock.notifyAll()
      }
    }
  }

  private fun cancelAll() {
    synchronized(lock) {
      current?.cancelled?.set(true)
      pending?.let { emit(it.songId, "cancelled", 0.0, "已取消") }
      pending = null
      lock.notifyAll()
    }
  }

  private fun workerLoop() {
    // 提权：前台优先级，EAS 调度器提升 uclamp，优先派发大核
    Process.setThreadPriority(Process.THREAD_PRIORITY_FOREGROUND)
    try {
      while (true) {
        val job = synchronized(lock) {
          while (pending == null) lock.wait(10_000)
          val j = pending
          pending = null
          current = j
          j
        } ?: break

        if (job.cancelled.get()) {
          emit(job.songId, "cancelled", 0.0, "已取消")
        } else {
          runJob(job)
        }

        // 注意：Kotlin 禁止在 inline lambda 内 break/continue，用返回值控制循环
        val hasMore = synchronized(lock) {
          current = null
          if (pending == null) {
            workerAlive = false
            false
          } else {
            true
          }
        }
        if (!hasMore) break
      }
    } finally {
      synchronized(lock) { workerAlive = false }
      stopForeground(true)
      stopSelf()
    }
  }

  private fun emit(songId: String, status: String, fraction: Double, message: String?) {
    eventListener?.invoke(songId, status, fraction, message)
  }

  private fun runJob(job: Job) {
    var engine: DemucsSeparator? = null
    try {
      val outDir = File(filesDir, "vocalsep/${job.songId}")
      val v = File(outDir, "vocals.wav")
      val a = File(outDir, "accompaniment.wav")
      if (v.exists() && a.exists()) {
        emit(job.songId, "done", 1.0, "已缓存")
        return
      }
      outDir.mkdirs()
      val workDir = File(cacheDir, "vocalsep_work/${job.songId}")
      workDir.mkdirs()

      emit(job.songId, "decoding", 0.0, "正在解码音频…")
      updateNotification(0, "正在解码音频…")
      val decoder = AudioDecoder()
      val decoded = decoder.decode(job.audioPath, workDir)
      if (job.cancelled.get()) throw SeparationCancelledException()

      emit(job.songId, "inferring", 0.0, "正在分离人声…")
      var backendTag = ""
      engine = DemucsSeparator(job.modelPath, job.ep) { fraction, _ ->
        if (job.cancelled.get()) engine?.cancelled = true
        val pct = (fraction * 100).toInt()
        emit(job.songId, "inferring", fraction, "正在分离人声… $pct%$backendTag")
        updateNotification(pct, "AI 分离中 $pct%$backendTag")
      }
      engine.open()
      // 会话创建后实际后端/线程数才确定；透传到进度文案，真机上即可确认 XNNPACK 是否生效
      backendTag = " · ${engine.backendInfo}"
      emit(job.songId, "inferring", 0.0, "正在分离人声… 0%$backendTag")
      try {
        engine.separate(decoded.ch0File, decoded.ch1File, decoded.samples, outDir)
      } finally {
        engine.close()
      }

      decoded.ch0File.delete()
      decoded.ch1File.delete()
      workDir.delete()

      if (job.cancelled.get()) {
        // 推理刚好在取消标志到达时完成：输出文件已落盘，按取消处理，由下次请求重新判定缓存
        emit(job.songId, "cancelled", 0.0, "已取消")
      } else {
        emit(job.songId, "done", 1.0, "分离完成")
      }
    } catch (t: Throwable) {
      if (t is SeparationCancelledException || job.cancelled.get()) {
        emit(job.songId, "cancelled", 0.0, "已取消")
      } else {
        emit(job.songId, "error", 0.0, t.message ?: t.javaClass.simpleName)
      }
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val mgr = getSystemService(NotificationManager::class.java)
      if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
        val ch = NotificationChannel(
          CHANNEL_ID,
          "人声分离",
          NotificationManager.IMPORTANCE_LOW, // 无声、不弹窗
        ).apply {
          description = "人声分离进度"
          setShowBadge(false)
        }
        mgr.createNotificationChannel(ch)
      }
    }
  }

  private fun buildNotification(pct: Int, text: String): Notification {
    val cancelIntent = Intent(this, VocalSepService::class.java).apply { action = ACTION_CANCEL }
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    else PendingIntent.FLAG_UPDATE_CURRENT
    val cancelPi = PendingIntent.getService(this, 0, cancelIntent, flags)

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("人声分离")
      .setContentText("$text（$pct%）")
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setOngoing(true)
      .setProgress(100, pct, pct <= 0)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "取消", cancelPi)
      .build()
  }

  private fun updateNotification(pct: Int, text: String) {
    if (pct % 5 != 0 && pct != 100 && pct != 0) return // 节流，5% 刷一次
    try {
      val mgr = getSystemService(NotificationManager::class.java)
      mgr.notify(NOTIF_ID, buildNotification(pct.coerceIn(0, 100), text))
    } catch (_: Exception) { /* 渠道未就绪等 */ }
  }
}
