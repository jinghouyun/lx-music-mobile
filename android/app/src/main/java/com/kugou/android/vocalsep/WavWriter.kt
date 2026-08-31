package com.kugou.android.vocalsep

import java.io.File
import java.io.RandomAccessFile

/**
 * 流式 WAV 写入器（PCM 16-bit 立体声 44.1kHz）。
 * 先写 44 字节占位头，PCM 数据边算边写，close 时回填数据长度。
 */
class WavWriter(private val file: File) {
  private var raf: RandomAccessFile? = null
  private var dataBytes = 0L

  fun open() {
    file.parentFile?.mkdirs()
    if (file.exists()) file.delete()
    val r = RandomAccessFile(file, "rw")
    val header = ByteArray(44)
    r.write(header) // 占位，close 时回填
    raf = r
  }

  fun write(pcm: ByteArray) {
    raf?.write(pcm)
    dataBytes += pcm.size
  }

  /** 写入复用缓冲的前 [len] 字节 */
  fun write(pcm: ByteArray, len: Int) {
    raf?.write(pcm, 0, len)
    dataBytes += len
  }

  fun close() {
    val r = raf ?: return
    r.seek(0)
    val sampleRate = DemucsSeparator.SAMPLE_RATE
    val channels = 2
    val byteRate = sampleRate * channels * 2
    val blockAlign = channels * 2
    val totalDataLen = dataBytes
    val totalLen = 36 + totalDataLen

    r.writeBytes("RIFF")
    r.write(intLE(totalLen.toInt()))
    r.writeBytes("WAVE")
    r.writeBytes("fmt ")
    r.write(intLE(16)) // PCM fmt chunk size
    r.write(shortLE(1)) // PCM format
    r.write(shortLE(channels))
    r.write(intLE(sampleRate))
    r.write(intLE(byteRate))
    r.write(shortLE(blockAlign))
    r.write(shortLE(16)) // bits per sample
    r.writeBytes("data")
    r.write(intLE(totalDataLen.toInt()))
    r.close()
    raf = null
  }

  private fun intLE(v: Int): ByteArray =
    byteArrayOf(
      (v and 0xff).toByte(),
      ((v shr 8) and 0xff).toByte(),
      ((v shr 16) and 0xff).toByte(),
      ((v shr 24) and 0xff).toByte(),
    )

  private fun shortLE(v: Int): ByteArray =
    byteArrayOf((v and 0xff).toByte(), ((v shr 8) and 0xff).toByte())
}
