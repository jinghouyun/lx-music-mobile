import { memo, useMemo } from 'react'
import { View, TouchableOpacity } from 'react-native'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'

export interface AlphabetIndexType {
  /** 歌曲列表 -> 每个字母对应的行 index（除以行数取整） */
  sections: Map<string, number>
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/**
 * 右侧 A-Z# 字母索引条（对齐 Salt Player 歌曲列表）
 * 中文歌名归入 #；点击跳到对应歌曲
 */
export default memo(({ sections, onPress }: {
  sections: AlphabetIndexType['sections']
  onPress: (letter: string) => void
}) => {
  const theme = useTheme()

  const items = useMemo(() => {
    return [...LETTERS, '#'].map(letter => ({
      letter,
      active: sections.has(letter),
    }))
  }, [sections])

  return (
    <View style={styles.container}>
      {items.map(({ letter, active }) => (
        <TouchableOpacity
          key={letter}
          style={styles.item}
          onPress={() => onPress(letter)}
          disabled={!active}
          hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
        >
          <Text size={9} color={active ? theme['c-primary'] : 'rgba(0,0,0,0)'}>{letter}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
})

const styles = createStyle({
  container: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 20,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  item: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    maxHeight: 16,
  },
})
