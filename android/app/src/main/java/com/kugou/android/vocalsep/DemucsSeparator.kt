package com.kugou.android.vocalsep

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.Collections

/**
 * htdemucs 推理引擎（ONNX Runtime Java API）。
 *
 * 模型输入 "mix"：(1, 2, 343980) float32，7.8s/块 @44.1kHz
 * 模型输出 "stems"：(1, 4, 2, 343980)，stem 顺序 drums/bass/other/vocals
 *
 * 分块：overlap = N/4，三角窗加权 overlap-add；流式产出（每块推理完即可
 * 写出已确定的 stride 个样本），内存占用固定（约 20MB），与歌曲长度无关。
 *
 * 输出两轨 WAV（44.1k 立体声 s16）：
 *  - vocals.wav     = 第 4 个 stem（人声）
 *  - accompaniment.wav = drums+bass+other 求和（伴奏）
 */
class DemucsSeparator(
  private val modelPath: String,
  private val ep: String, // "xnnpack" | "nnapi" | "cpu"
  private val onProgress: (fraction: Double, stage: String) -> Unit,
) {
  companion object {
    const val SAMPLE_RATE = 44100
    const val CHANNELS = 2
    const val SEGMENT_S = 7.8
    val N_SAMPLES = (SEGMENT_S * SAMPLE_RATE).toInt() // 343980
    val OVERLAP = N_SAMPLES / 4                        // 85995
    val STRIDE = N_SAMPLES - OVERLAP                   // 257985
  }

  /** 用户/切歌取消标志：分块之间检查，取消后尽快退出并清理临时文件 */
  @Volatile
  var cancelled = false

  private lateinit var env: OrtEnvironment
  private lateinit var session: OrtSession
  private var actualEp = "cpu"

  private val window = FloatArray(N_SAMPLES)

  init {
    // 三角/线性淡入淡出窗（与官方 infer.py 一致）
    for (i in 0 until OVERLAP) {
      val f = (i + 1).toFloat() / (OVERLAP + 1)
      window[i] = f
      window[N_SAMPLES - 1 - i] = f
    }
    for (i in OVERLAP until N_SAMPLES - OVERLAP) window[i] = 1f
  }

  fun open() {
    env = OrtEnvironment.getEnvironment()
    val opts = OrtSession.SessionOptions()
    // 必须用 NO_OPT：实测 fp16 模型在 BASIC/ALL 图优化阶段会因 Cast 折叠产生
    // 3GB+ 内存峰值（x86 实测 BASIC 峰值 3.3GB，NO_OPT 仅 0.39GB），低端机
    // 会被系统直接杀掉。NO_OPT 下 XNNPACK/NNAPI EP 仍按算子正常接管。
    opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.NO_OPT)
    val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
    opts.setIntraOpNumThreads(threads)

    actualEp = setupEp(opts)
    session = env.createSession(modelPath, opts)
  }

  private fun setupEp(opts: OrtSession.SessionOptions): String {
    // 优先用户指定，失败按 xnnpack -> cpu 回退
    val order = when (ep) {
      "nnapi" -> listOf("nnapi", "xnnpack", "cpu")
      "cpu" -> listOf("cpu")
      else -> listOf("xnnpack", "nnapi", "cpu")
    }
    for (name in order) {
      try {
        when (name) {
          // ORT 1.21 Java 的 addXnnpack 接受 EP 选项 Map；线程数由 setIntraOpNumThreads 控制
          "xnnpack" -> opts.addXnnpack(emptyMap())
          "nnapi" -> tryEnableNnapi(opts)
          "cpu" -> { /* 默认 */ }
        }
        return name
      } catch (t: Throwable) {
        // 该 EP 不可用，尝试下一个
      }
    }
    return "cpu"
  }

  private fun tryEnableNnapi(opts: OrtSession.SessionOptions) {
    // ORT 1.21: addNnapi() 默认 flags=0（fp32、不支持的算子自动回退 CPU）。
    // 仅在 API 27+ 有 NNAPI；低版本创建会话时会抛异常，由 setupEp 回退。
    opts.addNnapi()
  }

  fun close() {
    if (::session.isInitialized) session.close()
  }

  /**
   * 执行分离。
   * @param ch0File / ch1File 平面 f32 LE 临时文件（每声道）
   * @param totalSamples 每声道样本数
   * @param outDir 输出目录
   * @return Pair(vocalsWav, accompanimentWav)
   */
  fun separate(ch0File: File, ch1File: File, totalSamples: Long, outDir: File): Pair<File, File> {
    val raf0 = RandomAccessFile(ch0File, "r")
    val raf1 = RandomAccessFile(ch1File, "r")

    val tmpVocals = File(outDir, "vocals.wav.tmp")
    val tmpAcc = File(outDir, "accompaniment.wav.tmp")
    val wavV = WavWriter(tmpVocals)
    val wavA = WavWriter(tmpAcc)
    wavV.open()
    wavA.open()

    try {
      // 流式 OLA 累加缓冲
      val accV0 = FloatArray(N_SAMPLES)
      val accV1 = FloatArray(N_SAMPLES)
      val accA0 = FloatArray(N_SAMPLES)
      val accA1 = FloatArray(N_SAMPLES)
      val wacc = FloatArray(N_SAMPLES)

      val nChunks = maxOf(1, ((totalSamples + STRIDE - 1) / STRIDE).toInt())
      var flushed = 0L

      // 复用的输入/输出缓冲（整个分离过程只分配一次，内存峰值与歌曲长度无关）
      val inBytes = ByteBuffer.allocateDirect(2 * N_SAMPLES * 4).order(ByteOrder.nativeOrder())
      val chunkCh = FloatArray(N_SAMPLES)
      // 读盘缓冲：readChannel 复用，避免每块每声道分配 1.4MB
      val readBuf = ByteBuffer.allocate(N_SAMPLES * 4).order(ByteOrder.LITTLE_ENDIAN)
      val readTmp = ByteArray(N_SAMPLES * 4)
      // s16 输出缓冲：vocals/acc 各写一次，最大 N_SAMPLES*2ch*2B
      val s16Buf = ByteArray(N_SAMPLES * CHANNELS * 2)

      for (i in 0 until nChunks) {
        if (cancelled) throw SeparationCancelledException()
        val start = i.toLong() * STRIDE
      val end = minOf(start + N_SAMPLES, totalSamples)
      val clen = (end - start).toInt()

      inBytes.clear()
      val inFb = inBytes.asFloatBuffer()
      readChannel(raf0, start, clen, chunkCh, readBuf, readTmp)
      inFb.put(chunkCh, 0, N_SAMPLES)
      readChannel(raf1, start, clen, chunkCh, readBuf, readTmp)
      inFb.put(chunkCh, 0, N_SAMPLES)
      inFb.flip()

      val inputTensor = OnnxTensor.createTensor(env, inFb, longArrayOf(1, 2, N_SAMPLES.toLong()))
      val output = session.run(Collections.singletonMap("mix", inputTensor))
      inputTensor.close()

      output.use { res ->
        val stemsTensor = res.get("stems").orElseThrow {
          RuntimeException("模型输出中找不到 stems")
        } as OnnxTensor
        val sb: FloatBuffer = stemsTensor.floatBuffer
        // 布局 (1,4,2,N)：index = ((stem*2 + ch)*N + s)
        for (s in 0 until N_SAMPLES) {
          val w = window[s]
          val d0 = sb.get((0 * 2) * N_SAMPLES + s)
          val d1 = sb.get((0 * 2 + 1) * N_SAMPLES + s)
          val b0 = sb.get((1 * 2) * N_SAMPLES + s)
          val b1 = sb.get((1 * 2 + 1) * N_SAMPLES + s)
          val o0 = sb.get((2 * 2) * N_SAMPLES + s)
          val o1 = sb.get((2 * 2 + 1) * N_SAMPLES + s)
          val v0 = sb.get((3 * 2) * N_SAMPLES + s)
          val v1 = sb.get((3 * 2 + 1) * N_SAMPLES + s)

          accV0[s] += v0 * w
          accV1[s] += v1 * w
          accA0[s] += (d0 + b0 + o0) * w
          accA1[s] += (d1 + b1 + o1) * w
          wacc[s] += w
        }
      }

      // 写出已确定区域 [0, flushLen)，复用 s16Buf（vocals/acc 各一次）
      val flushLen = if (i == nChunks - 1) {
        (totalSamples - flushed).toInt()
      } else {
        STRIDE
      }
      val outBytes = flushLen * CHANNELS * 2
      val outBuf = ByteBuffer.wrap(s16Buf).order(ByteOrder.LITTLE_ENDIAN)
      outBuf.clear()
      for (s in 0 until flushLen) {
        val wt = wacc[s].coerceAtLeast(1e-8f)
        putS16(outBuf, accV0[s] / wt)
        putS16(outBuf, accV1[s] / wt)
      }
      wavV.write(s16Buf, outBytes)
      outBuf.clear()
      for (s in 0 until flushLen) {
        val wt = wacc[s].coerceAtLeast(1e-8f)
        putS16(outBuf, accA0[s] / wt)
        putS16(outBuf, accA1[s] / wt)
      }
      wavA.write(s16Buf, outBytes)
      flushed += flushLen

      // 把重叠尾部 [flushLen, N) 平移到头部，清空其余
      if (i < nChunks - 1) {
        shiftTail(accV0, flushLen)
        shiftTail(accV1, flushLen)
        shiftTail(accA0, flushLen)
        shiftTail(accA1, flushLen)
        shiftTailW(wacc, flushLen)
      }

      onProgress((i + 1).toDouble() / nChunks, "inferring")
      }

      raf0.close()
      raf1.close()
      wavV.close()
      wavA.close()

      val vocalsWav = File(outDir, "vocals.wav")
      val accWav = File(outDir, "accompaniment.wav")
      tmpVocals.renameTo(vocalsWav)
      tmpAcc.renameTo(accWav)
      return Pair(vocalsWav, accWav)
    } catch (t: Throwable) {
      // 取消/失败：关闭句柄并删除半截临时文件，避免残留损坏缓存
      try { raf0.close() } catch (_: Exception) {}
      try { raf1.close() } catch (_: Exception) {}
      try { wavV.close() } catch (_: Exception) {}
      try { wavA.close() } catch (_: Exception) {}
      tmpVocals.delete()
      tmpAcc.delete()
      throw t
    }
  }

  private fun shiftTail(arr: FloatArray, flushLen: Int) {
    val tail = N_SAMPLES - flushLen
    System.arraycopy(arr, flushLen, arr, 0, tail)
    java.util.Arrays.fill(arr, tail, N_SAMPLES, 0f)
  }

  private fun shiftTailW(arr: FloatArray, flushLen: Int) {
    val tail = N_SAMPLES - flushLen
    System.arraycopy(arr, flushLen, arr, 0, tail)
    java.util.Arrays.fill(arr, tail, N_SAMPLES, 0f)
  }

  /**
   * 从平面 f32 文件读取 [start, start+clen)，不足补零；输出长度 N_SAMPLES。
   * bb/tmp 由调用方复用（跨块不重新分配），bb 容量必须 >= N_SAMPLES*4。
   */
  private fun readChannel(
    raf: RandomAccessFile,
    start: Long,
    clen: Int,
    out: FloatArray,
    bb: ByteBuffer,
    tmp: ByteArray,
  ) {
    bb.clear()
    java.util.Arrays.fill(tmp, 0)
    raf.seek(start * 4)
    var read = 0
    val want = clen * 4
    while (read < want) {
      val r = raf.read(tmp, read, want - read)
      if (r < 0) break
      read += r
    }
    bb.put(tmp, 0, tmp.size)
    // 剩余补零（bb clear 后未写部分随 out 初值为 0）
    bb.flip()
    val fb = bb.asFloatBuffer()
    fb.get(out, 0, N_SAMPLES)
  }

  private fun putS16(bb: ByteBuffer, v: Float) {
    var x = v
    if (x > 1f) x = 1f
    if (x < -1f) x = -1f
    bb.putShort((x * 32767f).toInt().toShort())
  }
}
