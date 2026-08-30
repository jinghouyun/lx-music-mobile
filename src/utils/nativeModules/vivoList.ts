import { NativeModules } from 'react-native'

// 原生 VivoListModule：把三个列表下发给系统媒体浏览器（vivo 原子随身听）
const { VivoListModule } = NativeModules

export interface VivoBrowserItem {
  // 编码：列表类型:音源:歌曲id，点歌时原样回传
  mediaId: string
  title: string
  artist: string
  artwork: string
}

export const updateVivoLists = (playlist: VivoBrowserItem[], favorite: VivoBrowserItem[], download: VivoBrowserItem[]) => {
  void Promise.resolve(VivoListModule?.updateLists?.(playlist, favorite, download)).catch(() => {})
}
