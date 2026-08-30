package com.kugou.android.vocalsep

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 高质量流式重采样器（Kaiser 窗 sinc 插值，32 taps，~90dB 阻带衰减）。
 *
 * 单声道 Float32 输入输出。内部维护一个小队列，只缓存半个核长度的前瞻样本，
 * 因此整曲处理也只占固定内存。
 *
 * 参考实现：标准的窗函数 sinc 重采样（libsamplerate 同类算法的简化版）。
 */
class SincResampler(
  private val inRate: Int,
  private val outRate: Int,
) {
  private val halfTaps = 16
  private val beta = 8.5569 // Kaiser beta，约 90dB 阻带
  private val cutoff = minOf(inRate, outRate) * 0.5

  // 输入队列（数组 + 头偏移 + 长度）
  private var queue = FloatArray(1 shl 18) // 262144 起步
  private var qHead = 0
  private var qLen = 0
  private var headInputPos = 0L // 队列头部对应的全局输入样本下标

  private var nextOutputPos = 0L // 下一个待产出的输出样本全局下标
  private var totalInput = -1L // EOF 后由 endInput 设置

  private val ratio: Double = inRate.toDouble() / outRate.toDouble()
  private val i0Beta = besselI0(beta)

  private fun besselI0(x: Double): Double {
    var sum = 1.0
    var term = 1.0
    val x2 = x * x / 4.0
    var k = 1
    while (k <= 32) {
      term *= x2 / (k * k)
      sum += term
      if (term < 1e-12 * sum) break
      k++
    }
    return sum
  }

  private fun kaiser(t: Double): Double {
    val r = t / halfTaps
    if (abs(r) >= 1.0) return 0.0
    return besselI0(beta * sqrt(1.0 - r * r)) / i0Beta
  }

  private fun sinc(u: Double): Double {
    if (abs(u) < 1e-12) return 1.0
    val x = Math.PI * u
    return sin(x) / x
  }

  private fun ensureCapacity(extra: Int) {
    if (qHead + qLen + extra <= queue.size) return
    if (qHead > 0) {
      System.arraycopy(queue, qHead, queue, 0, qLen)
      qHead = 0
      return
    }
    var newSize = queue.size
    while (newSize < qLen + extra) newSize *= 2
    val grown = FloatArray(newSize)
    System.arraycopy(queue, 0, grown, 0, qLen)
    queue = grown
  }

  /** 追加一段输入样本 */
  fun feed(input: FloatArray, offset: Int, length: Int) {
    ensureCapacity(length)
    System.arraycopy(input, offset, queue, qHead + qLen, length)
    qLen += length
  }

  /** 输入结束。totalInputSamples = 喂入的总样本数 */
  fun endInput(totalInputSamples: Long) {
    totalInput = totalInputSamples
  }

  private fun inputAt(globalPos: Long): Float {
    if (globalPos < 0 || globalPos >= totalInput) return 0f // 零填充
    val idx = (globalPos - headInputPos).toInt()
    if (idx < 0 || idx >= qLen) return 0f
    return queue[qHead + idx]
  }

  private fun expectedOutputs(): Long {
    return ((totalInput - 1) * outRate / inRate).toLong() + 1
  }

  /**
   * 产出尽可能多的输出样本。非 flush 时只产出有足够前瞻的样本；
   * flush=true 时输入已结束，边缘零填充，产出全部剩余样本。
   */
  fun read(flush: Boolean): FloatArray {
    // 输出上界：队列样本对应的输出数 + 余量
    val maxOut = ((qLen + 2 * halfTaps) * outRate.toLong() / inRate + 8).toInt()
    val out = FloatArray(maxOut.coerceAtLeast(64))
    var produced = 0

    while (true) {
      val center = nextOutputPos * ratio
      val lo = floor(center).toLong() - halfTaps + 1
      val hi = floor(center).toLong() + halfTaps

      // 总样本数未知（流式中）时不做上界判断
      if (totalInput >= 0 && nextOutputPos >= expectedOutputs()) break
      if (!flush && hi >= headInputPos + qLen) break

      var acc = 0.0
      var k = lo
      while (k <= hi) {
        val t = k - center
        val w = (2.0 * cutoff / inRate) * sinc(2.0 * cutoff * t / inRate) * kaiser(t)
        acc += inputAt(k) * w
        k++
      }
      if (acc > 1.0) acc = 1.0
      if (acc < -1.0) acc = -1.0
      out[produced++] = acc.toFloat()
      nextOutputPos++

      // 丢弃永远不再需要的队列头部
      val nextLo = floor(nextOutputPos * ratio).toLong() - halfTaps + 1
      if (nextLo > headInputPos) {
        val discard = (nextLo - headInputPos).toInt()
        qHead += discard
        qLen -= discard
        headInputPos = nextLo
      }
    }
    return out.copyOf(produced)
  }
}
