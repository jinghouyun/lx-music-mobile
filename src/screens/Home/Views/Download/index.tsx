import { useEffect, useState, useCallback, useMemo } from 'react'
import { View, FlatList, TouchableOpacity, type FlatListProps } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { createStyle, confirmDialog } from '@/utils/tools'
import Text from '@/components/common/Text'
import {
  onDownloadListChange,
  pauseDownloadTasks,
  startDownloadTasks,
  removeDownloadTasks,
  retryDownloadTask,
  formatFileSize,
  getQualityLabel,
  type DownloadTask,
  type DownloadTaskStatus,
} from '@/core/download'
import { useI18n } from '@/lang'
import { Icon } from '@/components/common/Icon'

type TaskItem = DownloadTask
type TaskAction = 'start' | 'pause' | 'retry' | 'remove'

const ERROR_COLOR = '#f56c6c'
const SUCCESS_COLOR = '#67c23a'

const getStatusColor = (status: DownloadTaskStatus, theme: ReturnType<typeof useTheme>): string => {
  switch (status) {
    case 'run': return theme['c-primary-font']
    case 'error': return ERROR_COLOR
    case 'completed': return SUCCESS_COLOR
    default: return theme['c-font-label']
  }
}

const ProgressBar = ({ progress, color }: { progress: number, color: string }) => {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.min(progress, 100)}%`, backgroundColor: color }]} />
    </View>
  )
}

const TaskRow = ({ task, onAction }: {
  task: TaskItem
  onAction: (action: TaskAction, id: string) => void
}) => {
  const theme = useTheme()
  const statusColor = getStatusColor(task.status, theme)

  const handlePress = () => {
    switch (task.status) {
      case 'run':
      case 'waiting':
        onAction('pause', task.id)
        break
      case 'pause':
        onAction('start', task.id)
        break
      case 'error':
        onAction('retry', task.id)
        break
      case 'completed':
        onAction('remove', task.id)
        break
    }
  }

  const actionIcon = useMemo(() => {
    switch (task.status) {
      case 'run':
      case 'waiting': return 'pause'
      case 'pause':
      case 'error': return 'play'
      case 'completed': return 'remove'
      default: return 'play'
    }
  }, [task.status])

  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <Text numberOfLines={1} size={14} color={theme['c-font']}>{task.metadata.musicInfo.name}</Text>
        <Text numberOfLines={1} size={12} color={theme['c-font-label']}>
          {task.metadata.musicInfo.singer} · {getQualityLabel(task.metadata.quality)}
        </Text>
        <View style={styles.progressRow}>
          <ProgressBar progress={task.progress} color={statusColor} />
          <Text size={11} color={theme['c-font-label']} style={styles.progressText}>
            {task.progress.toFixed(1)}%
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text size={11} color={statusColor}>{task.statusText}</Text>
          <Text size={11} color={theme['c-font-label']}>
            {task.total > 0 ? `${formatFileSize(task.downloaded)} / ${formatFileSize(task.total)}` : ''}
            {task.speed ? ` · ${task.speed}` : ''}
          </Text>
        </View>
      </View>
      <View style={styles.rowActions}>
        <TouchableOpacity onPress={handlePress} style={styles.actionBtn}>
          <Icon name={actionIcon} size={20} color={theme['c-primary-font']} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { onAction('remove', task.id) }} style={styles.actionBtn}>
          <Icon name="remove" size={20} color={theme['c-font-label']} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default () => {
  const theme = useTheme()
  const t = useI18n()
  const [tasks, setTasks] = useState<DownloadTask[]>([])

  useEffect(() => {
    const unsub = onDownloadListChange(setTasks)
    return unsub
  }, [])

  const handleAction = useCallback(async(action: TaskAction, id: string) => {
    switch (action) {
      case 'start':
        await startDownloadTasks([id])
        break
      case 'pause':
        pauseDownloadTasks([id])
        break
      case 'retry':
        await retryDownloadTask(id)
        break
      case 'remove': {
        const confirmed = await confirmDialog({
          message: '确定要移除这个下载任务吗？',
          confirmButtonText: t('confirm'),
          cancelButtonText: t('cancel'),
        })
        if (confirmed) await removeDownloadTasks([id])
        break
      }
    }
  }, [t])

  const handleStartAll = useCallback(() => {
    const ids = tasks.filter(item => item.status === 'pause' || item.status === 'error').map(item => item.id)
    if (ids.length) void startDownloadTasks(ids)
  }, [tasks])

  const handlePauseAll = useCallback(() => {
    const ids = tasks.filter(item => item.status === 'run' || item.status === 'waiting').map(item => item.id)
    if (ids.length) pauseDownloadTasks(ids)
  }, [tasks])

  const handleClearCompleted = useCallback(async() => {
    const completed = tasks.filter(item => item.status === 'completed')
    if (!completed.length) return
    const confirmed = await confirmDialog({
      message: `确定要清空 ${completed.length} 个已完成的任务吗？`,
      confirmButtonText: t('confirm'),
      cancelButtonText: t('cancel'),
    })
    if (confirmed) await removeDownloadTasks(completed.map(item => item.id))
  }, [tasks, t])

  const renderItem: FlatListProps<DownloadTask>['renderItem'] = ({ item }) => (
    <TaskRow task={item} onAction={handleAction} />
  )

  const runningCount = tasks.filter(item => item.status === 'run' || item.status === 'waiting').length

  return (
    <View style={styles.container}>
      <View style={[styles.toolbar, { borderBottomColor: theme['c-border-background'] }]}>
        <Text size={13} color={theme['c-font-label']}>
          {tasks.length ? `共 ${tasks.length} 个任务${runningCount ? ` · ${runningCount} 个进行中` : ''}` : '暂无下载任务'}
        </Text>
        <View style={styles.toolbarActions}>
          <TouchableOpacity onPress={handleStartAll} style={styles.toolbarBtn}>
            <Text size={13} color={theme['c-primary-font']}>全部开始</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handlePauseAll} style={styles.toolbarBtn}>
            <Text size={13} color={theme['c-primary-font']}>全部暂停</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { void handleClearCompleted() }} style={styles.toolbarBtn}>
            <Text size={13} color={theme['c-font-label']}>清空完成</Text>
          </TouchableOpacity>
        </View>
      </View>
      <FlatList
        data={tasks}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text size={14} color={theme['c-font-label']}>在歌曲菜单中选择「下载」即可开始</Text>
          </View>
        }
      />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
  },
  toolbarActions: {
    flexDirection: 'row',
  },
  toolbarBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowInfo: {
    flex: 1,
    paddingRight: 8,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(128,128,128,0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    marginLeft: 8,
    minWidth: 44,
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  rowActions: {
    flexDirection: 'row',
  },
  actionBtn: {
    padding: 8,
  },
  empty: {
    paddingTop: 80,
    alignItems: 'center',
  },
})
