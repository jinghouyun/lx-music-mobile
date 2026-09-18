import Header from './Header'
import Main from './Main'
import { View } from 'react-native'
import { createStyle } from '@/utils/tools'

const styles = createStyle({
  container: {
    flex: 1,
  },
})

const Content = () => {
  return (
    <View style={styles.container}>
      <Header />
      <Main />
    </View>
  )
}

export default Content
