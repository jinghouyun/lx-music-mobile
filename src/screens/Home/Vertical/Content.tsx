import { useRef } from 'react'
import DrawerLayoutFixed from '@/components/common/DrawerLayoutFixed'
import Header from './Header'
import DrawerNav from './DrawerNav'
import Main from './Main'
import { createStyle } from '@/utils/tools'

const styles = createStyle({
  container: {
    flex: 1,
  },
})

const Content = () => {
  const drawerRef = useRef<DrawerLayoutFixed>(null)

  return (
    <DrawerLayoutFixed
      ref={drawerRef}
      drawerWidth={280}
      drawerPosition="left"
      drawerBackgroundColor="rgba(0,0,0,0)"
      renderNavigationView={() => <DrawerNav onShowDrawer={() => drawerRef.current?.closeDrawer()} />}
    >
      <>
        <Header onShowDrawer={() => drawerRef.current?.openDrawer()} />
        <Main />
      </>
    </DrawerLayoutFixed>
  )
}

export default Content
