import { memo, useState, useEffect } from 'react'
import { Modal, StyleSheet, View, ScrollView, TouchableOpacity, StatusBar } from 'react-native'

import Text from '@/components/common/Text'
import {
  addGlobalErrorListener,
  consumePendingError,
  type GlobalErrorInfo,
} from '@/utils/errorHandle'
import { clipboardWriteText, toast } from '@/utils/tools'

/** 从堆栈中提取第一处“出错位置”（at 开头的帧，剔除 node_modules 噪音） */
const extractFirstFrame = (stack?: string): string | null => {
  if (!stack) return null
  const line = stack.split('\n').find(l => l.includes('at ') && !l.includes('node_modules'))
  return line?.trim() ?? null
}

/**
 * 全局致命错误弹窗：替代系统 Alert。
 * 显示错误名/信息、出错位置（堆栈首帧）、完整堆栈，并支持一键复制，
 * 用户把复制的内容直接发回来即可定位 bug。固定深色风格，不依赖主题
 * （App 崩溃时主题可能未加载）。
 */
export default memo(() => {
  const [error, setError] = useState<GlobalErrorInfo | null>(() => consumePendingError())

  useEffect(() => {
    const unsub = addGlobalErrorListener(info => setError(info))
    return unsub
  }, [])

  const position = error ? extractFirstFrame(error.stack) : null

  const copyReport = () => {
    if (!error) return
    const report = [
      '[应用错误报告]',
      `错误: ${error.name}: ${error.message}`,
      position ? `出错位置: ${position}` : null,
      '完整堆栈:',
      error.stack ?? '(无堆栈)',
    ].filter(Boolean).join('\n')
    clipboardWriteText(report)
    toast('错误信息已复制，直接粘贴发回即可')
  }

  return (
    <Modal
      visible={!!error}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setError(null)}
    >
      <StatusBar backgroundColor="rgba(0,0,0,0.8)" barStyle="light-content" />
      <View style={styles.mask}>
        <View style={styles.card}>
          {/* 标题 */}
          <Text style={styles.title} size={18}>应用出 Bug 了</Text>
          <Text style={styles.subtitle} size={12} color="#8e8e98">
            已自动记录错误信息，点下方“复制”按钮发给我即可快速定位修复
          </Text>

          {/* 错误详情 */}
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={styles.errorLine} size={13} color="#ff6b6b">
              {error?.name ? `Fatal: ${error.name}` : ''} {error?.message ?? ''}
            </Text>

            {position ? (
              <View style={styles.posPill}>
                <Text size={11} color="#22c55e" style={styles.posText}>
                  出错位置: {position}
                </Text>
              </View>
            ) : null}

            <Text style={styles.stackTitle} size={11} color="#8e8e98">完整堆栈（Stack）:</Text>
            <Text selectable style={styles.stack} size={10} color="#9a9aa5">
              {error?.stack ?? '(无堆栈信息)'}
            </Text>
          </ScrollView>

          {/* 按钮 */}
          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.copyBtn]} onPress={copyReport} activeOpacity={0.8}>
              <Text style={styles.copyBtnText} size={14} color="#ffffff">复制错误信息</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.closeBtn]} onPress={() => setError(null)} activeOpacity={0.8}>
              <Text style={styles.closeBtnText} size={14} color="#9a9aa5">关闭</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
})

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxHeight: '78%',
    backgroundColor: '#1e1e24',
    borderRadius: 24,
    paddingVertical: 22,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 16,
  },
  title: {
    color: '#ffffff',
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  body: {
    marginTop: 16,
    maxHeight: 320,
    backgroundColor: '#141419',
    borderRadius: 14,
  },
  bodyContent: {
    padding: 14,
  },
  errorLine: {
    fontWeight: '600',
    lineHeight: 20,
  },
  posPill: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  posText: {
    fontWeight: '600',
  },
  stackTitle: {
    marginTop: 14,
    marginBottom: 6,
  },
  stack: {
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyBtn: {
    backgroundColor: '#22c55e',
  },
  copyBtnText: {
    fontWeight: '700',
  },
  closeBtn: {
    backgroundColor: '#2a2a32',
  },
  closeBtnText: {
    fontWeight: '600',
  },
})
