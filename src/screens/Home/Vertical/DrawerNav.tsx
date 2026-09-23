import { memo } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import { useI18n } from '@/lang'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import { confirmDialog, createStyle, exitApp as backHome } from '@/utils/tools'
import { NAV_MENUS } from '@/config/constant'
import type { InitState } from '@/store/common/state'
import { exitApp, setNavActiveId } from '@/core/common'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { setTheme } from '@/core/theme'
import { updateSetting } from '@/core/common'
import { getTheme } from '@/theme/themes'
import themeState from '@/store/theme/state'

const styles = createStyle({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 18,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    textAlign: 'center',
    marginLeft: 10,
  },
  headerVersion: {
    textAlign: 'center',
    marginTop: 2,
  },
  // 外观切换
  appearance: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 18,
    paddingBottom: 16,
  },
  appearanceItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  appearanceIcon: {
    marginBottom: 3,
  },
  menus: {
    flex: 1,
  },
  list: {
    paddingTop: 10,
    paddingBottom: 10,
  },
  menuItem: {
    flexDirection: 'row',
    paddingTop: 13,
    paddingBottom: 13,
    paddingLeft: 25,
    paddingRight: 25,
    alignItems: 'center',
  },
  iconContent: {
    width: 24,
    alignItems: 'center',
  },
  text: {
    paddingLeft: 20,
  },
})

const Header = () => {
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()
  return (
    <View style={{ paddingTop: statusBarHeight + 10, backgroundColor: theme['c-primary-light-700-alpha-500'] }}>
      <View style={styles.header}>
        <Icon name="logo" color={theme['c-primary-dark-100-alpha-300']} size={30} />
        <View>
          <Text style={styles.headerText} size={22} color={theme['c-primary-dark-100-alpha-300']}>Apple Music</Text>
          <Text style={styles.headerVersion} size={10} color={theme['c-primary-dark-100-alpha-400']}>LX Music · Salt Player UI</Text>
        </View>
      </View>
    </View>
  )
}

/**
 * 外观模式切换（对齐 Salt Player：跟随系统 / 浅色 / 深色）
 */
const AppearanceSwitch = () => {
  const t = useI18n()
  const theme = useTheme()
  const isAutoTheme = useSettingValue('common.isAutoTheme')
  const themeId = useSettingValue('theme.id')

  // 当前模式：auto=跟随系统；black=深色；其他=浅色
  const currentMode = isAutoTheme ? 'auto' : (themeId == 'black' ? 'dark' : 'light')

  const handleSelect = (mode: 'auto' | 'light' | 'dark') => {
    updateSetting({ 'common.isAutoTheme': mode == 'auto' })
    if (mode == 'dark') {
      updateSetting({ 'theme.id': 'black' })
      setTheme('black')
    } else if (mode == 'light') {
      const id = themeId == 'black' ? 'green' : themeId
      updateSetting({ 'theme.id': id })
      void getTheme().then(th => {
        if (th.id == themeState.theme.id) return
        setTheme(id)
      })
    } else {
      // 跟随系统：重新应用自动主题
      void getTheme().then(th => {
        if (th.id == themeState.theme.id) return
        setTheme(th.id)
      })
    }
  }

  const items = [
    { mode: 'auto' as const, icon: 'available_updates', label: t('appearance_follow_system') },
    { mode: 'light' as const, icon: 'album', label: t('appearance_light') },
    { mode: 'dark' as const, icon: 'logo', label: t('appearance_dark') },
  ]

  return (
    <View style={styles.appearance}>
      {items.map(item => {
        const active = currentMode == item.mode
        return (
          <TouchableOpacity
            key={item.mode}
            style={{
              ...styles.appearanceItem,
              backgroundColor: active ? theme['c-primary-light-700-alpha-500'] : 'transparent',
            }}
            activeOpacity={0.6}
            onPress={() => handleSelect(item.mode)}
          >
            <Icon name={item.icon} size={18} color={active ? theme['c-primary'] : theme['c-font-label']} />
            <Text size={10} color={active ? theme['c-primary'] : theme['c-font-label']}>{item.label}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

type IdType = InitState['navActiveId'] | 'nav_exit' | 'back_home'

const MenuItem = ({ id, icon, onPress }: {
  id: IdType
  icon: string
  onPress: (id: IdType) => void
}) => {
  const t = useI18n()
  const activeId = useNavActiveId()
  const theme = useTheme()

  return activeId == id
    ? <View style={styles.menuItem}>
        <View style={styles.iconContent}>
          <Icon name={icon} size={20} color={theme['c-primary-font-active']} />
        </View>
        <Text style={styles.text} color={theme['c-primary-font']}>{t(id)}</Text>
      </View>
    : <TouchableOpacity style={styles.menuItem} onPress={() => { onPress(id) }}>
        <View style={styles.iconContent}>
          <Icon name={icon} size={20} color={theme['c-font-label']} />
        </View>
        <Text style={styles.text}>{t(id)}</Text>
      </TouchableOpacity>
}

export default memo(() => {
  const theme = useTheme()
  // console.log('render drawer nav')
  const showBackBtn = useSettingValue('common.showBackBtn')
  const showExitBtn = useSettingValue('common.showExitBtn')

  const handlePress = (id: IdType) => {
    switch (id) {
      case 'nav_exit':
        void confirmDialog({
          message: global.i18n.t('exit_app_tip'),
          confirmButtonText: global.i18n.t('list_remove_tip_button'),
        }).then(isExit => {
          if (!isExit) return
          exitApp('Exit Btn')
        })
        return
      case 'back_home':
        backHome()
        return
    }

    global.app_event.changeMenuVisible(false)
    setNavActiveId(id)
  }


  return (
    <View style={{ ...styles.container, backgroundColor: theme['c-content-background'] }}>
      <Header />
      <AppearanceSwitch />
      <ScrollView style={styles.menus}>
        <View style={styles.list}>
          {NAV_MENUS.map(menu => <MenuItem key={menu.id} id={menu.id} icon={menu.icon} onPress={handlePress} />)}
        </View>
      </ScrollView>

      {
        showBackBtn ? <MenuItem id="back_home" icon="home" onPress={handlePress} /> : null
      }
      {
        showExitBtn ? <MenuItem id="nav_exit" icon="exit2" onPress={handlePress} /> : null
      }
    </View>
  )
})
