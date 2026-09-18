import { View, TouchableOpacity, Platform } from 'react-native'
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 10,
    borderBottomWidth: 0.5,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 80,
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 20,
    fontWeight: '700',
  },
  centerSection: {
    flex: 1,
    alignItems: 'center',
  },
  titleText: {
    fontSize: 16,
    fontWeight: '600',
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 80,
    justifyContent: 'flex-end',
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

const Header = () => {
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
        {/* 左侧：Logo */}
        <View style={styles.leftSection}>
          <View style={styles.logo}>
            <Icon name="logo" size={24} color={theme['c-primary']} />
            <Text style={{ marginLeft: 6 }} size={18} color={theme['c-primary']} bold>
              Alger
            </Text>
          </View>
        </View>

        {/* 中间：标题 / 搜索类型选择器 */}
        {headerComponents[id] ?? (
          <View style={styles.centerSection}>
            <Text style={styles.titleText} color={theme['c-font']}>
              {t(id)}
            </Text>
          </View>
        )}

        {/* 右侧：占位，保持对称 */}
        <View style={styles.rightSection}>
          {/* 预留：后续可加通知、更多菜单等 */}
        </View>
      </View>
    </>
  )
}

export default Header
