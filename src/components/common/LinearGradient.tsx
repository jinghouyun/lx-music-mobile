import { memo, useMemo } from 'react'
import { View, type ViewStyle, type StyleProp } from 'react-native'

/**
 * 轻量级垂直渐变组件：多层半透明色块叠加模拟线性渐变，无原生依赖
 * 用于播放页红色渐变背景等场景
 */
interface LinearGradientProps {
  colors: string[] // 从上到下的颜色数组，至少 2 个
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
}

const LAYERS = 20

// 解析 rgb()/rgba()/hex 颜色为 {r,g,b}
const parseColor = (color: string): { r: number, g: number, b: number } | null => {
  if (color.startsWith('rgb')) {
    const m = color.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/)
    if (m) return { r: +m[1], g: +m[2], b: +m[3] }
    return null
  }
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 3) return { r: parseInt(hex[0] + hex[0], 16), g: parseInt(hex[1] + hex[1], 16), b: parseInt(hex[2] + hex[2], 16) }
    if (hex.length === 6) return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }
    return null
  }
  return null
}

const toRgb = (r: number, g: number, b: number) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`

export const LinearGradient = memo(({ colors, style, children }: LinearGradientProps) => {
  const layers = useMemo(() => {
    if (colors.length < 2) return [] as string[]
    const parsed = colors.map(parseColor)
    if (parsed.some(c => !c)) return [] as string[]
    const result: string[] = []
    for (let i = 0; i < LAYERS; i++) {
      const t = i / (LAYERS - 1)
      const seg = t * (colors.length - 1)
      const idx = Math.min(Math.floor(seg), colors.length - 2)
      const local = seg - idx
      const c1 = parsed[idx]!
      const c2 = parsed[idx + 1]!
      result.push(toRgb(c1.r + (c2.r - c1.r) * local, c1.g + (c2.g - c1.g) * local, c1.b + (c2.b - c1.b) * local))
    }
    return result
  }, [colors])

  if (!layers.length) return <View style={style}>{children}</View>

  return (
    <View style={[style, { overflow: 'hidden' }]}>
      {layers.map((bg, i) => (
        <View key={i} pointerEvents="none" style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: `${(i / LAYERS) * 100}%`,
          height: `${(100 / LAYERS) + 0.6}%`,
          backgroundColor: bg,
        }} />
      ))}
      {children}
    </View>
  )
})

export default LinearGradient
