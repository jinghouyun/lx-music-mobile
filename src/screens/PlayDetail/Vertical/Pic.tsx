import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
// import { useLayout } from '@/utils/hooks'
import { createStyle } from '@/utils/tools'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { useWindowSize } from '@/utils/hooks'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { useNavigationComponentDidAppear } from '@/navigation'
import { HEADER_HEIGHT } from './components/Header'
import Image from '@/components/common/Image'
import { useStatusbarHeight } from '@/store/common/hook'
import commonState from '@/store/common/state'
import Text from '@/components/common/Text'


export default ({ componentId }: { componentId: string }) => {
  const musicInfo = usePlayerMusicInfo()
  const { width: winWidth, height: winHeight } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()

  const [animated, setAnimated] = useState(!!commonState.componentIds.playDetail)
  const [pic, setPic] = useState(musicInfo.pic)
  useEffect(() => {
    if (animated) setPic(musicInfo.pic)
  }, [musicInfo.pic, animated])

  useNavigationComponentDidAppear(componentId, () => {
    setAnimated(true)
  })
  // console.log('render pic')

  const album = musicInfo.album || (musicInfo as any)?.meta?.albumName || ''

  const style = useMemo(() => {
    const imgWidth = Math.min(winWidth * 0.7, (winHeight - statusBarHeight - HEADER_HEIGHT) * 0.42)
    return {
      width: imgWidth,
      height: imgWidth,
      borderRadius: 24,
    }
  }, [statusBarHeight, winHeight, winWidth])

  return (
    <View style={styles.container}>
      <View style={{ ...styles.content, elevation: animated ? 8 : 0 }}>
        <Image url={pic} nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_pic} style={style} />
      </View>
      {
        musicInfo.id
          ? (
              <View style={styles.info}>
                <Text style={styles.infoTitle} numberOfLines={1} color="rgba(255,255,255,0.92)" size={13}>{musicInfo.name} - {musicInfo.singer}{album ? ` (${album})` : ''}</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.metaItem} color="rgba(255,255,255,0.6)" size={11}>歌手：{musicInfo.singer}</Text>
                  {
                    album
                      ? <Text style={styles.metaItem} color="rgba(255,255,255,0.6)" size={11}>专辑：{album}</Text>
                      : null
                  }
                </View>
              </View>
            )
          : null
      }
    </View>
  )
}

const styles = createStyle({
  container: {
    flexGrow: 1,
    flexShrink: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    backgroundColor: 'rgba(0,0,0,0)',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  info: {
    marginTop: 18,
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  infoTitle: {
    fontWeight: '500',
  },
  metaRow: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  metaItem: {
    marginHorizontal: 6,
    marginTop: 3,
  },
})
