import { Alert } from 'react-native'
// import { exitApp } from '@/utils/common'
import { setJSExceptionHandler, setNativeExceptionHandler } from 'react-native-exception-handler'
import { log } from '@/utils/log'
import { toast } from './tools'

export interface GlobalErrorInfo {
  name: string
  message: string
  stack?: string
}

// ---------------- 全局错误弹窗事件 ----------------
// GlobalErrorModal（挂在所有屏幕根节点）订阅此事件来展示错误详情。
// 崩溃可能发生在根组件挂载之前，因此保留 pendingError 兜底：组件挂载时
// 通过 consumePendingError 取走尚未展示的错误。
type ErrorListener = (info: GlobalErrorInfo) => void
const errorListeners = new Set<ErrorListener>()
let pendingError: GlobalErrorInfo | null = null

export const addGlobalErrorListener = (cb: ErrorListener) => {
  errorListeners.add(cb)
  return () => { errorListeners.delete(cb) }
}

export const consumePendingError = (): GlobalErrorInfo | null => {
  const e = pendingError
  pendingError = null
  return e
}

const emitGlobalError = (info: GlobalErrorInfo) => {
  pendingError = info
  if (errorListeners.size === 0) {
    // 全局弹窗组件尚未挂载（启动早期崩溃）：退回系统 Alert，保证用户能看到错误
    Alert.alert(
      '💥Unexpected error occurred💥',
      `应用出 bug 了😭\n\nError:\nFatal: ${info.name} ${info.message}`,
      [{ text: '关闭 (Close)' }],
    )
    return
  }
  errorListeners.forEach(l => l(info))
}

const errorHandler = (e: Error, isFatal: boolean) => {
  const excludedErrors = [
    'Failed to construct \'Response\'',
  ]
  if (isFatal) {
    if (excludedErrors.some((excludedError) => e.message.includes(excludedError))) {
      toast('应用遇到了错误，如果你有固定的复现方式，请截图并在 GitHub 反馈（并附上具体的操作步骤，以及“设置-错误日志”的内容）')
    } else {
      emitGlobalError({
        name: e.name,
        message: e.message,
        stack: e.stack,
      })
    }
  }
  log.error(e.stack)
}

if (process.env.NODE_ENV !== 'development') {
  setJSExceptionHandler(errorHandler)

  setNativeExceptionHandler((errorString) => {
    log.error(errorString)
    console.log('+++++', errorString, '+++++')
  }, false)
}
