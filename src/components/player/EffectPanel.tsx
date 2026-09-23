import { forwardRef, memo, useImperativeHandle, useRef, useState } from 'react'
import { View, TouchableOpacity, ScrollView, Linking } from 'react-native'
import Popup, { type PopupType, type PopupProps } from '@/components/common/Popup'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { setPlaybackRate, updateMetaData } from '@/plugins/player'
import { setPlaybackRate as setLyricPlaybackRate } from '@/core/lyric'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'

interface EffectPanelProps extends Omit<PopupProps, 'children' | 'title'> {}

export interface EffectPanelType {
  show: () => void
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

export default memo(forwardRef<EffectPanelType, EffectPanelProps>((props, ref) => {
  const t = useI18n()
  const theme = useTheme()
  const playbackRate = useSettingValue('player.playbackRate')
  const [visible, setVisible] = useState(false)
  const popupRef = useRef<PopupType>(null)

  useImperativeHandle(ref, () => ({
    show() {
      if (visible) popupRef.current?.setVisible(true)
      else {
        setVisible(true)
        requestAnimationFrame(() => popupRef.current?.setVisible(true))
      }
    },
  }))

  const handleSetRate = (rate: number) => {
    void setPlaybackRate(rate).then(() => {
      void updateMetaData(playerState.musicInfo, playerState.isPlay, true)
      void setLyricPlaybackRate(rate)
    })
    updateSetting({ 'player.playbackRate': rate })
  }

  const handleOpenSystemEffect = () => {
    // 打开系统音效设置页（Android）
    void Linking.openSettings()
  }

  return (
    visible
      ? (
        <Popup
          ref={popupRef}
          title={t('play_detail_setting_effect_title')}
          closeBtn={true}
          bgHide={true}
          {...props}
        >
          <ScrollView>
            <View style={styles.section}>
              <Text size={13} color={theme['c-font-label']}>{t('play_detail_setting_playback_rate')}</Text>
              <View style={styles.rateRow}>
                {RATES.map(rate => (
                  <TouchableOpacity
                    key={rate}
                    onPress={() => handleSetRate(rate)}
                    style={[styles.rateBtn, {
                      borderColor: playbackRate == rate ? theme['c-primary'] : theme['c-border-background'],
                      backgroundColor: playbackRate == rate ? theme['c-primary'] : 'transparent',
                    }]}
                    activeOpacity={0.7}
                  >
                    <Text size={13} color={playbackRate == rate ? theme['c-primary-font-active'] : theme['c-font']}>
                      {rate == 1 ? '1x' : `${rate}x`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {playbackRate != 1 ? (
                <TouchableOpacity onPress={() => handleSetRate(1)} style={styles.resetBtn} activeOpacity={0.7}>
                  <Text size={12} color={theme['c-primary-font']}>{t('play_detail_setting_playback_rate_reset')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text size={13} color={theme['c-font-label']}>{t('play_detail_setting_effect_system')}</Text>
              <TouchableOpacity style={styles.item} onPress={handleOpenSystemEffect} activeOpacity={0.7}>
                <Icon name="slider" size={18} color={theme['c-font-label']} />
                <Text style={styles.itemText} size={14}>{t('play_detail_setting_effect_system_equalizer')}</Text>
                <Icon name="chevron-right" size={16} color={theme['c-300']} />
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Popup>
        )
      : null
  )
}))

const styles = createStyle({
  section: {
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  rateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: 8,
    gap: 8,
  },
  rateBtn: {
    minWidth: 48,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  resetBtn: {
    paddingTop: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  itemText: {
    flex: 1,
    paddingLeft: 10,
  },
})
