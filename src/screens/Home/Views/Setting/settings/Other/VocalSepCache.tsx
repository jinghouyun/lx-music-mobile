import { memo, useState, useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import { toast, confirmDialog } from '@/utils/tools'
import { sizeFormate } from '@/utils/common'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import Modal, { type ModalType } from '@/components/common/Modal'
import { useTheme } from '@/store/theme/hook'
import { clearVocalCache, getVocalCacheInfo, exportVocalCache, importVocalCache } from '@/core/vocalSeparation'
import { vocalSeparator, type VocalSepExportProgressEvent } from '@/utils/nativeModules/vocalSeparator'

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const [cleaning, setCleaning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [cacheSize, setCacheSize] = useState<string | null>(null)
  const [songCount, setSongCount] = useState(0)
  const [exportProgress, setExportProgress] = useState<VocalSepExportProgressEvent | null>(null)
  const choosePathRef = useRef<ChoosePathType>(null)
  const progressModalRef = useRef<ModalType>(null)
  const actionRef = useRef<'export' | 'import'>('export')

  const refresh = () => {
    void getVocalCacheInfo().then(info => {
      setCacheSize(sizeFormate(info.sizeBytes))
      setSongCount(info.songCount)
    }).catch((e: any) => {
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
      // ChoosePath 的 filter 约定为“不带点的扩展名数组”（同 PicItem / LXM_FILE_EXT_RXP），
      // 不能传正则：系统选择器会把它作为 extTypes 传给原生（RegExp 无法跨桥序列化，直接崩溃），
      // 内置选择器也会对它调用 .join() 报错。
      filter: ['zip'],
    })
  }

  const onConfirmPath = (path: string) => {
    if (actionRef.current === 'export') {
      setExporting(true)
      setExportProgress({ written: 0, total: 1, progress: 0, currentFile: '' })
      progressModalRef.current?.setVisible(true)
      // 监听原生导出进度（后台线程压缩，事件节流上报）
      const sub = vocalSeparator.addExportProgressListener(e => {
        setExportProgress(e)
      })
      void exportVocalCache(path, 'vocal_sep_cache').then(res => {
        toast(`导出成功：${res.songCount} 首（${sizeFormate(res.totalBytes)}）`)
      }).catch((e: any) => {
        toast(`导出失败：${e?.message ?? e}`)
      }).finally(() => {
        sub.remove()
        progressModalRef.current?.setVisible(false)
        setExportProgress(null)
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

  // 设置页是虚拟长列表：本组件滚入可视区才挂载、滚远会卸载。挂载即统计一次，
  // 并在存活期间每 2s 刷新，保证“先开过设置、再去分离歌曲、回到本页”时不会停留在
  // 旧的“已分离 0 首 / 0B”。扫描目录极小，开销可忽略；卸载即清理定时器。
  useEffect(() => {
    refresh()
    const timer = setInterval(() => { refresh() }, 2000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {/* 导出进度弹窗：后台压缩不卡 UI，圆角卡片 + 进度条 */}
      <Modal ref={progressModalRef} keyHide={false} bgHide={false} bgColor="rgba(0,0,0,0.55)">
        <View style={styles.modalWrap}>
          <View style={[styles.progressCard, { backgroundColor: theme['c-content-background'] }]}>
            <Text style={styles.progressTitle} size={16} color={theme['c-font']} bold>
              正在导出缓存
            </Text>
            <Text style={styles.progressDesc} size={12} color={theme['c-font-label']}>
              {exportProgress?.currentFile
                ? `正在打包 ${exportProgress.currentFile}`
                : '正在准备…'}
            </Text>

            {/* 进度条 */}
            <View style={[styles.progressTrack, { backgroundColor: theme['c-primary-light-100'] }]}>
              <View
                style={{
                  width: `${Math.max(2, Math.round((exportProgress?.progress ?? 0) * 100))}%`,
                  height: '100%',
                  borderRadius: 4,
                  backgroundColor: theme['c-primary'],
                }}
              />
            </View>

            <View style={styles.progressMeta}>
              <Text size={12} color={theme['c-primary']} bold>
                {Math.round((exportProgress?.progress ?? 0) * 100)}%
              </Text>
              <Text size={11} color={theme['c-font-label']}>
                {sizeFormate(exportProgress?.written ?? 0)} / {sizeFormate(exportProgress?.total ?? 0)}
              </Text>
            </View>
          </View>
        </View>
      </Modal>
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
  modalWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  progressCard: {
    width: '100%',
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  progressTitle: {
    marginBottom: 4,
  },
  progressDesc: {
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressMeta: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
})
