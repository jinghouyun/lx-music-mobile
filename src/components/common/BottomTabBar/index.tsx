import { memo } from 'react'
import { View, TouchableOpacity, Platform } from 'react-native'
import { useI18n } from '@/lang'
import { useNavActiveId } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import { createStyle } from '@/utils/tools'
import { NAV_MENUS, type NAV_ID_Type } from '@/config/constant'
import { setNavActiveId } from '@/core/common'
import Text from '@/components/common/Text'

const styles = createStyle({
  container: {
    flexDirection: 'row',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: Platform.OS === 'android' ? 8 : 10,
  },
  tabIcon: {
    marginBottom: 2,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '500',
  },
})

const TabItem = ({ id, icon, isActive }: { id: NAV_ID_Type; icon: string; isActive: boolean }) => {
  const t = useI18n()
  const theme = useTheme()

  return (
    <TouchableOpacity
      style={styles.tabItem}
      onPress={() => {
        if (!isActive) setNavActiveId(id)
      }}
      activeOpacity={0.7}
    >
      <View style={styles.tabIcon}>
        <Icon
          name={icon}
          size={22}
          color={isActive ? theme['c-primary'] : theme['c-font-label']}
        />
      </View>
      <Text
        style={styles.tabText}
        size={11}
        color={isActive ? theme['c-primary'] : theme['c-font-label']}
      >
        {t(id)}
      </Text>
    </TouchableOpacity>
  )
}

export default memo(() => {
  const activeId = useNavActiveId()
  const theme = useTheme()

  return (
    <View
      style={{
        ...styles.container,
        backgroundColor: theme['c-content-background'],
      }}
    >
      {NAV_MENUS.map(menu => (
        <TabItem
          key={menu.id}
          id={menu.id}
          icon={menu.icon}
          isActive={activeId === menu.id}
        />
      ))}
    </View>
  )
})
