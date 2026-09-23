import { memo } from 'react'
import { View, TouchableOpacity, ScrollView } from 'react-native'

import { createStyle, openUrl } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { showPactModal } from '@/core/common'

// 对齐 Salt Player 关于页风格：logo + 名称 + 版本 + 制作人员/更新日志/条款/隐私/开源许可
export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const currentVer = process.versions.app

  const openHomePage = () => {
    void openUrl('https://github.com/jinghouyun/lx-music-mobile#readme')
  }
  const openIssuePage = () => {
    void openUrl('https://github.com/jinghouyun/lx-music-mobile/issues')
  }
  const openGHReleasePage = () => {
    void openUrl('https://github.com/jinghouyun/lx-music-mobile/releases')
  }
  const openFAQPage = () => {
    void openUrl('https://lyswhut.github.io/lx-music-doc/mobile/faq')
  }
  const openChangelog = () => {
    void openUrl('https://github.com/jinghouyun/lx-music-mobile/blob/main/CHANGELOG.md')
  }
  const openLicense = () => {
    void openUrl('https://github.com/jinghouyun/lx-music-mobile#%E9%A1%B9%E7%9B%AE%E5%8D%8F%E8%AE%AE')
  }
  const openPactModal = () => {
    showPactModal()
  }

  const linkStyle = {
    color: theme['c-primary-font'],
  } as const

  const items = [
    { label: '制作人员', action: openHomePage, value: '落雪无痕 · LX Music' },
    { label: '更新日志', action: openChangelog, value: '' },
    { label: '软件使用条款', action: openPactModal, value: '' },
    { label: '隐私协议', action: openLicense, value: '' },
    { label: '开放源代码许可', action: openLicense, value: '' },
    { label: '常见问题', action: openFAQPage, value: '' },
    { label: '提交 Issue', action: openIssuePage, value: '' },
  ]

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Logo 区 */}
      <View style={styles.logoSection}>
        <View style={styles.logoWrap}>
          <Icon name="logo" color={theme['c-primary']} size={52} />
        </View>
        <Text style={styles.appName} size={22} color={theme['c-font']}>Apple Music</Text>
        <View style={styles.versionRow}>
          <Text size={12} color={theme['c-primary-font']}>LX Music Mobile</Text>
          <View style={{ ...styles.officialTag, backgroundColor: theme['c-primary-light-700-alpha-500'] }}>
            <Text size={9} color={theme['c-primary']}>OFFICIAL</Text>
          </View>
        </View>
        <Text size={12} color={theme['c-500']}>v{currentVer}</Text>
      </View>

      {/* 信息列表 */}
      <View style={styles.listSection}>
        {items.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={{ ...styles.item, borderBottomColor: theme['c-border-background'] }}
            onPress={item.action}
            activeOpacity={0.7}
          >
            <Text size={14} color={theme['c-font']}>{item.label}</Text>
            <View style={styles.itemRight}>
              {item.value ? <Text size={12} color={theme['c-500']}>{item.value}</Text> : null}
              <Icon name="chevron-right" size={16} color={theme['c-300']} />
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.part}>
        <Text style={styles.text} color={theme['c-500']} >本软件完全免费，代码已开源。</Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text} color={theme['c-500']}>本软件没有客服，常见问题请先阅读 FAQ。</Text>
      </View>
      <View style={styles.part}>
        <Text style={styles.text} color={theme['c-500']}>目前本项目原始发布地址只有 GitHub，谨防第三方修改版。</Text>
      </View>
    </ScrollView>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  logoSection: {
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 30,
  },
  logoWrap: {
    width: 84,
    height: 84,
    borderRadius: 20,
    backgroundColor: 'rgba(214,69,65,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  appName: {
    fontWeight: '700',
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  officialTag: {
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  listSection: {
    marginTop: 10,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  itemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  part: {
    marginLeft: 20,
    marginRight: 20,
    marginTop: 10,
  },
  text: {
    fontSize: 12,
    textAlignVertical: 'bottom',
  },
})
