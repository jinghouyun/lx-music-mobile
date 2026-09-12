import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react'
import { View, TouchableOpacity, StyleSheet } from 'react-native'
import Modal, { type ModalType } from '@/components/common/Modal'
import Text from '@/components/common/Text'
import Slider from '@/components/common/Slider'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import { useVocalState } from '@/core/vocalSeparation/hook'
import { setVocalMode, setVocalStrength, saveStem, isCurrentSongSeparated, type VocalMode } from '@/core/vocalSeparation'
import type { StemType } from '@/utils/nativeModules/vocalSeparator'

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
  queued: '排队等待中',
  decoding: '音频解码中',
  inferring: 'AI 分离中',
}

export default forwardRef<VocalPanelType, {}>((_, ref) => {
  const theme = useTheme()
  const state = useVocalState()
  const modalRef = useRef<ModalType>(null)
  const [sliderVal, setSliderVal] = useState(state.strength)
  const [separated, setSeparated] = useState(false)
  const [savingStem, setSavingStem] = useState<StemType | null>(null)

  const refreshSeparated = () => {
    void isCurrentSongSeparated().then(setSeparated).catch(() => setSeparated(false))
  }

  // 打开面板 / 分离状态变化 / 切歌时，重新判断当前歌曲是否已可保存
  useEffect(() => {
    refreshSeparated()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.task.status, state.task.songId])

  useImperativeHandle(ref, () => ({
    setVisible(visible: boolean) {
      if (visible) {
        setSliderVal(state.strength)
        refreshSeparated()
      }
      modalRef.current?.setVisible(visible)
    },
  }))

  const handleSave = (stem: StemType) => {
    if (savingStem) return
    setSavingStem(stem)
    // saveStem 内部已 toast 兜底；这里再吞掉游离 reject，避免任何边角异常冒到全局致命页
    void saveStem(stem).catch(() => {}).finally(() => setSavingStem(null))
  }

  const taskBusy = state.task.status === 'downloading' ||
    state.task.status === 'queued' ||
    state.task.status === 'decoding' ||
    state.task.status === 'inferring'
  // 只有"当前歌曲尚未分离、正在为它分离"时才显示进度条。
  // 当前歌曲已缓存（separated）或已在混音播放（activeMode 非原唱）时，即便后台有
  // 其它歌曲正在分离，也与当前歌曲无关，不显示"AI 分离中…"，避免回到一首已缓存的歌
  // 点纯人声时底部又像重新分离了一遍。
  const busy = taskBusy && !separated && state.activeMode === 'original'
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
                  onPress={() => { void setVocalMode(m.key).catch(() => {}) }}
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
              onSlidingComplete={(v) => { void setVocalStrength(v).catch(() => {}) }}
            />
            <View style={styles.sliderEnds}>
              <Text size={11} color={theme['c-font-label']}>弱（保留人声）</Text>
              <Text size={11} color={theme['c-font-label']}>强（纯伴奏）</Text>
            </View>
          </View>

          {/* 保存到本地：分离完成后出现，导出 WAV 到手机音乐目录 */}
          {separated
            ? (
                <View style={styles.saveSection}>
                  <Text size={13} color={theme['c-font-label']} style={styles.saveTitle}>保存到本地（WAV，存入音乐目录）</Text>
                  <View style={styles.saveRow}>
                    {([
                      { key: 'accompaniment' as StemType, label: '保存伴奏' },
                      { key: 'vocals' as StemType, label: '保存人声' },
                    ]).map(b => {
                      const saving = savingStem === b.key
                      return (
                        <TouchableOpacity
                          key={b.key}
                          style={StyleSheet.compose(styles.saveBtn, {
                            backgroundColor: theme['c-button-background'],
                            borderColor: theme['c-border-background'],
                            opacity: savingStem && !saving ? 0.5 : 1,
                          }) as any}
                          disabled={!!savingStem}
                          onPress={() => handleSave(b.key)}
                        >
                          <Text size={13} color={theme['c-primary-font']}>
                            {saving ? '保存中…' : b.label}
                          </Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                </View>
              )
            : null}

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
                    {state.task.status === 'queued'
                      ? (state.task.message ?? '排队等待中…')
                      : `${busyText[state.task.status] ?? '处理中'}… ${Math.round(state.task.progress * 100)}%`}
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
  saveSection: {
    marginTop: scaleSizeH(14),
  },
  saveTitle: {
    marginBottom: scaleSizeH(8),
  },
  saveRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  saveBtn: {
    flex: 1,
    marginHorizontal: scaleSizeW(4),
    paddingVertical: scaleSizeH(10),
    borderRadius: 8,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
