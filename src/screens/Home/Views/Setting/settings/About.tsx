import { memo } from 'react'
import { View, TouchableOpacity, StyleSheet } from 'react-native'

import { Icon } from '@/components/common/Icon'
import { createStyle, openUrl } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { showPactModal } from '@/core/common'
import { showModal as showVersionModal } from '@/core/version'

const currentVer = process.versions.app

interface RowProps {
  title: string
  subtitle?: string
  onPress?: () => void
}

const Row = memo(({ title, subtitle, onPress }: RowProps) => {
  const theme = useTheme()
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={styles.row}>
      <View style={styles.rowTextWrap}>
        <Text size={16} color={theme['c-font']}>{title}</Text>
        {subtitle ? (
          <Text size={12} color={theme['c-font-label']} style={styles.rowSubtitle}>{subtitle}</Text>
        ) : null}
      </View>
      <Icon name="chevron-right" size={16} color={theme['c-font-label']} />
    </TouchableOpacity>
  )
})

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()

  const openHomePage = () => {
    void openUrl('https://github.com/lyswhut/lx-music-mobile#readme')
  }
  const openGHReleasePage = () => {
    void openUrl('https://github.com/lyswhut/lx-music-mobile/releases')
  }
  const openFAQPage = () => {
    void openUrl('https://lyswhut.github.io/lx-music-doc/mobile/faq')
  }
  const openPactModal = () => {
    showPactModal()
  }
  const openPartPage = () => {
    void openUrl('https://github.com/lyswhut/lx-music-mobile#%E9%A1%B9%E7%9B%AE%E5%8D%8F%E8%AE%AE')
  }
  const openVersionModal = () => {
    showVersionModal()
  }
  const openLicensePage = () => {
    void openUrl('https://github.com/lyswhut/lx-music-mobile#%E5%BC%80%E6%BA%90%E5%8D%8F%E8%AE%AE')
  }

  return (
    <View style={styles.container}>
      {/* 居中图标 + 名称 + 版本 */}
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: theme['c-primary'] }]}>
          <Text size={32} color="#fff" style={{ fontWeight: 'bold' }}>♪</Text>
        </View>
        <Text size={18} color={theme['c-font']} style={[styles.appName, { fontWeight: 'bold' }]}>
          LX Music™
        </Text>
        <Text size={13} color={theme['c-font-label']} style={styles.appVersion}>
          v{currentVer} Official
        </Text>
      </View>

      {/* 核准号卡片 */}
      <View style={[styles.card, { backgroundColor: theme['c-primary-alpha-900'] }]}>
        <Row title="App 核准号" subtitle="无" onPress={openFAQPage} />
      </View>

      {/* 链接卡片组 */}
      <View style={[styles.card, { backgroundColor: theme['c-primary-alpha-900'] }]}>
        <Row title="制作人员" onPress={openHomePage} />
        <View style={[styles.divider, { backgroundColor: theme['c-border-background'] }]} />
        <Row title="更新日志" onPress={openVersionModal} />
        <View style={[styles.divider, { backgroundColor: theme['c-border-background'] }]} />
        <Row title="软件使用条款" onPress={openPactModal} />
        <View style={[styles.divider, { backgroundColor: theme['c-border-background'] }]} />
        <Row title="隐私协议" onPress={openPartPage} />
        <View style={[styles.divider, { backgroundColor: theme['c-border-background'] }]} />
        <Row title="开放源代码许可" onPress={openLicensePage} />
      </View>

      {/* 版本信息卡片 */}
      <View style={[styles.card, { backgroundColor: theme['c-primary-alpha-900'] }]}>
        <Row title="当前版本" subtitle={`v${currentVer}`} onPress={openVersionModal} />
        <View style={[styles.divider, { backgroundColor: theme['c-border-background'] }]} />
        <Row title="GitHub Releases" onPress={openGHReleasePage} />
        <View style={[styles.divider, { backgroundColor: theme['c-border-background'] }]} />
        <Row title="常见问题" onPress={openFAQPage} />
      </View>
    </View>
  )
})

const styles = createStyle({
  container: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 10,
    paddingBottom: 20,
  },
  header: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 28,
  },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  appName: {
    marginBottom: 4,
  },
  appVersion: {
    opacity: 0.7,
  },
  card: {
    borderRadius: 16,
    marginBottom: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 14,
    paddingTop: 14,
    paddingBottom: 14,
    minHeight: 52,
  },
  rowTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  rowSubtitle: {
    marginTop: 2,
    opacity: 0.6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
})
