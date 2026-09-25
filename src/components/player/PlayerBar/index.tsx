import { memo, useMemo, useRef } from 'react'
import { View, TouchableOpacity } from 'react-native'
import { useKeyboard } from '@/utils/hooks'

import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useIsPlay, usePlayerMusicInfo } from '@/store/player/hook'
import { togglePlay } from '@/core/player/player'
import { navigations } from '@/navigation'
import commonState from '@/store/common/state'
import { Icon } from '@/components/common/Icon'
import Image from '@/components/common/Image'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'

const styles = createStyle({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    marginHorizontal: 12,
    marginBottom: 10,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  coverWrap: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: 'hidden',
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  songInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  songName: {
    fontSize: 14,
    fontWeight: '600',
  },
  songArtist: {
    fontSize: 12,
    marginTop: 2,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  listBtn: {
    padding: 6,
  },
})

const MiniPlayerBar = ({ isHome }: { isHome?: boolean }) => {
  const theme = useTheme()
  const musicInfo = usePlayerMusicInfo()
  const isPlay = useIsPlay()

  const handlePressCover = () => {
    if (!musicInfo.id) return
    navigations.pushPlayDetailScreen(commonState.componentIds.home!)
  }

  const handleTogglePlay = () => {
    void togglePlay()
  }

  return (
    <>
      <View style={{ ...styles.container, backgroundColor: theme['c-content-background'] }}>
        {/* 左侧封面 */}
        <TouchableOpacity onPress={handlePressCover} activeOpacity={0.8}>
          <View style={styles.coverWrap}>
            <Image url={musicInfo.pic} style={styles.cover} resizeMode="cover" nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_pic} />
          </View>
        </TouchableOpacity>

        {/* 中间歌曲信息 */}
        <TouchableOpacity style={styles.songInfo} onPress={handlePressCover} activeOpacity={0.7}>
          <Text style={styles.songName} color={theme['c-font']} numberOfLines={1}>
            {musicInfo.name || '未播放'}
          </Text>
          {musicInfo.singer ? (
            <Text style={styles.songArtist} color={theme['c-font-label']} numberOfLines={1}>
              {musicInfo.singer}
            </Text>
          ) : null}
        </TouchableOpacity>

        {/* 右侧控制按钮 */}
        <View style={styles.controls}>
          <TouchableOpacity
            onPress={handleTogglePlay}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name={isPlay ? 'pause' : 'play'} color={theme['c-font']} size={24} />
          </TouchableOpacity>
        </View>
      </View>
    </>
  )
}

export default memo(({ isHome = false }: { isHome?: boolean }) => {
  const { keyboardShown } = useKeyboard()
  const autoHidePlayBar = useSettingValue('common.autoHidePlayBar')

  const playerComponent = useMemo(() => <MiniPlayerBar isHome={isHome} />, [isHome])

  return autoHidePlayBar && keyboardShown ? null : playerComponent
})
