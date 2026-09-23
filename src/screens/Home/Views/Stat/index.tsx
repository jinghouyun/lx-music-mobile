import { memo, useEffect, useMemo, useState } from 'react'
import { View, ScrollView } from 'react-native'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { usePlayerMusicInfo } from '@/store/player/hook'
import playerState from '@/store/player/state'

interface StatItem {
  label: string
  value: string
}

/**
 * 听歌统计页（对齐 Salt Player 统计入口）
 * 数据来源：播放历史 playedList + 当前播放状态
 */
export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const musicInfo = usePlayerMusicInfo()
  const [history, setHistory] = useState<LX.Player.PlayMusicInfo[]>(playerState.playedList)

  useEffect(() => {
    const handleUpdate = (list: LX.Player.PlayMusicInfo[]) => {
      setHistory(list)
    }
    global.state_event.on('playPlayedListChanged', handleUpdate)
    return () => {
      global.state_event.off('playPlayedListChanged', handleUpdate)
    }
  }, [])

  const stats = useMemo(() => {
    // 播放过的歌曲（去重）
    const uniqueSongs = new Map<string, { name: string, singer: string, count: number }>()
    for (const pm of history) {
      const info = 'progress' in pm.musicInfo ? pm.musicInfo.metadata.musicInfo : pm.musicInfo
      const key = info.id
      const prev = uniqueSongs.get(key)
      uniqueSongs.set(key, {
        name: info.name,
        singer: info.singer,
        count: prev ? prev.count + 1 : 1,
      })
    }
    const songs = Array.from(uniqueSongs.values())
    const artists = new Set<string>()
    for (const s of songs) {
      if (s.singer) artists.add(s.singer)
    }
    const list = [...history]
    const currentIndex = playerState.playInfo.playIndex
    const currentInfo = musicInfo.id ? musicInfo : null
    return {
      totalPlays: history.length,
      uniqueSongs: songs.length,
      artists: artists.size,
      currentSong: currentInfo ? `${currentInfo.name} - ${currentInfo.singer}` : '—',
      currentIndex: currentIndex >= 0 ? currentIndex + 1 : 0,
      topSongs: songs.sort((a, b) => b.count - a.count).slice(0, 10),
      recent: list.slice(-10).reverse(),
    }
  }, [history, musicInfo])

  const statItems: StatItem[] = [
    { label: t('stat_total_plays'), value: String(stats.totalPlays) },
    { label: t('stat_unique_songs'), value: String(stats.uniqueSongs) },
    { label: t('stat_artists'), value: String(stats.artists) },
    { label: t('stat_current_song'), value: stats.currentSong },
  ]

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* 统计卡片 */}
      <View style={styles.cardGrid}>
        {statItems.slice(0, 3).map((item, index) => (
          <View key={index} style={{ ...styles.card, backgroundColor: theme['c-primary-light-700-alpha-500'] }}>
            <Text size={22} color={theme['c-primary']} style={styles.cardValue}>{item.value}</Text>
            <Text size={11} color={theme['c-font-label']}>{item.label}</Text>
          </View>
        ))}
      </View>
      <View style={{ ...styles.currentCard, backgroundColor: theme['c-primary-light-700-alpha-500'] }}>
        <Text size={11} color={theme['c-font-label']}>{t('stat_current_song')}</Text>
        <Text numberOfLines={1} size={14} color={theme['c-font']} style={styles.currentText}>{stats.currentSong}</Text>
      </View>

      {/* 播放次数排行 */}
      {stats.topSongs.length ? (
        <View style={styles.section}>
          <Text size={14} color={theme['c-font-label']} style={styles.sectionTitle}>{t('stat_top_songs')}</Text>
          {stats.topSongs.map((song, index) => (
            <View key={index} style={styles.row}>
              <Text style={styles.rank} size={13} color={index < 3 ? theme['c-primary'] : theme['c-500']}>{index + 1}</Text>
              <View style={styles.rowInfo}>
                <Text numberOfLines={1} size={13} color={theme['c-font']}>{song.name}</Text>
                <Text numberOfLines={1} size={11} color={theme['c-500']}>{song.singer}</Text>
              </View>
              <Text size={12} color={theme['c-font-label']}>{song.count} 次</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* 最近播放 */}
      {stats.recent.length ? (
        <View style={styles.section}>
          <Text size={14} color={theme['c-font-label']} style={styles.sectionTitle}>{t('stat_recent')}</Text>
          {stats.recent.map((pm, index) => {
            const info = 'progress' in pm.musicInfo ? pm.musicInfo.metadata.musicInfo : pm.musicInfo
            return (
              <View key={index} style={styles.row}>
                <Text style={styles.rank} size={13} color={theme['c-500']}>{index + 1}</Text>
                <View style={styles.rowInfo}>
                  <Text numberOfLines={1} size={13} color={theme['c-font']}>{info.name}</Text>
                  <Text numberOfLines={1} size={11} color={theme['c-500']}>{info.singer}</Text>
                </View>
              </View>
            )
          })}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text size={13} color={theme['c-500']}>{t('stat_empty')}</Text>
        </View>
      )}
    </ScrollView>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  cardGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  card: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cardValue: {
    fontWeight: '600',
    marginBottom: 4,
  },
  currentCard: {
    marginTop: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  currentText: {
    marginTop: 2,
    fontWeight: '500',
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
  },
  rank: {
    width: 26,
    textAlign: 'center',
  },
  rowInfo: {
    flex: 1,
    paddingHorizontal: 8,
  },
  empty: {
    marginTop: 40,
    alignItems: 'center',
  },
})
