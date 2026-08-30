import { NativeModules } from 'react-native'
import playerState from '@/store/player/state'
import { getList } from '@/core/player/playInfo'
import { isInitialized } from '@/plugins/player'
import { throttleBackgroundTimer } from '@/utils/tools'

type PlayMusic = LX.Player.PlayMusic

// 直接调用 RNTP 原生模块（补丁新增的 @ReactMethod，不走其会被 files 白名单裁掉的 src 封装）
const { TrackPlayerModule } = NativeModules

// 取歌曲在系统队列里要展示的字段（在线歌曲 / 下载项两种结构）
const getMusicFields = (musicInfo: PlayMusic) => {
  return 'progress' in musicInfo
    ? {
        id: musicInfo.id,
        name: musicInfo.metadata.musicInfo.name,
        singer: musicInfo.metadata.musicInfo.singer,
        pic: musicInfo.metadata.musicInfo.meta.picUrl,
      }
    : {
        id: musicInfo.id,
        name: musicInfo.name,
        singer: musicInfo.singer,
        pic: musicInfo.meta.picUrl,
      }
}

// 把当前播放列表整体下发给系统 MediaSession（原子随身听“播放列表”按钮读取）
const syncSessionQueue = () => {
  if (!isInitialized()) return
  const listId = playerState.playInfo.playerListId
  const current = playerState.playMusicInfo.musicInfo

  let list: PlayMusic[] = listId ? [...getList(listId)] : []
  // 下载列表/临时播放等取不到列表时，至少展示当前歌曲
  if (!list.length && current) list = [current]

  const items = list.map(musicInfo => {
    const f = getMusicFields(musicInfo)
    return {
      musicId: f.id ?? '',
      title: f.name || 'Unknow',
      artist: f.singer || '',
      artwork: f.pic || '',
    }
  })
  const currentMusicId = current ? getMusicFields(current).id ?? '' : ''

  // 原生 updateSessionQueue(items, currentMusicId): Promise<void>
  void Promise.resolve(TrackPlayerModule?.updateSessionQueue?.(items, currentMusicId)).catch(() => {})
}

const throttledSync = throttleBackgroundTimer(syncSessionQueue, 200)

export default () => {
  // 切歌
  global.app_event.on('musicToggled', throttledSync)
  // 列表歌曲增删改
  global.app_event.on('myListMusicUpdate', throttledSync)
  // 下载列表变化
  global.app_event.on('downloadListUpdate', throttledSync)
  // 列表本身变化（新建/删除/排序）
  global.app_event.on('mylistUpdated', throttledSync)
  // 初始化后同步一次
  throttledSync()
}
