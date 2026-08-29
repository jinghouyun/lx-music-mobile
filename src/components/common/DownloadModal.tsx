import { useImperativeHandle, forwardRef, useState, useMemo, useRef } from 'react'
import { View, Text, TouchableOpacity, ScrollView } from 'react-native'
import Modal, { type ModalType } from '@/components/common/Modal'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import {
  createDownloadTask,
  getAvailableQualitys,
  getQualityLabel,
} from '@/core/download'

export interface DownloadModalType {
  show: (musicInfo: LX.Music.MusicInfoOnline) => void
}

export default forwardRef<DownloadModalType>((_props, ref) => {
  const theme = useTheme()
  const modalRef = useRef<ModalType>(null)
  const [musicInfo, setMusicInfo] = useState<LX.Music.MusicInfoOnline | null>(null)

  const qualitys = useMemo(() => {
    if (!musicInfo) return []
    return getAvailableQualitys(musicInfo)
  }, [musicInfo])

  useImperativeHandle(ref, () => ({
    show(info) {
      setMusicInfo(info)
      requestAnimationFrame(() => {
        modalRef.current?.setVisible(true)
      })
    },
  }))

  const handleQualitySelect = async(quality: LX.Quality) => {
    if (!musicInfo) return
    modalRef.current?.setVisible(false)
    await createDownloadTask(musicInfo, quality)
  }

  const styles = createStyle({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    content: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: theme['c-primary-background'],
      borderRadius: 12,
      padding: 20,
      maxHeight: '70%',
    },
    title: {
      fontSize: 15,
      color: theme['c-font'],
      textAlign: 'center',
      marginBottom: 4,
      fontWeight: 'bold',
    },
    subtitle: {
      fontSize: 13,
      color: theme['c-font-label'],
      textAlign: 'center',
      marginBottom: 16,
    },
    qualityBtn: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      backgroundColor: theme['c-primary-background'],
      marginBottom: 8,
    },
    qualityText: {
      fontSize: 14,
      color: theme['c-font'],
      textAlign: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: theme['c-font-label'],
      textAlign: 'center',
      paddingVertical: 20,
    },
  })

  return (
    <Modal
      ref={modalRef}
      bgColor="rgba(0,0,0,0.5)"
    >
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title} numberOfLines={1}>{musicInfo?.name ?? ''}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{musicInfo?.singer ?? ''}</Text>
          <ScrollView>
            {qualitys.length > 0 ? (
              qualitys.map(quality => (
                <TouchableOpacity
                  key={quality}
                  style={styles.qualityBtn}
                  onPress={() => { void handleQualitySelect(quality) }}
                >
                  <Text style={styles.qualityText}>{getQualityLabel(quality)}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.emptyText}>暂无可下载音质</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
})
