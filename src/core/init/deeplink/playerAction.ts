import { collectMusic, dislikeMusic, pause, play, playNext, playPrev, togglePlay, uncollectMusic } from '@/core/player/player'
import commonState from '@/store/common/state'
import { navigations } from '@/navigation'

export type PlayerAction = 'play' | 'pause' | 'skipNext' | 'skipPrev' | 'togglePlay' | 'collect' | 'uncollect' | 'dislike' | 'openPlayDetail'

export const handlePlayerAction = async(action: PlayerAction) => {
  switch (action) {
    case 'openPlayDetail': {
      // 原子随身听会话入口点击：直达播放详情页，已打开则不重复入栈
      const homeId = commonState.componentIds.home
      if (homeId && !commonState.componentIds.playDetail) navigations.pushPlayDetailScreen(homeId)
      break
    }
    case 'play':
      play()
      break
    case 'pause':
      void pause()
      break
    case 'skipNext':
      void playNext()
      break
    case 'skipPrev':
      void playPrev()
      break
    case 'togglePlay':
      togglePlay()
      break
    case 'collect':
      collectMusic()
      break
    case 'uncollect':
      uncollectMusic()
      break
    case 'dislike':
      void dislikeMusic()
      break
    // default: throw new Error('Unknown action: ' + (action as any ?? ''))
  }
}
