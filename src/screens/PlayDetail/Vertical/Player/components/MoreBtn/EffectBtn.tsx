import { memo, useRef } from 'react'
import EffectPanel, { type EffectPanelType } from '@/components/player/EffectPanel'
import { useTheme } from '@/store/theme/hook'
import Btn from './Btn'


export default memo(() => {
  const theme = useTheme()
  const panelRef = useRef<EffectPanelType>(null)

  const handleShow = () => {
    panelRef.current?.show()
  }

  return (
    <>
      <Btn icon="slider" color={theme['c-font-label']} onPress={handleShow} />
      <EffectPanel ref={panelRef} />
    </>
  )
})
