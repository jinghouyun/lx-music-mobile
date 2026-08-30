package com.kugou.android.vocalsep

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * 音频硬解 + 重采样。
 *
 * 输出：两个平面 Float32 LE 临时文件（ch0 / ch1），采样率 44100Hz、立体声。
 * 全流程流式处理，固定内存占用。
 */
class AudioDecoder {

  data class Result(
    val ch0File: File,
    val ch1File: File,
    val samples: Long, // 每声道样本数
    val srcRate: Int,
  )

  fun decode(audioPath: String, workDir: File): Result {
    val extractor = MediaExtractor()
    extractor.setDataSource(audioPath)

    var trackIndex = -1
    var srcFormat: MediaFormat? = null
    for (i in 0 until extractor.trackCount) {
      val fmt = extractor.getTrackFormat(i)
      val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith("audio/")) {
        trackIndex = i
        srcFormat = fmt
        break
      }
    }
    if (trackIndex < 0 || srcFormat == null) {
      throw RuntimeException("未找到音频轨：$audioPath")
    }
    extractor.selectTrack(trackIndex)

    val mime = srcFormat.getString(MediaFormat.KEY_MIME)!!
    val codec = MediaCodec.createDecoderByType(mime)
    codec.configure(srcFormat, null, null, 0)
    codec.start()

    val info = MediaCodec.BufferInfo()
    var sawInputEos = false
    var sawOutputEos = false
    var pcmEncoding = android.media.AudioFormat.ENCODING_PCM_16BIT
    var channelCount = 2
    var sampleRate = 44100

    var resampler0: SincResampler? = null
    var resampler1: SincResampler? = null

    workDir.mkdirs()
    val ch0File = File(workDir, "mix.0.f32")
    val ch1File = File(workDir, "mix.1.f32")
    val out0 = FileOutputStream(ch0File)
    val out1 = FileOutputStream(ch1File)

    var totalInputSamples = 0L
    var totalOutSamples = 0L

    fun pushResampled(r0: SincResampler?, r1: SincResampler?, flush: Boolean) {
      if (r0 != null && r1 != null) {
        val a = r0.read(flush)
        val b = r1.read(flush)
        val n = minOf(a.size, b.size)
        writePlanar(out0, a, n)
        writePlanar(out1, b, n)
        totalOutSamples += n
      }
    }

    while (!sawOutputEos) {
      if (!sawInputEos) {
        val inIndex = codec.dequeueInputBuffer(10_000)
        if (inIndex >= 0) {
          val inputBuffer = codec.getInputBuffer(inIndex)!!
          inputBuffer.clear()
          val sampleSize = extractor.readSampleData(inputBuffer, 0)
          if (sampleSize < 0) {
            codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            sawInputEos = true
          } else {
            val pts = extractor.sampleTime
            codec.queueInputBuffer(inIndex, 0, sampleSize, pts, 0)
            extractor.advance()
          }
        }
      }

      val outIndex = codec.dequeueOutputBuffer(info, 10_000)
      if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        val fmt = codec.outputFormat
        sampleRate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        channelCount = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && fmt.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
          pcmEncoding = fmt.getInteger(MediaFormat.KEY_PCM_ENCODING)
        }
        if (sampleRate != TARGET_RATE) {
          resampler0 = SincResampler(sampleRate, TARGET_RATE)
          resampler1 = SincResampler(sampleRate, TARGET_RATE)
        }
      } else if (outIndex >= 0) {
        val buf = codec.getOutputBuffer(outIndex)
        if (buf != null && info.size > 0) {
          buf.position(info.offset)
          buf.limit(info.offset + info.size)

          // 解码为每声道 float
          val frames: Int = when (pcmEncoding) {
            android.media.AudioFormat.ENCODING_PCM_FLOAT -> info.size / 4 / channelCount
            else -> info.size / 2 / channelCount // 16-bit
          }
          val f0 = FloatArray(frames)
          val f1 = FloatArray(frames)
          when (pcmEncoding) {
            android.media.AudioFormat.ENCODING_PCM_FLOAT -> {
              val fb = buf.order(ByteOrder.nativeOrder()).asFloatBuffer()
              for (i in 0 until frames) {
                val l: Float
                val r: Float
                if (channelCount == 1) {
                  l = fb.get(); r = l
                } else {
                  l = fb.get(i * channelCount)
                  r = fb.get(i * channelCount + 1)
                }
                f0[i] = l; f1[i] = r
              }
            }
            else -> {
              val sb = buf.order(ByteOrder.nativeOrder()).asShortBuffer()
              for (i in 0 until frames) {
                val l: Short
                val r: Short
                if (channelCount == 1) {
                  l = sb.get(); r = l
                } else {
                  l = sb.get(i * channelCount)
                  r = sb.get(i * channelCount + 1)
                }
                f0[i] = l / 32768f
                f1[i] = r / 32768f
              }
            }
          }
          totalInputSamples += frames

          if (resampler0 != null) {
            resampler0.feed(f0, 0, frames)
            resampler1!!.feed(f1, 0, frames)
            pushResampled(resampler0, resampler1, false)
          } else {
            writePlanar(out0, f0, frames)
            writePlanar(out1, f1, frames)
            totalOutSamples += frames
          }
        }
        codec.releaseOutputBuffer(outIndex, false)
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
          sawOutputEos = true
        }
      }
    }

    if (resampler0 != null) {
      resampler0.endInput(totalInputSamples)
      resampler1!!.endInput(totalInputSamples)
      pushResampled(resampler0, resampler1, true)
    }

    out0.close()
    out1.close()
    codec.stop()
    codec.release()
    extractor.release()

    if (totalOutSamples <= 0) {
      throw RuntimeException("音频解码失败：无有效 PCM 数据")
    }
    return Result(ch0File, ch1File, totalOutSamples, sampleRate)
  }

  private fun writePlanar(out: FileOutputStream, floats: FloatArray, len: Int) {
    val bytes = ByteBuffer.allocate(len * 4).order(ByteOrder.LITTLE_ENDIAN)
    bytes.asFloatBuffer().put(floats, 0, len)
    out.write(bytes.array())
  }

  companion object {
    const val TARGET_RATE = 44100
  }
}
