import { useEffect, useState } from 'react'
import { addVocalStateListener, getVocalState, type VocalState } from './index'

/** 人声分离状态（模式 / 分离任务进度 / 强度） */
export const useVocalState = (): VocalState => {
  const [s, setS] = useState<VocalState>(() => getVocalState())
  useEffect(() => addVocalStateListener(setS), [])
  return s
}
