package com.kugou.android.vocalsep

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.util.Log
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
  ep: String, // "xnnpack" | "nnapi" | "cpu"
  private val onProgress: (fraction: Double, stage: String) -> Unit,
) {
  /** 当前后端：首块自检发现 XNNPACK/NNAPI 输出静音时，降级为 "cpu" 重建会话 */
  private var ep: String = ep

  companion object {
    const val SAMPLE_RATE = 44100
    const val CHANNELS = 2
    const val SEGMENT_S = 7.8
    val N_SAMPLES = (SEGMENT_S * SAMPLE_RATE).toInt() // 343980
    val OVERLAP = N_SAMPLES / 4                        // 85995
    val STRIDE = N_SAMPLES - OVERLAP                   // 257985
    private const val TAG = "DemucsSeparator"
    /** 峰值低于此值判定为静音（正常音乐/模型输出峰值在 0.01~1.0 量级） */
    private const val SILENCE_PEAK = 1e-4f
  }

  /** 首块自检失败、需要换 CPU 后端重跑的内部控制信号 */
  private class CpuFallback(
    val inPeak: Float,
    val outPeak: Float,
    val nan: Boolean,
    val backend: String,
  ) : Exception()

  /** 用户/切歌取消标志：分块之间检查，取消后尽快退出并清理临时文件 */
  @Volatile
  var cancelled = false

  private lateinit var env: OrtEnvironment
  private lateinit var session: OrtSession
  private var actualEp = "cpu"
  /** 实际生效的 XNNPACK / ORT-CPU 线程池大小（open() 后填充） */
  private var xnnThreads = 1
  private var cpuThreads = 1
  /** EP 初始化/回退过程中的诊断信息（便于确认为何没走 XNNPACK） */
  private var epDiag = ""

  /** 供通知栏/UI 展示的后端标签，便于在真机上确认加速是否真的生效 */
  val backendInfo: String
    get() = when (actualEp) {
      "xnnpack" -> "XNNPACK ${xnnThreads}线程"
      "nnapi" -> "NNAPI"
      else -> "CPU ${cpuThreads}线程"
    }

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

    // 骁龙 8 Gen 2 等 big.LITTLE 机型无 SMT，availableProcessors() 即在线物理核数。
    val cores = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
    // 关键性能修复：XNNPACK 自带独立线程池，其 intra_op_num_threads 默认值是 1！
    // 旧代码 addXnnpack(emptyMap()) 没传该参数，导致 Conv/Gemm/MatMul（htdemucs
    // 编码器/解码器卷积）全部单线程执行——这是真机 ~5 分钟/首的首要原因。
    // 官方建议把 XNNPACK 池设为物理核数。
    xnnThreads = cores.coerceAtMost(8)
    // ORT CPU EP 线程池：跑 XNNPACK 不支持的算子（BiLSTM、注意力、各类激活）。
    // 旧代码 coerceIn(2, 4) 把它锁死在 4 线程，八核旗舰只用到一半算力。
    cpuThreads = cores.coerceAtMost(8)
    opts.setIntraOpNumThreads(cpuThreads)
    // XNNPACK 池与 ORT 池相互独立；单次推理节点顺序执行、同一时刻只有一个池在工作，
    // 关闭 ORT 池忙等可避免另一个池计算时本池线程空转抢核（XNNPACK 官方推荐配置）。
    try { opts.addConfigEntry("session.intra_op.allow_spinning", "0") } catch (_: Throwable) {}

    actualEp = setupEp(opts)
    session = env.createSession(modelPath, opts)
  }

  private fun setupEp(opts: OrtSession.SessionOptions): String {
    // 后台线程优先级：推理线程提优先级，避免锁屏/后台时被系统压到极低频
    try {
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_DISPLAY)
    } catch (_: Throwable) {}

    // 回退顺序（关键）：XNNPACK 失败后直接回纯 CPU，不再走 NNAPI。
    // 原因：htdemucs 含大量 LSTM/Transformer/动态形状算子，NNAPI 大多不支持、回退 CPU，
    // 还倒贴 NNAPI<->CPU 的张量拷贝与分区开销，实测比纯 CPU 更慢。
    // NNAPI 仅在用户显式指定时才尝试。
    val order = when (ep) {
      "nnapi" -> listOf("nnapi", "cpu")
      "xnnpack" -> listOf("xnnpack", "cpu")
      else -> listOf("cpu")
    }
    val diags = StringBuilder()
    for (name in order) {
      try {
        when (name) {
          // ORT 1.21 Java 的 addXnnpack 接受 EP 选项 Map；必须显式传 intra_op_num_threads，
          // 否则 XNNPACK 内部线程池默认只有 1 线程，卷积/矩阵乘退化为单线程。
          "xnnpack" -> opts.addXnnpack(
            mapOf("intra_op_num_threads" to xnnThreads.toString()),
          )
          "nnapi" -> tryEnableNnapi(opts)
          "cpu" -> {
            // 纯 CPU 路径：多核（大核优先由系统调度）
            opts.setIntraOpNumThreads(cpuThreads)
            opts.setInterOpNumThreads(1)
          }
        }
        epDiag = diags.toString()
        Log.i(TAG, "EP 生效: $name (xnnThreads=$xnnThreads, cpuThreads=$cpuThreads) $epDiag")
        return name
      } catch (t: Throwable) {
        // 记录每个 EP 失败原因（之前静默吞掉，导致 XNNPACK 没生效也无从知晓）
        diags.append("[$name 失败: ${t.javaClass.simpleName}: ${t.message?.take(120)}] ")
        Log.w(TAG, "EP $name 初始化失败，尝试下一个", t)
      }
    }
    epDiag = diags.toString()
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
    val vocalsWav = File(outDir, "vocals.wav")
    val accWav = File(outDir, "accompaniment.wav")

    try {
      while (true) {
        val tmpVocals = File(outDir, "vocals.wav.tmp")
        val tmpAcc = File(outDir, "accompaniment.wav.tmp")
        val wavV = WavWriter(tmpVocals)
        val wavA = WavWriter(tmpAcc)
        wavV.open()
        wavA.open()
        try {
          runPass(raf0, raf1, totalSamples, wavV, wavA)
          wavV.close()
          wavA.close()
          tmpVocals.renameTo(vocalsWav)
          tmpAcc.renameTo(accWav)
          return Pair(vocalsWav, accWav)
        } catch (fb: CpuFallback) {
          // 首块自检发现当前后端输出全 0（真机上 XNNPACK 对该 FP16 图的已知数值异常）：
          // 丢弃本遍半成品，关闭会话，用纯 CPU 后端重建后从头重跑。
          try { wavV.close() } catch (_: Exception) {}
          try { wavA.close() } catch (_: Exception) {}
          tmpVocals.delete()
          tmpAcc.delete()
          Log.w(TAG, "后端 ${fb.backend} 首块输出静音" +
            "(inPeak=${fb.inPeak},outPeak=${fb.outPeak},nan=${fb.nan})，降级纯 CPU 重跑")
          try { close() } catch (_: Exception) {}
          ep = "cpu"
          open()
          onProgress(0.0, "inferring")
        } catch (t: Throwable) {
          // 取消/致命错误：关闭句柄并删除半截临时文件，避免残留损坏缓存
          try { wavV.close() } catch (_: Exception) {}
          try { wavA.close() } catch (_: Exception) {}
          tmpVocals.delete()
          tmpAcc.delete()
          throw t
        }
      }
    } finally {
      try { raf0.close() } catch (_: Exception) {}
      try { raf1.close() } catch (_: Exception) {}
    }
  }

  /** 单遍流式分离（首块含输入/输出峰值自检） */
  private fun runPass(
    raf0: RandomAccessFile,
    raf1: RandomAccessFile,
    totalSamples: Long,
    wavV: WavWriter,
    wavA: WavWriter,
  ) {
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

      // 首块自检 1/2：输入峰值。若解码/重采样产出的是静音，模型输出必然全 0
      var inPeak = 0f
      if (i == 0) {
        var k = 0
        while (k < 2 * N_SAMPLES) {
          val v = inFb.get(k)
          val a = if (v < 0f) -v else v
          if (a > inPeak) inPeak = a
          k += 4
        }
        Log.i(TAG, "首块自检: 输入峰值=$inPeak 后端=$backendInfo")
        if (inPeak < SILENCE_PEAK) {
          throw RuntimeException("解码输入为静音(峰值=$inPeak)：音频解码/重采样未产出有效数据")
        }
      }

      val inputTensor = OnnxTensor.createTensor(env, inFb, longArrayOf(1, 2, N_SAMPLES.toLong()))
      val output = session.run(Collections.singletonMap("mix", inputTensor))
      inputTensor.close()

      output.use { res ->
        val stemsTensor = res.get("stems").orElseThrow {
          RuntimeException("模型输出中找不到 stems")
        } as OnnxTensor
        val sb: FloatBuffer = stemsTensor.floatBuffer
        // 首块自检 2/2：输出峰值。XNNPACK/NNAPI 在部分机型上对该 FP16 图可能输出全 0/NaN，
        // 此时降级纯 CPU 重跑（CpuFallback）；CPU 仍静音则属模型/图本身问题，直接报错。
        if (i == 0) {
          var outPeak = 0f
          var nan = false
          val tot = 4 * 2 * N_SAMPLES
          var k = 0
          while (k < tot) {
            val v = sb.get(k)
            if (v.isNaN()) nan = true
            val a = if (v < 0f) -v else v
            if (a > outPeak) outPeak = a
            k += 7
          }
          Log.i(TAG, "首块自检: 输出峰值=$outPeak nan=$nan 后端=$backendInfo")
          if (nan || outPeak < SILENCE_PEAK) {
            if (actualEp != "cpu") {
              throw CpuFallback(inPeak, outPeak, nan, backendInfo)
            }
            throw RuntimeException(
              "模型输出为静音(输入峰值=${"%.3f".format(inPeak)}," +
                "输出峰值=${"%.6f".format(outPeak)},nan=$nan,后端=$backendInfo)",
            )
          }
        }
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
