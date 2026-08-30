import playerState from '@/store/player/state'
import { playListById, playMusicInfo } from '@/core/player/player'
import { getDownloadTasks } from '@/core/download'
import { LIST_IDS } from '@/config/constant'

// mediaId 由 vivoLists 编码：列表类型(pl/fav/dl):音源:歌曲id
export const handleVivoBrowserPlay = async(mediaId: string) => {
  if (!mediaId) return
  const first = mediaId.indexOf(':')
  const second = mediaId.indexOf(':', first + 1)
  if (first < 0 || second < 0) return
  const type = mediaId.slice(0, first)
  const songId = mediaId.slice(second + 1)
  switch (type) {
    case 'pl': {
      // 播放列表 = 当前试听队列
      const listId = playerState.playInfo.playerListId
      if (!listId) return
      await playListById(listId, songId)
      break
    }
    case 'fav': {
      // 收藏列表 = 我喜欢
      await playListById(LIST_IDS.LOVE, songId)
      break
    }
    case 'dl': {
      // 下载列表：按歌曲 id 找到任务，以临时单曲方式播放
      const task = getDownloadTasks().find(t => t.metadata.musicInfo.id === songId)
      if (task) await playMusicInfo(task.metadata.musicInfo)
      break
    }
    default:
      break
  }
}
