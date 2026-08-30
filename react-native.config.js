/**
 * React Native CLI 自动链接修正配置
 *
 * react-native-nitro-onnxruntime 是 Nitro(nitrogen) 生成的库，CLI 按 npm 包名猜测出的
 * Android 包路径 com.nitroonnxruntime.NitroOnnxruntimePackage 是错误的，真实类位于
 * com.margelo.nitro.nitroonnxruntime 包下。这里显式钉死两个 Nitro 库的导入路径与实例化，
 * 避免生成的 PackageList 引用不存在的类而编译失败。
 */
const nitroDeps = {
  'react-native-nitro-modules': {
    platforms: {
      android: {
        packageImportPath:
          'import com.margelo.nitro.NitroModulesPackage;',
        packageInstance: 'new NitroModulesPackage()',
      },
    },
  },
  'react-native-nitro-onnxruntime': {
    platforms: {
      android: {
        packageImportPath:
          'import com.margelo.nitro.nitroonnxruntime.NitroOnnxruntimePackage;',
        packageInstance: 'new NitroOnnxruntimePackage()',
      },
    },
  },
}

module.exports = {
  dependencies: nitroDeps,
}
