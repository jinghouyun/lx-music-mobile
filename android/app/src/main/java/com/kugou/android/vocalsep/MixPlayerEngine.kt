package com.kugou.android.vocalsep

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import java.io.File
import java.io.RandomAccessFile
import java.nio.ShortBuffer
import kotlin.math.max
import kotlin.math.min

/**
 * 双轨实时混音播放器（纯 Kotlin，单个 AudioTrack 输出，保证双轨采样级同步）。
 *
 * 输入：分离阶段产出的 vocals.wav / accompaniment.wav（44.1kHz 立体声 s16）。
 * 两路 WAV 用内存映射读取（不占堆内存，OS 页缓存管理）。
 *
 * 混音规则（与 QQ 音乐一致）：
 *  - 伴奏模式：out = 伴奏*1.0 + 人声*(1-strength)，strength 0..1 实时可调
 *  - 人声模式：out = 人声*1.0
 *
 * 时钟同步：由 JS 侧定时把 TrackPlayer 的进度通过 syncTo() 喂入，
 * 本引擎据此自动追赶/等待，因此进度条、seek、切歌全部以 TrackPlayer 为准。
 */
class MixPlayerEngine {

  companion object {
    const val MODE_OFF = 0
    const val MODE_ACCOMPANIMENT = 1 // 伴奏
    const val MODE_VOCALS = 2        // 纯人声
    private const val SAMPLE_RATE = 44100
    private const val CHANNELS = 2
    private const val BUFFER_FRAMES = 2048
  }

  @Volatile private var mode = MODE_OFF
  @Volatile private var strength = 1.0f // 去人声强度 0..1

  private var audioTrack: AudioTrack? = null
  private var playThread: Thread? = null

  @Volatile private var running = false
  @Volatile private var paused = true
  private val pauseLock = Object()

  // mmap 的两路音轨数据（data chunk 起点）
  private var vocalsBuf: ShortBuffer? = null
  private var accBuf: ShortBuffer? = null
  private var totalFrames = 0L
  private var dataOffset = 0L
  private val openFiles = mutableListOf<RandomAccessFile>()

  // 位置记账：seek/flush 后 baseFrame = 起始帧，AudioTrack head 从 0 重新计
  @Volatile private var baseFrame = 0L
  @Volatile private var ended = false

  var onEnded: (() -> Unit)? = null
  var onError: ((String) -> Unit)? = null

  private fun parseWav(raf: RandomAccessFile): Pair<Long, Long> {
    // 返回 (dataChunkOffset, dataBytes)；校验采样率/声道/位深
    val buf = ByteArray(12)
    raf.readFully(buf)
    require(String(buf, 0, 4) == "RIFF") { "不是 WAV 文件" }
    require(String(buf, 8, 4) == "WAVE") { "不是 WAV 文件" }
    var sampleRate = 0
    var channels = 0
    var bits = 0
    var dataOffset = -1L
    var dataLen = 0L
    val hdr = ByteArray(8)
    while (true) {
      val n = raf.read(hdr)
      if (n < 8) break
      val id = String(hdr, 0, 4)
      val size = ((hdr[4].toLong() and 0xff)) or
        ((hdr[5].toLong() and 0xff) shl 8) or
        ((hdr[6].toLong() and 0xff) shl 16) or
        ((hdr[7].toLong() and 0xff) shl 24)
      val pos = raf.filePointer
      when (id) {
        "fmt " -> {
          val fmt = ByteArray(size.toInt().coerceAtMost(40))
          raf.readFully(fmt)
          channels = (fmt[2].toInt() and 0xff) or ((fmt[3].toInt() and 0xff) shl 8)
          sampleRate = (fmt[4].toInt() and 0xff) or
            ((fmt[5].toInt() and 0xff) shl 8) or
            ((fmt[6].toInt() and 0xff) shl 16) or
            ((fmt[7].toInt() and 0xff) shl 24)
          bits = (fmt[14].toInt() and 0xff) or ((fmt[15].toInt() and 0xff) shl 8)
        }
        "data" -> {
          dataOffset = pos
          dataLen = size
        }
      }
      raf.seek(pos + size + (if (size % 2 != 0L) 1 else 0))
      if (dataOffset >= 0) break
    }
    require(dataOffset >= 0) { "WAV 缺少 data chunk" }
    require(sampleRate == SAMPLE_RATE && channels == CHANNELS && bits == 16) {
      "WAV 格式不符：${sampleRate}Hz ${channels}ch ${bits}bit"
    }
    return Pair(dataOffset, dataLen)
  }

  /** 加载双轨并创建 AudioTrack（不开始播放） */
  @Synchronized
  fun prepare(vocalsPath: String, accPath: String) {
    stop()
    try {
      val vFile = File(vocalsPath)
      val aFile = File(accPath)
      require(vFile.exists() && aFile.exists()) { "音轨文件不存在" }

      val vRaf = RandomAccessFile(vFile, "r")
      val aRaf = RandomAccessFile(aFile, "r")
      openFiles.add(vRaf); openFiles.add(aRaf)
      val (vOff, vLen) = parseWav(vRaf)
      val (aOff, aLen) = parseWav(aRaf)

      val vCh = vRaf.channel.map(java.nio.channels.FileChannel.MapMode.READ_ONLY, vOff, vLen)
      val aCh = aRaf.channel.map(java.nio.channels.FileChannel.MapMode.READ_ONLY, aOff, aLen)
      vocalsBuf = vCh.asShortBuffer()
      accBuf = aCh.asShortBuffer()
      totalFrames = min(vLen, aLen) / (CHANNELS * 2)
      dataOffset = 0
      baseFrame = 0
      ended = false

      val minBuf = AudioTrack.getMinBufferSize(
        SAMPLE_RATE,
        AudioFormat.CHANNEL_OUT_STEREO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
      val track = AudioTrack(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build(),
        AudioFormat.Builder()
          .setSampleRate(SAMPLE_RATE)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
          .build(),
        max(minBuf, BUFFER_FRAMES * CHANNELS * 2 * 2),
        AudioTrack.MODE_STREAM,
        AudioManager.AUDIO_SESSION_ID_GENERATE,
      )
      audioTrack = track
    } catch (t: Throwable) {
      stop()
      throw t
    }
  }

  /** 从 startMs 开始播放（模式与强度由 setMode/setStrength 预先设置） */
  @Synchronized
  fun play(startMs: Long = 0) {
    val track = audioTrack ?: throw IllegalStateException("未 prepare")
    baseFrame = (startMs * SAMPLE_RATE / 1000).coerceAtLeast(0)
    ended = false
    if (baseFrame >= totalFrames) {
      onEnded?.invoke()
      return
    }
    running = true
    paused = false
    track.flush()
    track.play()
    playThread = Thread({ renderLoop() }, "VocalMixPlayer").also { it.start() }
  }

  private fun renderLoop() {
    val track = audioTrack ?: return
    val vBuf = vocalsBuf!!
    val aBuf = accBuf!!
    val mix = ShortArray(BUFFER_FRAMES * CHANNELS)
    val vChunk = ShortArray(BUFFER_FRAMES * CHANNELS)
    val aChunk = ShortArray(BUFFER_FRAMES * CHANNELS)

    try {
      while (running) {
        synchronized(pauseLock) {
          while (paused && running) pauseLock.wait(1000)
        }
        if (!running) break

        val played = baseFrame + track.playbackHeadPosition.toLong()
        if (played >= totalFrames) {
          ended = true
          onEnded?.invoke()
          break
        }

        // 本次要填充的帧区间
        val writeStart = baseFrame + track.playbackHeadPosition.toLong()
        var frames = min(BUFFER_FRAMES.toLong(), totalFrames - writeStart).toInt()
        if (frames <= 0) continue

        // 读两路（短于请求则补零）
        readStem(vBuf, writeStart, frames, vChunk)
        readStem(aBuf, writeStart, frames, aChunk)

        val m = mode
        val s = strength
        for (i in 0 until frames * CHANNELS) {
          val v = vChunk[i].toInt()
          val a = aChunk[i].toInt()
          var out = when (m) {
            MODE_ACCOMPANIMENT -> a + (v * (1f - s)).toInt()
            MODE_VOCALS -> v
            else -> a + v // MODE_OFF 不应到这里，兜底全混音
          }
          if (out > 32767) out = 32767
          if (out < -32768) out = -32768
          mix[i] = out.toShort()
        }

        var offset = 0
        val totalShorts = frames * CHANNELS
        while (offset < totalShorts && running) {
          val w = track.write(mix, offset, totalShorts - offset)
          if (w <= 0) break
          offset += w
        }
      }
    } catch (t: Throwable) {
      onError?.invoke(t.message ?: t.javaClass.simpleName)
    }
  }

  private fun readStem(buf: ShortBuffer, startFrame: Long, frames: Int, out: ShortArray) {
    val startSample = (startFrame * CHANNELS).toInt()
    val samples = frames * CHANNELS
    java.util.Arrays.fill(out, 0, samples, 0)
    if (startFrame >= totalFrames) return
    synchronized(buf) {
      val pos = buf.position()
      buf.position(startSample.coerceAtMost(buf.limit()))
      val canRead = min(samples, buf.limit() - buf.position())
      if (canRead > 0) buf.get(out, 0, canRead)
      buf.position(pos)
    }
  }

  fun setMode(newMode: Int) {
    mode = newMode
  }

  /** strength: 0=人声全响（≈原唱） 1=纯伴奏 */
  fun setStrength(value: Float) {
    strength = value.coerceIn(0f, 1f)
  }

  fun pause() {
    paused = true
    audioTrack?.pause()
  }

  fun resumePlayback() {
    val track = audioTrack ?: return
    synchronized(pauseLock) {
      paused = false
      if (running) track.play()
      pauseLock.notifyAll()
    }
  }

  /** 跳转到指定毫秒（内部用） */
  @Synchronized
  fun seekTo(ms: Long) {
    val track = audioTrack ?: return
    val frame = (ms * SAMPLE_RATE / 1000).coerceIn(0, max(0, totalFrames - 1))
    baseFrame = frame
    track.pause()
    track.flush()
    if (!paused) track.play()
  }

  /**
   * 时钟同步：JS 定时喂入 TrackPlayer 的播放位置（毫秒）。
   *  - 本引擎落后 >300ms：跳转追赶
   *  - 本引擎超前 >600ms（TrackPlayer 缓冲/卡顿）：暂停等待
   *  - 窗口内：保持播放
   */
  fun syncTo(targetMs: Long, isPlaying: Boolean) {
    if (!running || audioTrack == null) return
    val targetFrame = targetMs * SAMPLE_RATE / 1000
    val played = baseFrame + (audioTrack?.playbackHeadPosition?.toLong() ?: 0)
    val delta = targetFrame - played
    val behindMs = delta * 1000 / SAMPLE_RATE
    val aheadMs = -delta * 1000 / SAMPLE_RATE

    if (!isPlaying) {
      if (!paused) pause()
      return
    }
    if (behindMs > 300) {
      seekTo(targetMs)
      if (paused) resumePlayback()
    } else if (aheadMs > 600) {
      if (!paused) pause()
    } else {
      if (paused) resumePlayback()
    }
  }

  fun getPositionMs(): Long {
    val track = audioTrack ?: return 0
    return (baseFrame + track.playbackHeadPosition.toLong()) * 1000 / SAMPLE_RATE
  }

  fun getDurationMs(): Long = totalFrames * 1000 / SAMPLE_RATE

  fun isMixing(): Boolean = running && !paused

  @Synchronized
  fun stop() {
    running = false
    paused = false
    synchronized(pauseLock) { pauseLock.notifyAll() }
    playThread?.let { it.interrupt(); try { it.join(500) } catch (_: Exception) {} }
    playThread = null
    try { audioTrack?.pause(); audioTrack?.flush(); audioTrack?.stop() } catch (_: Exception) {}
    try { audioTrack?.release() } catch (_: Exception) {}
    audioTrack = null
    vocalsBuf = null
    accBuf = null
    synchronized(openFiles) {
      openFiles.forEach { try { it.close() } catch (_: Exception) {} }
      openFiles.clear()
    }
  }
}
