package com.kugou.android.vocalsep

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import java.io.File
import java.util.concurrent.ConcurrentLinkedDeque
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 人声分离前台 Service：
 *  - 前台通知保活（切后台/灭屏不被系统杀死），通知上显示进度并带「取消」按钮
 *  - 工作线程提权到 THREAD_PRIORITY_FOREGROUND（Android EAS 调度下 uclamp 提升，优先派大核；
 *    ORT 原生推理线程由该线程创建，nice 值继承，同样跑在大核）
 *  - FIFO 任务队列（新歌插队首但不打断正在跑的任务）：
 *    用户切歌时旧歌继续分离完并落盘缓存，新歌排队等待——避免"歌放完自动切歌 →
 *    分离被取消 → 切回来又要重新分离"。队列上限 [MAX_QUEUE]，超出丢弃最老的未开始任务。
 *  - 支持 warmup：JS 侧下载模型/音频期间（Service 还没有实际任务时）就以前台服务保活，
 *    锁屏后下载不被系统冻结；JS 同时把下载进度转发到通知栏，与面板进度完全一致。
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
    const val ACTION_WARMUP = "com.kugou.android.vocalsep.WARMUP"

    private const val CHANNEL_ID = "vocal_sep"
    private const val NOTIF_ID = 4721

    /** 待执行任务队列上限（不含正在执行的 1 个） */
    private const val MAX_QUEUE = 3

    /** 队列空转多久后自动停止前台服务（覆盖慢网络下 JS 下载模型/音频→入队之间的间隙） */
    private const val IDLE_STOP_DELAY_MS = 5 * 60_000L

    /** WakeLock 兜底超时：单首歌通常数分钟，连续队列给足 1 小时 */
    private const val WAKELOCK_TIMEOUT_MS = 60 * 60 * 1000L

    /** 分离缓存版本：修复"缓存 id 含随机数导致永不命中"问题后 bump，清掉旧的无效缓存 */
    private const val CACHE_VERSION = "stableid1"

    /** Module 注册：把原生进度事件转发给 RN */
    @Volatile
    var eventListener: ((songId: String, status: String, fraction: Double, message: String?) -> Unit)? = null

    @Volatile private var instance: VocalSepService? = null

    /** 通知栏「取消」/ Module.cancel：取消当前任务并清空排队任务 */
    fun requestCancel() {
      instance?.cancelAll()
    }

    /** 只保活 + 更新"准备/下载"通知，不带实际任务（JS 下载模型/音频期间调用） */
    fun warmup(context: Context) {
      try {
        val intent = Intent(context, VocalSepService::class.java).apply { action = ACTION_WARMUP }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (_: Throwable) { /* 后台启动受限：忽略，真正入队时 Module 会再兜底 */ }
    }

    /** JS 下载阶段的进度转发到通知栏（原生解码/推理开始后由 Service 自己渲染，忽略转发） */
    fun postExternalProgress(stage: String, fraction: Double, message: String?) {
      instance?.showExternalProgress(stage, fraction.coerceIn(0.0, 1.0), message)
    }

    fun start(context: Context, modelPath: String, audioPath: String, songId: String, ep: String) {
      try {
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
      } catch (_: Throwable) {
        // Android 12+ 后台启动 FGS 可能被系统拒绝；退化为普通 Service，任务仍可执行
        try {
          val intent = Intent(context, VocalSepService::class.java).apply {
            action = ACTION_START
            putExtra("modelPath", modelPath)
            putExtra("audioPath", audioPath)
            putExtra("songId", songId)
            putExtra("ep", ep)
          }
          context.startService(intent)
        } catch (_: Throwable) { /* 彻底无法启动，JS 侧 Promise 靠超时/重试发现 */ }
      }
    }
  }

  private val lock = Object()
  private var current: Job? = null
  private val queue = ConcurrentLinkedDeque<Job>()
  @Volatile private var workerAlive = false
  private var stopRequested = false
  private var wakeLock: PowerManager.WakeLock? = null

  /** 原生任务是否已进入解码/推理阶段（此时忽略 JS 转发的下载进度，避免通知回退） */
  @Volatile private var nativeStageActive = false

  private val mainHandler = Handler(Looper.getMainLooper())
  private val idleStopRunnable = Runnable { shutdownIfIdle() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    createChannel()
    cleanupStaleArtifacts()
    acquireWakeLock()
  }

  override fun onDestroy() {
    mainHandler.removeCallbacks(idleStopRunnable)
    releaseWakeLock()
    instance = null
    super.onDestroy()
  }

  /**
   * 清理上次进程被系统杀死后残留的半成品：
   *  - .work-* 临时解码目录（f32 声道文件）
   *  - 各 songId 目录下未 rename 的 *.tmp（分离成功后才会改名为 .f32）
   * 这些残留若不清，既占空间，也可能让"是否已分离"的判断出现脏数据。
   */
  private fun cleanupStaleArtifacts() {
    try {
      val root = File(filesDir, "vocalsep")
      root.listFiles()?.forEach { f ->
        if (f.isDirectory && f.name.startsWith(".work-")) f.deleteRecursively()
      }
      root.walkTopDown()
        .filter { it.isFile && it.name.endsWith(".tmp") }
        .forEach { runCatching { it.delete() } }
    } catch (_: Throwable) { /* 清理失败不影响主流程 */ }
  }

  /**
   * 持有 PARTIAL_WAKE_LOCK：锁屏/灭屏后阻止 CPU 进入 Doze 深度休眠，
   * 保证后台推理线程持续跑（否则灭屏后 CPU 降频/挂起，分离会被拖慢甚至冻结，
   * 亮屏回来看起来像"重新开始"）。带 1 小时超时兜底，防止异常路径永久持锁。
   * 每次入队/保活时重新计时，连续分离多首歌也不会中途失效。
   */
  private fun acquireWakeLock() {
    try {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock?.takeIf { it.isHeld }?.release()
      val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lxmusic:vocalsep")
      wl.setReferenceCounted(false)
      wl.acquire(WAKELOCK_TIMEOUT_MS)
      wakeLock = wl
    } catch (_: Throwable) { /* 部分机型限制，忽略 */ }
  }

  private fun releaseWakeLock() {
    try {
      wakeLock?.takeIf { it.isHeld }?.release()
    } catch (_: Throwable) { /* 忽略 */ }
    wakeLock = null
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_WARMUP -> handleWarmup()
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

  /** JS 下载阶段的保活：前台通知 + WakeLock，无任务时空转等待，空闲超时后自动停 */
  private fun handleWarmup() {
    acquireWakeLock()
    renderNotification(0, "正在准备…", true)
    synchronized(lock) {
      stopRequested = false
      lock.notifyAll()
    }
    mainHandler.removeCallbacks(idleStopRunnable)
    // 没有 worker/任务时，超时内没等到实际任务就退出（JS 下载失败/用户放弃的兜底）
    if (!workerAlive && queue.isEmpty() && current == null) {
      mainHandler.postDelayed(idleStopRunnable, IDLE_STOP_DELAY_MS)
    }
  }

  /**
   * 新任务入队：
   *  - 与当前任务同歌且正在跑：忽略重复
   *  - 已在队列中：忽略重复
   *  - 否则插到队首（用户最新想听的优先），队列超员丢弃队尾最老任务
   *  - 不打断正在执行的任务（关键：切歌后旧歌继续分离完，缓存不浪费）
   */
  private fun enqueue(job: Job) {
    acquireWakeLock()

    var enqueued = false
    synchronized(lock) {
      stopRequested = false
      val cur = current
      if (cur != null && cur.songId == job.songId && !cur.cancelled.get()) return // 同歌进行中
      if (queue.any { it.songId == job.songId }) return // 已在排队
      queue.addFirst(job)
      while (queue.size > MAX_QUEUE) {
        val dropped = queue.pollLast()
        if (dropped != null && dropped.songId != job.songId) {
          emit(dropped.songId, "cancelled", 0.0, "已取消")
        }
      }
      // 通知排队任务它在等
      if (workerAlive && cur != null && cur.songId != job.songId) {
        emit(job.songId, "queued", 0.0, "排队中，前方 1 首…")
      }
      if (!workerAlive) {
        workerAlive = true
        Thread({ workerLoop() }, "VocalSepWorker").start()
      } else {
        lock.notifyAll()
      }
      enqueued = true
    }
    if (!enqueued) return
    mainHandler.removeCallbacks(idleStopRunnable)
    // 尽快进入前台（startForegroundService 后 5s 内必须 startForeground）；
    // 放在去重之后，避免重复请求用"正在准备 0%"覆盖正在显示的推理进度
    renderNotification(0, "正在准备…", true)
  }

  private fun cancelAll() {
    val wasIdle: Boolean
    synchronized(lock) {
      current?.cancelled?.set(true)
      queue.forEach { emit(it.songId, "cancelled", 0.0, "已取消") }
      queue.clear()
      stopRequested = true
      wasIdle = !workerAlive
      lock.notifyAll()
    }
    mainHandler.removeCallbacks(idleStopRunnable)
    if (wasIdle) shutdownNow()
  }

  private fun workerLoop() {
    // 提权：前台优先级，EAS 调度器提升 uclamp，优先派发大核
    Process.setThreadPriority(Process.THREAD_PRIORITY_FOREGROUND)
    while (true) {
      // workerAlive 的置位/清位都在锁内完成，与 enqueue 互斥，
      // 杜绝"worker 超时退出的瞬间新任务入队、没人消费"的竞态
      val job = synchronized(lock) {
        while (queue.isEmpty()) lock.wait(10_000)
        val j = queue.pollFirst()
        if (j != null) {
          current = j
        } else {
          workerAlive = false
        }
        j
      } ?: break

      if (job.cancelled.get()) {
        emit(job.songId, "cancelled", 0.0, "已取消")
      } else {
        runJob(job)
      }

      val next = synchronized(lock) {
        current = null
        when {
          queue.isNotEmpty() -> 0 // 还有任务，继续跑
          stopRequested -> 1 // 用户取消，立即停
          else -> {
            workerAlive = false
            2 // 正常空闲，延迟停止（留给 JS 下载间隙的 warmup 窗口）
          }
        }
      }
      if (next == 0) continue
      if (next == 1) {
        shutdownNow()
        break
      }
      mainHandler.postDelayed(idleStopRunnable, IDLE_STOP_DELAY_MS)
      break
    }
  }

  /** 空闲自动停止的二次检查（这期间可能又来了新任务） */
  private fun shutdownIfIdle() {
    synchronized(lock) {
      if (workerAlive || queue.isNotEmpty() || current != null) return
    }
    shutdownNow()
  }

  private fun shutdownNow() {
    mainHandler.removeCallbacks(idleStopRunnable)
    releaseWakeLock()
    try {
      stopForeground(true)
    } catch (_: Throwable) { /* 忽略 */ }
    stopSelf()
  }

  private fun emit(songId: String, status: String, fraction: Double, message: String?) {
    eventListener?.invoke(songId, status, fraction, message)
  }

  private fun runJob(job: Job) {
    var engine: DemucsSeparator? = null
    try {
      nativeStageActive = true
      val outDir = File(filesDir, "vocalsep/${job.songId}")
      // 缓存版本校验：旧版本曾产出全静音 WAV / 随机 id 垃圾缓存，升级后作废重算。
      val sepRoot = File(filesDir, "vocalsep")
      val verFile = File(sepRoot, ".cachever")
      if (verFile.takeIf { it.exists() }?.readText() != CACHE_VERSION) {
        sepRoot.listFiles()?.forEach { it.deleteRecursively() }
        sepRoot.mkdirs()
        verFile.writeText(CACHE_VERSION)
      }
      val v = File(outDir, "vocals.wav")
      val a = File(outDir, "accompaniment.wav")
      if (v.exists() && a.exists()) {
        renderNotification(100, "已完成", false)
        emit(job.songId, "done", 1.0, "已缓存")
        return
      }
      outDir.mkdirs()
      val workDir = File(cacheDir, "vocalsep_work/${job.songId}")
      workDir.mkdirs()

      emit(job.songId, "decoding", 0.0, "正在解码音频…")
      renderNotification(0, "正在解码音频…", true)
      val decoder = AudioDecoder()
      val decoded = decoder.decode(job.audioPath, workDir)
      if (job.cancelled.get()) throw SeparationCancelledException()

      // 解码静音自检：样本数正常但峰值≈0，说明 MediaCodec 没解出有效音频
      // （常见于下载到的并非真实音频/加密流/位深不支持）。直接把完整格式信息抛给 UI。
      if (decoded.writtenPeak < 1e-5f) {
        throw RuntimeException(
          "解码结果静音(峰值=${"%.6f".format(decoded.writtenPeak)})：" +
            "格式=${decoded.mime}, ${decoded.srcRate}Hz, ${decoded.channels}声道, " +
            "pcm=${decoded.pcmEncoding}, 重采样=${decoded.resamplerUsed}, " +
            "原始峰值=${"%.4f".format(decoded.rawDecodedPeak)}, " +
            "文件=${File(job.audioPath).length()}字节",
        )
      }

      emit(job.songId, "inferring", 0.0, "正在分离人声…")
      var backendTag = ""
      engine = DemucsSeparator(job.modelPath, job.ep) { fraction, _ ->
        if (job.cancelled.get()) engine?.cancelled = true
        val pct = (fraction * 100).toInt().coerceIn(0, 100)
        emit(job.songId, "inferring", fraction, "正在分离人声… $pct%$backendTag")
        // 每 2% 刷一次通知；起点/终点必刷
        if (pct <= 1 || pct >= 99 || pct % 2 == 0) {
          renderNotification(pct, "AI 分离中 $pct%$backendTag", false)
        }
      }
      engine.open()
      // 会话创建后实际后端/线程数才确定；透传到进度文案，真机上即可确认 XNNPACK 是否生效
      backendTag = " · ${engine.backendInfo}"
      emit(job.songId, "inferring", 0.0, "正在分离人声… 0%$backendTag")
      renderNotification(0, "AI 分离中 0%$backendTag", false)
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
        renderNotification(100, "分离完成", false)
        emit(job.songId, "done", 1.0, "分离完成")
      }
    } catch (t: Throwable) {
      if (t is SeparationCancelledException || job.cancelled.get()) {
        emit(job.songId, "cancelled", 0.0, "已取消")
      } else {
        emit(job.songId, "error", 0.0, t.message ?: t.javaClass.simpleName)
      }
    } finally {
      nativeStageActive = false
    }
  }

  /** JS 下载阶段进度 → 通知栏（原生解码/推理进行中则忽略，避免进度文案回退） */
  private fun showExternalProgress(stage: String, fraction: Double, message: String?) {
    if (nativeStageActive || workerAlive) return
    val pct = (fraction * 100).toInt().coerceIn(0, 99)
    val text = when (stage) {
      "downloading-model" -> "正在下载分离模型… $pct%"
      "downloading-audio" -> "正在获取音频… $pct%"
      else -> message ?: "正在准备…"
    }
    renderNotification(pct, text, pct <= 0)
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

  private fun buildNotification(pct: Int, text: String, indeterminate: Boolean): Notification {
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
      .setOnlyAlertOnce(true)
      .setProgress(100, pct, indeterminate)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "取消", cancelPi)
      .build()
  }

  /**
   * 渲染/更新前台通知。
   * 前台服务存活期间重复调用 startForeground 是官方支持的通知更新方式，
   * 比单独 NotificationManager.notify 更可靠（不受通知权限/厂商 ROM 冻结影响）；
   * 若 startForeground 因系统限制失败，再退回 notify。
   */
  private fun renderNotification(pct: Int, text: String, indeterminate: Boolean) {
    val n = buildNotification(pct.coerceIn(0, 100), text, indeterminate)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIF_ID, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIF_ID, n)
      }
    } catch (_: Throwable) {
      try {
        val mgr = getSystemService(NotificationManager::class.java)
        mgr.notify(NOTIF_ID, n)
      } catch (_: Exception) { /* 渠道未就绪等 */ }
    }
  }
}
