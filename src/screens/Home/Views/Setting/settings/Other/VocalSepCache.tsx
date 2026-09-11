import { memo, useState, useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import { toast, confirmDialog, sizeFormate } from '@/utils/tools'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import { clearVocalCache, getVocalCacheInfo, exportVocalCache, importVocalCache } from '@/core/vocalSeparation'

export default memo(() => {
  const t = useI18n()
  const [cleaning, setCleaning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [cacheSize, setCacheSize] = useState<string | null>(null)
  const [songCount, setSongCount] = useState(0)
  const choosePathRef = useRef<ChoosePathType>(null)
  const actionRef = useRef<'export' | 'import'>('export')

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

  const handleExport = () => {
    if (songCount === 0) {
      toast('暂无可导出的缓存')
      return
    }
    actionRef.current = 'export'
    choosePathRef.current?.show({
      title: '选择保存位置',
      dirOnly: true,
    })
  }

  const handleImport = () => {
    actionRef.current = 'import'
    choosePathRef.current?.show({
      title: '选择缓存备份文件（.zip）',
      dirOnly: false,
      filter: /\.zip$/i,
    })
  }

  const onConfirmPath = (path: string) => {
    if (actionRef.current === 'export') {
      setExporting(true)
      void exportVocalCache(path, 'vocal_sep_cache').then(res => {
        toast(`导出成功：${res.songCount} 首（${sizeFormate(res.totalBytes)}）`)
      }).catch((e: any) => {
        toast(`导出失败：${e?.message ?? e}`)
      }).finally(() => {
        refresh()
        setExporting(false)
      })
    } else {
      setImporting(true)
      void importVocalCache(path).then(res => {
        toast(`导入完成：新增 ${res.importedCount} 首，跳过 ${res.skippedCount} 首`)
      }).catch((e: any) => {
        toast(`导入失败：${e?.message ?? e}`)
      }).finally(() => {
        refresh()
        setImporting(false)
      })
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const busy = exporting || importing || cleaning

  return (
    <SubTitle title="人声分离缓存">
      <View style={styles.cacheSize}>
        <Text>
          {cacheSize == null
            ? t('setting_other_cache_getting')
            : `已分离 ${songCount} 首，占用 ${cacheSize}`}
        </Text>
      </View>
      <View style={styles.buttonRow}>
        <Button disabled={busy || songCount === 0} onPress={handleExport}>
          {exporting ? '导出中…' : '导出缓存'}
        </Button>
        <Button disabled={busy} onPress={handleImport}>
          {importing ? '导入中…' : '导入缓存'}
        </Button>
      </View>
      <View style={styles.clearBtn}>
        <Button disabled={busy || songCount === 0} onPress={handleClean}>
          {cleaning ? '清除中…' : '清除缓存'}
        </Button>
      </View>
      <ChoosePath ref={choosePathRef} onConfirm={onConfirmPath} />
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  cacheSize: {
    marginBottom: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  clearBtn: {
    flexDirection: 'row',
  },
})
