import { memo, useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import { toast, confirmDialog } from '@/utils/tools'
import { sizeFormate } from '@/utils'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { clearVocalCache, getVocalCacheInfo } from '@/core/vocalSeparation'

export default memo(() => {
  const t = useI18n()
  const [cleaning, setCleaning] = useState(false)
  const [cacheSize, setCacheSize] = useState<string | null>(null)
  const [songCount, setSongCount] = useState(0)

  const refresh = () => {
    void getVocalCacheInfo().then(info => {
      setCacheSize(sizeFormate(info.sizeBytes))
      setSongCount(info.songCount)
    }).catch(() => {
      setCacheSize('0B')
      setSongCount(0)
    })
  }

  const handleClean = () => {
    void confirmDialog({
      message: '将清除所有人声分离结果（不含 AI 模型），下次播放需要重新分离。确定清除？',
      confirmButtonText: t('list_remove_tip_button'),
    }).then(confirm => {
      if (!confirm) return
      setCleaning(true)
      void clearVocalCache().then(() => {
        toast('人声分离缓存已清除')
      }).finally(() => {
        refresh()
        setCleaning(false)
      })
    })
  }

  useEffect(() => {
    refresh()
  }, [])

  return (
    <SubTitle title="人声分离缓存">
      <View style={styles.cacheSize}>
        <Text>
          {cacheSize == null
            ? t('setting_other_cache_getting')
            : `已分离 ${songCount} 首，占用 ${cacheSize}`}
        </Text>
      </View>
      <View style={styles.clearBtn}>
        <Button disabled={cleaning || songCount === 0} onPress={handleClean}>清除缓存</Button>
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  cacheSize: {
    marginBottom: 5,
  },
  clearBtn: {
    flexDirection: 'row',
  },
})
