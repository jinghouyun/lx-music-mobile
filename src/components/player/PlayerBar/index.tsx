import { memo, useMemo } from 'react'
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
import { scaleSizeW } from '@/utils/pixelRatio'

const styles = createStyle({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: scaleSizeW(12),
    marginBottom: 8,
    height: 56,
    borderRadius: 28,
    paddingLeft: 6,
    paddingRight: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  coverWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 2,
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
    width: 36,
    height: 36,
    borderRadius: 18,
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
    <View style={{ ...styles.container, backgroundColor: theme['c-content-background'] }}>
      {/* 左侧封面 */}
      <TouchableOpacity onPress={handlePressCover} activeOpacity={0.8}>
        <View style={{ ...styles.coverWrap, borderColor: theme['c-primary-light-100'] }}>
          <Image url={musicInfo.pic} style={styles.cover} resizeMode="cover" />
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
          style={{ ...styles.playBtn, backgroundColor: theme['c-primary-light-100'] }}
          onPress={handleTogglePlay}
          activeOpacity={0.7}
        >
          <Icon name={isPlay ? 'pause' : 'play'} color={theme['c-primary']} size={18} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default memo(({ isHome = false }: { isHome?: boolean }) => {
  const { keyboardShown } = useKeyboard()
  const autoHidePlayBar = useSettingValue('common.autoHidePlayBar')

  const playerComponent = useMemo(() => <MiniPlayerBar isHome={isHome} />, [isHome])

  return autoHidePlayBar && keyboardShown ? null : playerComponent
})
