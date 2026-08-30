import playerState from '@/store/player/state'
import { getList } from '@/core/player/playInfo'
import { getListMusicSync } from '@/utils/listManage'
import { getDownloadTasks } from '@/core/download'
import { isInitialized } from '@/plugins/player'
import { throttleBackgroundTimer } from '@/utils/tools'
import { LIST_IDS } from '@/config/constant'
import { updateVivoLists, type VivoBrowserItem } from '@/utils/nativeModules/vivoList'

type PlayMusic = LX.Player.PlayMusic

// 统一取在线歌曲 / 下载项两种结构的展示字段
const pickFields = (musicInfo: PlayMusic) => {
  return 'progress' in musicInfo
    ? {
        id: musicInfo.metadata.musicInfo.id,
        name: musicInfo.metadata.musicInfo.name,
        singer: musicInfo.metadata.musicInfo.singer ?? '',
        pic: musicInfo.metadata.musicInfo.meta.picUrl ?? '',
        source: musicInfo.metadata.musicInfo.source,
      }
    : {
        id: musicInfo.id,
        name: musicInfo.name,
        singer: musicInfo.singer ?? '',
        pic: musicInfo.meta?.picUrl ?? '',
        source: musicInfo.source,
      }
}

const toBrowserItem = (musicInfo: PlayMusic, prefix: string): VivoBrowserItem => {
  const f = pickFields(musicInfo)
  return {
    mediaId: `${prefix}:${f.source}:${f.id}`,
    title: f.name || 'Unknow',
    artist: f.singer,
    artwork: f.pic,
  }
}

// 播放列表：当前试听队列（与系统 MediaSession 队列保持一致）
const buildPlaylist = (): VivoBrowserItem[] => {
  const listId = playerState.playInfo.playerListId
  const current = playerState.playMusicInfo.musicInfo
  let list: PlayMusic[] = listId ? [...getList(listId)] : []
  if (!list.length && current) list = [current]
  return list.map(m => toBrowserItem(m, 'pl'))
}

// 收藏列表：我喜欢
const buildFavoriteList = (): VivoBrowserItem[] => {
  return getListMusicSync(LIST_IDS.LOVE).map(m => toBrowserItem(m, 'fav'))
}

// 下载列表：下载任务里的歌曲，按歌曲 id 去重
const buildDownloadList = (): VivoBrowserItem[] => {
  const seen = new Set<string>()
  const items: VivoBrowserItem[] = []
  for (const task of getDownloadTasks()) {
    const musicInfo = task.metadata.musicInfo
    if (seen.has(musicInfo.id)) continue
    seen.add(musicInfo.id)
    items.push(toBrowserItem(musicInfo, 'dl'))
  }
  return items
}

// 把三个列表整体下发给原生 MediaBrowserService
const syncVivoLists = () => {
  if (!isInitialized()) return
  updateVivoLists(buildPlaylist(), buildFavoriteList(), buildDownloadList())
}

const throttledSync = throttleBackgroundTimer(syncVivoLists, 200)

export default () => {
  // 切歌
  global.app_event.on('musicToggled', throttledSync)
  // 列表歌曲增删改（含初始化覆盖）
  global.app_event.on('myListMusicUpdate', throttledSync)
  // 列表本身变化（新建/删除/排序）
  global.app_event.on('mylistUpdated', throttledSync)
  // 下载列表变化
  global.app_event.on('downloadListUpdate', throttledSync)
  // 初始化后同步一次
  throttledSync()
}
