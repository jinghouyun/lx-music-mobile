import { View, TouchableOpacity } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import StatusBar from '@/components/common/StatusBar'
import { scaleSizeH } from '@/utils/pixelRatio'
import { HEADER_HEIGHT } from '@/config/constant'
import SearchTypeSelector from '@/screens/Home/Views/Search/SearchTypeSelector'
import type { InitState as CommonState } from '@/store/common/state'

const headerComponents: Partial<Record<CommonState['navActiveId'], React.ReactNode>> = {
  nav_search: <SearchTypeSelector />,
}

const styles = createStyle({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    zIndex: 10,
    borderBottomWidth: 0.5,
  },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerSection: {
    flex: 1,
    alignItems: 'center',
  },
  titleText: {
    fontSize: 17,
    fontWeight: '600',
  },
  rightSection: {
    width: 40,
  },
})

const Header = ({ onShowDrawer }: { onShowDrawer: () => void }) => {
  const theme = useTheme()
  const id = useNavActiveId()
  const t = useI18n()
  const statusBarHeight = useStatusbarHeight()

  return (
    <>
      <StatusBar />
      <View
        style={{
          ...styles.container,
          height: scaleSizeH(HEADER_HEIGHT) + statusBarHeight,
          paddingTop: statusBarHeight,
          backgroundColor: theme['c-content-background'],
          borderBottomColor: theme['c-border-color'],
        }}
      >
        {/* 左侧：汉堡菜单 */}
        <TouchableOpacity style={styles.menuBtn} onPress={onShowDrawer} activeOpacity={0.6}>
          <Icon name="menu" size={24} color={theme['c-font']} />
        </TouchableOpacity>

        {/* 中间：标题 / 搜索类型选择器 */}
        {headerComponents[id] ?? (
          <View style={styles.centerSection}>
            <Text style={styles.titleText} color={theme['c-font']}>
              {t(id)}
            </Text>
          </View>
        )}

        {/* 右侧：占位 */}
        <View style={styles.rightSection} />
      </View>
    </>
  )
}

export default Header
