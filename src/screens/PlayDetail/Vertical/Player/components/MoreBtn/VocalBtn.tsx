import { memo, useRef } from 'react'
import { TouchableOpacity } from 'react-native'
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'
import { useTheme } from '@/store/theme/hook'
import { BTN_WIDTH, BTN_ICON_SIZE } from './Btn'
import { useVocalState } from '@/core/vocalSeparation/hook'
import VocalPanel, { type VocalPanelType } from './VocalPanel'

/**
 * 人声分离按钮（循环 与 评论 之间）。
 * 原唱：灰色麦克风；伴奏/纯人声生效中：绿色高亮；分离中：绿色（面板内看进度）。
 */
export default memo(() => {
  const theme = useTheme()
  const state = useVocalState()
  const panelRef = useRef<VocalPanelType>(null)

  const active = state.activeMode !== 'original'
  const busy = state.task.status === 'downloading' ||
    state.task.status === 'decoding' ||
    state.task.status === 'inferring'

  return (
    <>
      <TouchableOpacity
        style={{
          width: BTN_WIDTH,
          height: BTN_WIDTH,
          marginLeft: 5,
          justifyContent: 'center',
          alignItems: 'center',
        }}
        activeOpacity={0.5}
        onPress={() => panelRef.current?.setVisible(true)}
      >
        <MaterialCommunityIcons
          name={active ? 'microphone' : 'microphone-outline'}
          size={BTN_ICON_SIZE}
          color={active || busy ? theme['c-primary'] : theme['c-font-label']}
        />
      </TouchableOpacity>
      <VocalPanel ref={panelRef} />
    </>
  )
})
