import { createStyle } from '@/utils/tools'
import { View, TouchableOpacity } from 'react-native'
import { useRef } from 'react'
import { useTheme } from '@/store/theme/hook'
import PlayModeBtn from './PlayModeBtn'
import TimeoutExitBtn from './TimeoutExitBtn'
import EffectBtn from './EffectBtn'
import QueueBtn from './QueueBtn'
import Btn, { BTN_WIDTH, BTN_ICON_SIZE } from './Btn'
import DorpDownMenu, { type DorpDownMenuProps } from '@/components/common/DorpDownMenu'
import { useI18n } from '@/lang'
import { Icon } from '@/components/common/Icon'
import { navigations } from '@/navigation'
import commonState from '@/store/common/state'
import { useSettingValue } from '@/store/setting/hook'
import DesktopLyricEnable, { type DesktopLyricEnableType } from '@/components/DesktopLyricEnable'
import MusicAddModal, { type MusicAddModalType } from '@/components/MusicAddModal'
import playerState from '@/store/player/state'
import { useVocalState } from '@/core/vocalSeparation/hook'
import VocalPanel, { type VocalPanelType } from './VocalPanel'

/**
 * 底部控制栏（对齐 Salt Player 风格）：循环 / 定时 / 音效 / 列表 / 更多
 * 更多菜单收纳：桌面歌词、加歌、人声分离、评论
 */
const MoreMenu = () => {
  const t = useI18n()
  const theme = useTheme()
  const desktopLyricEnableRef = useRef<DesktopLyricEnableType>(null)
  const musicAddModalRef = useRef<MusicAddModalType>(null)
  const vocalPanelRef = useRef<VocalPanelType>(null)
  const enabledLyric = useSettingValue('desktopLyric.enable')
  const vocalState = useVocalState()

  const menus = [
    { action: 'desktopLyric', label: t(enabledLyric ? 'toggle_desktop_lyric_disable' : 'toggle_desktop_lyric_enable') },
    { action: 'addMusic', label: t('music_add_to') },
    { action: 'vocal', label: t('vocal_panel_title') },
    { action: 'comment', label: t('comment') },
  ] as const

  const handlePress: DorpDownMenuProps<typeof menus>['onPress'] = (menu) => {
    switch (menu.action) {
      case 'desktopLyric':
        desktopLyricEnableRef.current?.setEnabled(!enabledLyric)
        break
      case 'addMusic': {
        const musicInfo = playerState.playMusicInfo.musicInfo
        if (!musicInfo) return
        musicAddModalRef.current?.show({
          musicInfo: 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo,
          isMove: false,
          listId: playerState.playMusicInfo.listId!,
        })
        break
      }
      case 'vocal':
        vocalPanelRef.current?.setVisible(true)
        break
      case 'comment':
        navigations.pushCommentScreen(commonState.componentIds.playDetail!)
        break
    }
  }

  const vocalActive = vocalState.activeMode !== 'original'

  return (
    <>
      <DorpDownMenu menus={menus} onPress={handlePress}>
        <View style={styles.menuBtn}>
          {vocalActive
            ? <TouchableOpacity style={styles.vocalBadge}><Icon name="music_time" size={6} color="white" /></TouchableOpacity>
            : null}
          <Icon name="dots-vertical" size={BTN_ICON_SIZE} color={theme['c-font-label']} />
        </View>
      </DorpDownMenu>
      <DesktopLyricEnable ref={desktopLyricEnableRef} />
      <MusicAddModal ref={musicAddModalRef} />
      <VocalPanel ref={vocalPanelRef} />
    </>
  )
}

export default () => {
  return (
    <View style={styles.container}>
      <PlayModeBtn />
      <TimeoutExitBtn />
      <EffectBtn />
      <QueueBtn />
      <MoreMenu />
    </View>
  )
}


const styles = createStyle({
  container: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  menuBtn: {
    width: BTN_WIDTH,
    height: BTN_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  vocalBadge: {
    position: 'absolute',
    top: 4,
    right: 2,
  },
})
