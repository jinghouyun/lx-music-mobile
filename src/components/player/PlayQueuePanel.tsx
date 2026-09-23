import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { View, FlatList, TouchableOpacity } from 'react-native'
import Popup, { type PopupType, type PopupProps } from '@/components/common/Popup'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { getList } from '@/core/player/playInfo'
import { playList, playListById } from '@/core/player/player'
import playerState from '@/store/player/state'
import { usePlayInfo } from '@/store/player/hook'
import { MUSIC_TOGGLE_MODE, MUSIC_TOGGLE_MODE_LIST } from '@/config/constant'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { clearListMusics } from '@/core/list'
import { LIST_IDS } from '@/config/constant'

interface PlayQueuePanelProps extends Omit<PopupProps, 'children' | 'title'> {}

export interface PlayQueuePanelType {
  show: () => void
}

type QueueItem = LX.Music.MusicInfo | LX.Download.ListItem

const getQueueList = (listId: string | null): QueueItem[] => {
  if (!listId) return []
  const list = getList(listId)
  if (!Array.isArray(list)) return []
  return list as QueueItem[]
}

const getItemName = (item: QueueItem) => {
  return 'metadata' in item ? item.metadata.musicInfo.name : item.name
}
const getItemSinger = (item: QueueItem) => {
  return 'metadata' in item ? item.metadata.musicInfo.singer : item.singer
}
const getItemId = (item: QueueItem) => {
  return 'metadata' in item ? item.metadata.musicInfo.id : item.id
}

const QueueRow = memo(({ item, index, activeIndex, onPress }: {
  item: QueueItem
  index: number
  activeIndex: number
  onPress: (item: QueueItem, index: number) => void
}) => {
  const theme = useTheme()
  const isActive = index == activeIndex
  return (
    <TouchableOpacity style={styles.row} onPress={() => onPress(item, index)} activeOpacity={0.6}>
      <View style={styles.rowIndex}>
        {isActive ? <Icon name="play-outline" size={14} color={theme['c-primary-font']} /> : <Text size={12} color={theme['c-300']}>{index + 1}</Text>}
      </View>
      <View style={styles.rowInfo}>
        <Text numberOfLines={1} size={14} color={isActive ? theme['c-primary-font'] : theme['c-font']}>{getItemName(item)}</Text>
        <Text numberOfLines={1} size={11} color={isActive ? theme['c-primary-alpha-200'] : theme['c-500']}>{getItemSinger(item)}</Text>
      </View>
      {isActive ? <Icon name="music_time" size={14} color={theme['c-primary-font']} /> : null}
    </TouchableOpacity>
  )
})

export default memo(forwardRef<PlayQueuePanelType, PlayQueuePanelProps>((props, ref) => {
  const t = useI18n()
  const theme = useTheme()
  const playInfo = usePlayInfo()
  const togglePlayMethod = useSettingValue('player.togglePlayMethod')
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [visible, setVisible] = useState(false)
  const popupRef = useRef<PopupType>(null)

  const refreshQueue = () => {
    setQueue(getQueueList(playerState.playInfo.playerListId))
  }

  useImperativeHandle(ref, () => ({
    show() {
      refreshQueue()
      if (visible) popupRef.current?.setVisible(true)
      else {
        setVisible(true)
        requestAnimationFrame(() => popupRef.current?.setVisible(true))
      }
    },
  }))

  const handleClear = () => {
    const listId = playerState.playInfo.playerListId
    if (!listId || listId == LIST_IDS.TEMP) return
    const ids = getQueueList(listId).map(getItemId).filter(Boolean) as string[]
    if (!ids.length) return
    void clearListMusics(ids)
  }

  const handlePressItem = (item: QueueItem, index: number) => {
    const listId = playerState.playInfo.playerListId
    if (!listId) return
    const id = getItemId(item)
    if (id) void playListById(listId, id)
    else void playList(listId, index)
  }

  const handleToggleMode = () => {
    let index = MUSIC_TOGGLE_MODE_LIST.indexOf(togglePlayMethod)
    if (++index >= MUSIC_TOGGLE_MODE_LIST.length) index = 0
    updateSetting({ 'player.togglePlayMethod': MUSIC_TOGGLE_MODE_LIST[index] })
  }

  useEffect(() => {
    const handleUpdate = () => refreshQueue()
    global.app_event.on('musicToggled', handleUpdate)
    global.app_event.on('myListMusicUpdate', handleUpdate)
    global.app_event.on('downloadListUpdate', handleUpdate)
    global.app_event.on('mylistUpdated', handleUpdate)
    return () => {
      global.app_event.off('musicToggled', handleUpdate)
      global.app_event.off('myListMusicUpdate', handleUpdate)
      global.app_event.off('downloadListUpdate', handleUpdate)
      global.app_event.off('mylistUpdated', handleUpdate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const modeName = togglePlayMethod == MUSIC_TOGGLE_MODE.random
    ? 'play_list_random'
    : togglePlayMethod == MUSIC_TOGGLE_MODE.list
      ? 'play_list_order'
      : togglePlayMethod == MUSIC_TOGGLE_MODE.singleLoop
        ? 'play_single_loop'
        : togglePlayMethod == MUSIC_TOGGLE_MODE.none
          ? 'play_single'
          : 'play_list_loop'

  const modeIcon = togglePlayMethod == MUSIC_TOGGLE_MODE.random
    ? 'list-random'
    : togglePlayMethod == MUSIC_TOGGLE_MODE.list
      ? 'list-order'
      : togglePlayMethod == MUSIC_TOGGLE_MODE.singleLoop
        ? 'single-loop'
        : 'list-loop'

  return (
    visible
      ? (
        <Popup
          ref={popupRef}
          title={`${t('play_detail_setting_queue')} (${queue.length})`}
          closeBtn={true}
          bgHide={true}
          {...props}
        >
          <View style={styles.toolbar}>
            <TouchableOpacity style={styles.toolbarBtn} onPress={handleToggleMode} activeOpacity={0.6}>
              <Icon name={modeIcon} size={18} color={theme['c-font-label']} />
              <Text size={11} color={theme['c-font-label']}>{t(modeName)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolbarBtn} onPress={handleClear} activeOpacity={0.6}>
              <Icon name="eraser" size={18} color={theme['c-font-label']} />
              <Text size={11} color={theme['c-font-label']}>{t('play_detail_setting_queue_clear')}</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={queue}
            renderItem={({ item, index }) => (
              <QueueRow item={item} index={index} activeIndex={playInfo.playIndex} onPress={handlePressItem} />
            )}
            keyExtractor={(item, index) => `${index}`}
            style={styles.list}
            showsVerticalScrollIndicator={false}
          />
        </Popup>
        )
      : null
  )
}))

const styles = createStyle({
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
    borderBottomWidth: 0.5,
  },
  toolbarBtn: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  list: {
    flexGrow: 0,
    maxHeight: 420,
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  rowIndex: {
    width: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowInfo: {
    flex: 1,
    paddingHorizontal: 8,
  },
})
