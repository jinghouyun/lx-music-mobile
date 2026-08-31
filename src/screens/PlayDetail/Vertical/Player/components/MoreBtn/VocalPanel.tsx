import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { View, TouchableOpacity, StyleSheet } from 'react-native'
import Modal, { type ModalType } from '@/components/common/Modal'
import Text from '@/components/common/Text'
import Slider from '@/components/common/Slider'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import { useVocalState } from '@/core/vocalSeparation/hook'
import { setVocalMode, setVocalStrength, type VocalMode } from '@/core/vocalSeparation'

export interface VocalPanelType {
  setVisible: (visible: boolean) => void
}

const MODES: Array<{ key: VocalMode, label: string }> = [
  { key: 'original', label: '原唱' },
  { key: 'accompaniment', label: '伴奏' },
  { key: 'vocals', label: '纯人声' },
]

const busyText: Record<string, string> = {
  downloading: '下载中',
  decoding: '音频解码中',
  inferring: 'AI 分离中',
}

export default forwardRef<VocalPanelType, {}>((_, ref) => {
  const theme = useTheme()
  const state = useVocalState()
  const modalRef = useRef<ModalType>(null)
  const [sliderVal, setSliderVal] = useState(state.strength)

  useImperativeHandle(ref, () => ({
    setVisible(visible: boolean) {
      if (visible) setSliderVal(state.strength)
      modalRef.current?.setVisible(visible)
    },
  }))

  const busy = state.task.status === 'downloading' ||
    state.task.status === 'decoding' ||
    state.task.status === 'inferring'
  const strengthPct = Math.round(sliderVal * 100)

  return (
    <Modal
      ref={modalRef}
      bgColor="rgba(0,0,0,0.3)"
    >
      <TouchableOpacity
        style={styles.mask}
        activeOpacity={1}
        onPress={() => modalRef.current?.setVisible(false)}
      >
        <View
          style={StyleSheet.compose(styles.panel, {
            backgroundColor: theme['c-content-background'],
            borderColor: theme['c-border-background'],
          }) as any}
          onStartShouldSetResponder={() => true}
        >
          <Text style={styles.title} size={16} color={theme['c-font']}>人声分离</Text>

          {/* 三档模式 */}
          <View style={styles.modeRow}>
            {MODES.map(m => {
              const selected = state.desiredMode === m.key
              return (
                <TouchableOpacity
                  key={m.key}
                  style={StyleSheet.compose(styles.modeBtn, {
                    backgroundColor: selected
                      ? theme['c-button-background-selected']
                      : theme['c-button-background'],
                    borderColor: selected ? theme['c-primary'] : theme['c-border-background'],
                  }) as any}
                  onPress={() => { void setVocalMode(m.key) }}
                >
                  <Text
                    size={14}
                    color={selected ? theme['c-button-font-selected'] : theme['c-font-label']}
                  >
                    {m.label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* 去人声强度（伴奏模式） */}
          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <Text size={13} color={theme['c-font-label']}>去人声强度</Text>
              <Text size={13} color={theme['c-primary-font']}>{strengthPct}%</Text>
            </View>
            <Slider
              value={sliderVal}
              minimumValue={0}
              maximumValue={1}
              step={0.01}
              onValueChange={setSliderVal}
              onSlidingComplete={(v) => { void setVocalStrength(v) }}
            />
            <View style={styles.sliderEnds}>
              <Text size={11} color={theme['c-font-label']}>弱（保留人声）</Text>
              <Text size={11} color={theme['c-font-label']}>强（纯伴奏）</Text>
            </View>
          </View>

          {/* 混音播放失败原因（常驻，便于定位"没声音"） */}
          {state.mixError
            ? (
                <Text size={12} color="rgb(220, 80, 80)" style={styles.statusLine}>
                  {state.mixError}
                </Text>
              )
            : null}

          {/* 分离进度 */}
          {busy
            ? (
                <View style={styles.progressBox}>
                  <View style={styles.progressTrack}>
                    <View
                      style={StyleSheet.compose(styles.progressFill, {
                        width: `${Math.round(state.task.progress * 100)}%`,
                        backgroundColor: theme['c-primary'],
                      }) as any}
                    />
                  </View>
                  <Text size={12} color={theme['c-font-label']}>
                    {busyText[state.task.status] ?? '处理中'}… {Math.round(state.task.progress * 100)}%
                    {state.desiredMode !== 'original' ? '（完成后自动切换）' : ''}
                  </Text>
                </View>
              )
            : state.task.status === 'error'
              ? (
                  <Text size={12} color="rgb(220, 80, 80)" style={styles.statusLine}>
                    分离失败：{state.task.message}
                  </Text>
                )
              : (
                  <Text size={11} color={theme['c-font-label']} style={styles.statusLine}>
                    首次使用需下载 AI 分离模型（约 165MB），分离结果自动缓存
                  </Text>
                )}
        </View>
      </TouchableOpacity>
    </Modal>
  )
})


const styles = createStyle({
  modalContent: {
    justifyContent: 'flex-end',
  },
  mask: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  panel: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 0.5,
    paddingHorizontal: scaleSizeW(20),
    paddingTop: scaleSizeH(18),
    paddingBottom: scaleSizeH(28),
  },
  title: {
    fontWeight: 'bold',
    marginBottom: scaleSizeH(14),
  },
  modeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: scaleSizeH(16),
  },
  modeBtn: {
    flex: 1,
    marginHorizontal: scaleSizeW(4),
    paddingVertical: scaleSizeH(10),
    borderRadius: 8,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderSection: {
    marginBottom: scaleSizeH(8),
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: scaleSizeH(2),
  },
  sliderEnds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressBox: {
    marginTop: scaleSizeH(10),
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.25)',
    overflow: 'hidden',
    marginBottom: scaleSizeH(8),
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  statusLine: {
    marginTop: scaleSizeH(10),
  },
})
