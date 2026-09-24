import { memo } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import { useI18n } from '@/lang'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import { confirmDialog, createStyle, exitApp as backHome } from '@/utils/tools'
import { exitApp, setNavActiveId } from '@/core/common'
import Text from '@/components/common/Text'

const styles = createStyle({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  statusBarSpace: {
    paddingTop: 24,
  },
  groupCard: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    marginHorizontal: 12,
    marginTop: 12,
    paddingVertical: 4,
  },
  menuItem: {
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  menuIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: {
    marginLeft: 14,
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '500',
  },
})

type IdType = 'nav_search' | 'nav_songlist' | 'nav_top' | 'nav_love' | 'nav_download' | 'nav_setting' | 'nav_exit' | 'back_home'

const MenuItem = ({ id, icon, color, onPress, label }: {
  id: IdType
  icon: string
  color: string
  onPress: (id: IdType) => void
  label: string
}) => {
  const activeId = useNavActiveId()
  const isActive = activeId == id
  return (
    <TouchableOpacity style={styles.menuItem} onPress={() => { onPress(id) }} activeOpacity={0.7}>
      <View style={{ ...styles.menuIcon, backgroundColor: color }}>
        <Icon name={icon} size={16} color="#fff" />
      </View>
      <Text style={{ ...styles.menuText, opacity: isActive ? 1 : 0.9 }}>{label}</Text>
    </TouchableOpacity>
  )
}

export default memo(() => {
  const t = useI18n()
  const statusBarHeight = useStatusbarHeight()

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
    <View style={styles.container}>
      <View style={{ height: statusBarHeight }} />
      <ScrollView>
        {/* 第一组：歌曲/专辑/艺术家/文件夹/歌单 */}
        <View style={styles.groupCard}>
          <MenuItem id="nav_search" icon="search" color="#34c759" label={t('nav_search')} onPress={handlePress} />
          <MenuItem id="nav_love" icon="favorite" color="#ff3b30" label={t('nav_love')} onPress={handlePress} />
          <MenuItem id="nav_top" icon="rank" color="#ffcc00" label={t('nav_top')} onPress={handlePress} />
          <MenuItem id="nav_songlist" icon="folder" color="#af52de" label={t('nav_songlist')} onPress={handlePress} />
          <MenuItem id="nav_download" icon="download" color="#007aff" label={t('nav_download')} onPress={handlePress} />
        </View>
        {/* 第二组：设置/关于 */}
        <View style={styles.groupCard}>
          <MenuItem id="nav_setting" icon="settings" color="#34c759" label={t('nav_setting')} onPress={handlePress} />
        </View>
      </ScrollView>
    </View>
  )
})
