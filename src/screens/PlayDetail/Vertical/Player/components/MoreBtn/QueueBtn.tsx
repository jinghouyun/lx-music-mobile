import { memo, useRef } from 'react'
import PlayQueuePanel, { type PlayQueuePanelType } from '@/components/player/PlayQueuePanel'
import { useTheme } from '@/store/theme/hook'
import Btn from './Btn'


export default memo(() => {
  const theme = useTheme()
  const panelRef = useRef<PlayQueuePanelType>(null)

  const handleShow = () => {
    panelRef.current?.show()
  }

  return (
    <>
      <Btn icon="menu" color={theme['c-font-label']} onPress={handleShow} />
      <PlayQueuePanel ref={panelRef} />
    </>
  )
})
