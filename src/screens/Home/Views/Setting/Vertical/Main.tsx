import { memo, Component, type ReactNode } from 'react'
import { FlatList, View, type FlatListProps } from 'react-native'

import Basic from '../settings/Basic'
import Player from '../settings/Player'
import LyricDesktop from '../settings/LyricDesktop'
import Search from '../settings/Search'
import List from '../settings/List'
import Download from '../settings/Download'
import Sync from '../settings/Sync'
import Backup from '../settings/Backup'
import Other from '../settings/Other'
import Version from '../settings/Version'
import { createStyle } from '@/utils/tools'
import { SETTING_SCREENS, type SettingScreenIds } from '../Main'
import Text from '@/components/common/Text'
import { log } from '@/utils/log'

type FlatListType = FlatListProps<SettingScreenIds>


const styles = createStyle({
  content: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 15,
    paddingBottom: 15,
    flex: 0,
  },
})

/**
 * 设置区块错误边界：某个区块（如人声分离缓存）渲染崩溃时，
 * 只降级显示该区块，不影响整个设置页（避免下滑白屏、后面区块全消失）。
 * 错误详情会照常进入全局错误日志，并可复制反馈。
 */
class SectionErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, message: string }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message ?? String(error) }
  }

  componentDidCatch(error: Error) {
    // 进入全局错误日志（设置-错误日志）
    log.error(`[设置区块渲染失败] ${error.stack ?? error.message}`)
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ paddingVertical: 20, paddingHorizontal: 15, borderRadius: 14, backgroundColor: 'rgba(239,68,68,0.08)', gap: 6 }}>
          <Text size={13} color="#ef4444">该设置区块渲染失败（已记录到错误日志）</Text>
          <Text size={11} color="#ef4444">{this.state.message}</Text>
        </View>
      )
    }
    return this.props.children
  }
}

const ListItem = memo(({
  id,
}: { id: SettingScreenIds }) => {
  let content: ReactNode = null
  switch (id) {
    case 'player': content = <Player />; break
    case 'lyric_desktop': content = <LyricDesktop />; break
    case 'search': content = <Search />; break
    case 'list': content = <List />; break
    case 'download': content = <Download />; break
    case 'sync': content = <Sync />; break
    case 'backup': content = <Backup />; break
    case 'other': content = <Other />; break
    case 'version': content = <Version />; break
    case 'basic': content = <Basic />; break
  }
  return <SectionErrorBoundary>{content}</SectionErrorBoundary>
}, () => true)

export default () => {
  const renderItem: FlatListType['renderItem'] = ({ item }) => <ListItem id={item} />
  const getkey: FlatListType['keyExtractor'] = item => item

  return (
    <FlatList
      data={SETTING_SCREENS}
      keyboardShouldPersistTaps={'always'}
      renderItem={renderItem}
      keyExtractor={getkey}
      contentContainerStyle={styles.content}
      maxToRenderPerBatch={2}
      // updateCellsBatchingPeriod={80}
      windowSize={2}
      // removeClippedSubviews={true}
      initialNumToRender={1}
    />
  )
}
