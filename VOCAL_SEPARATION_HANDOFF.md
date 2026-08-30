# 落雪音乐移动端 · 人声分离功能 交接文档（Handoff）

> 本文档用于无缝接续开发。最后更新：阶段 1（依赖集成与原生环境配置）进行中。
> 阅读顺序：先看「0. 一句话现状」→「4. 下一步精确操作」。

---

## 0. 一句话现状

要在 **lx-music-mobile（React Native 0.73.11，老架构 Paper/Hermes）** 里加「人声分离」（htdemucs_ft / Demucs v4，ONNX Runtime + react-native-nitro-onnxruntime）。
**阶段 1 的代码改动已全部完成并落在本分支，但「本地真实编译 arm64 通过」这一步尚未跑完**（卡在本地环境装 SDK，与代码无关）。代码**还没合并/推送到 main，CI 还没跑过带依赖的构建**。

- 本分支名：`feat/vocal-separation-phase1`（基于 main，**不要直接推 main，先本地或 CI 验证编译**）
- main 上最近一次构建是成功的（未含本次依赖）。

---

## 1. 仓库与 APK 交付流水线（每次改完都要产出手机可下载直链）

- 仓库：https://github.com/jinghouyun/lx-music-mobile ，默认分支 `main`，applicationId=`com.kugou.android`
- 推送（用用户提供的 Token，下面用 `<TOKEN>` 占位，勿写进任何提交文件）：
  - `git push https://<TOKEN>@github.com/jinghouyun/lx-music-mobile.git main`
- 推 main 后自动触发 workflow **Android Build**（`.github/workflows/android-build.yml`，ubuntu + Node20 + JDK17，`cd android && ./gradlew assembleRelease`，产物 `app-release` 为所有 APK）。
- 查构建状态：
  - `curl -H "Authorization: token <TOKEN>" "https://api.github.com/repos/jinghouyun/lx-music-mobile/actions/runs?per_page=1"`
- 构建成功后取 artifact：下载 `app-release` zip → 解压 → 取 **arm64-v8a** 那个 APK（文件名形如 `lx-music-mobile-v1.8.4-arm64-v8a.apk`，版本号随 package.json）→ 重命名为 `app.apk`。
- 推到 `apk` 孤儿分支（该分支已存在，根目录就是 app.apk，用强推保持单文件）：
  ```bash
  mkdir apk-dist && cd apk-dist
  git init -b apk 2>/dev/null || { git init && git checkout -b apk; }
  # 复制 app.apk 到此处
  git add app.apk && git commit -m "apk"
  git push -f https://<TOKEN>@github.com/jinghouyun/lx-music-mobile.git apk
  ```
- 交付直链（gh-proxy，发用户前用 `curl -sI` 校验 HTTP 200 且 content-length 与文件字节一致）：
  - `https://gh-proxy.com/https://github.com/jinghouyun/lx-music-mobile/raw/apk/app.apk`
- 另有 `apk-dist` 分支是历史遗留，本任务统一只用 `apk` 分支。
- **快捷方式**：已新增 workflow `Deploy APK to apk branch`（`.github/workflows/deploy-apk.yml`），可手动触发，传入 Android Build 的 run_id，自动在 CI 内下载 artifact → 取 arm64 APK → 强推 apk 分支，省去本地下载上传的时间。

---

## 2. 总体分阶段计划（每阶段完成后等用户确认再进下一阶段）

1. **阶段 1（当前）**：ONNX Runtime + react-native-nitro-onnxruntime + nitro-modules 依赖集成、原生构建配置，**确保编译通过**，产出可安装 APK（界面暂无变化）。
2. 阶段 2：JS/TS 层 ONNX Runtime 初始化封装、模型加载（内置/下载）、htdemucs_ft 推理管线（重采样 44.1k、分块、4 stem 取 vocals、与播放链路对接）。
3. 阶段 3：播放页 UI——底部功能栏「LRC / 收藏 / 循环 / 评论」之间，在**循环和评论之间**插入第 5 个图标「人声」（品牌绿，未激活灰色），点击弹「人声分离中…/已为人声模式/恢复原声」状态。
4. 阶段 4：环形缓冲（4–8s，起步 4s）、播放进度同步、低延迟与无缝切换、取消/异常回退原声。
5. 阶段 5：性能/内存/耗电优化（NNAPI/NPU 优先、CPU 回退、线程数）、真机调优、验收。

### 播放页现状（来自用户截图，供阶段 3）
- 顶部：返回、歌名/歌手、右侧定时退出(timer)+设置(sliders)。
- 中部封面；进度条；上一首/播放/下一首（品牌绿，约 `#3BA966`，实现时取主题变量，不要写死）。
- 底部功能栏 4 图标：`LRC`、`♥收藏`、`循环`、`评论`——「人声」插在**循环与评论之间**。
- 相关源码在 `src/screens/Play` 或 `src/components/player*` 一带（阶段 3 再精确定位，本阶段不要改 UI）。

---

## 3. 项目关键事实档案（避免重新踩坑/误判）

- **RN `0.73.11` / React 18.2.0；`newArchEnabled=false`（老架构 Paper）；Hermes 开启**。导航用 Wix `react-native-navigation@7.39.2`（不是 RN 官方导航）。用 `patch-package`（postinstall 会自动打 `patches/react-native-track-player+2.1.2.patch`）。
- 安卓构建：Gradle 8.8、AGP 8.6.1、**JDK 17 必需**、Kotlin 1.9.24、NDK `26.1.10909125`、CMake 3.22.1；minSdk 21、compileSdk 36、targetSdk 29、buildTools 35.0.0。
- `android/app/build.gradle`：`enableSeparateBuildPerCPUArchitecture=true` + `universalApk=true`，按 ABI 分包；release **开启了 minify/proguard**；release 用 debug.keystore 签名（keystore.properties 指向 debug.keystore，CI 会临时生成该文件）。
- `MainApplication.java` 用 `new PackageList(this).getPackages()` 自动链接，原生包一般无需手写注册。
- Node 要求 >=18；CI 用 Node 20（本地 Node 22 也能跑通 `react-native config`）。

### 关于这套 ONNX 技术栈与老架构兼容性（已静态确认，但仍需实编）
- `react-native-nitro-onnxruntime@0.1.1`：用 nitrogen 0.35 / RN 0.78 生成，Android 是 **C++/CMake/prefab** 库；编译期从 AAR `com.microsoft.onnxruntime:onnxruntime-android:1.21.0` 抽 `headers/` 和 `jni/<abi>/libonnxruntime.so`，自己编出 `libnitroonnxruntime.so`。
- `react-native-nitro-modules` **必须锁 `0.35.0`**（与上面封装库生成时的 C++ ABI 对齐；不要升 0.37，否则 C++ 接口对不上）。
- 好消息：nitro-modules 0.35 自带 `src/oldarch` 老架构 Kotlin 源码集，CMake 里专门有 `ReactAndroid_VERSION_MINOR < 76` 的 prefab 分支（链接 `ReactAndroid::react_nativemodule_core` + `turbomodulejsijni`），C++ 只 include RN0.73 就有的稳定头（jsi、ReactCommon/CallInvoker、fbjni）。**静态判断可在 RN0.73 老架构编译，但必须真实编译一次确认。**

---

## 4. 阶段 1 已完成的改动（本分支工作区，已提交）

> 只动了构建/依赖，**没有改任何业务/UI 代码，没有写推理代码**。

1. **`package.json`**
   - dependencies 增加：`"react-native-nitro-modules": "0.35.0"`、`"react-native-nitro-onnxruntime": "0.1.1"`。
   - overrides 增加 `"onnxruntime-common": "1.21.0"`：把传递依赖锁到与原生运行库一致（否则会被解析成最新 1.29.x）。
   - `package-lock.json` 已随之更新（一起提交）。
2. **新增 `react-native.config.js`（项目根）**：显式钉死两个 Nitro 库的 Android 自动链接路径。
   - 原因：RN CLI 会把 onnxruntime 包的类路径**猜错**成 `com.nitroonnxruntime.NitroOnnxruntimePackage`，真实类是 `com.margelo.nitro.nitroonnxruntime.NitroOnnxruntimePackage`（nitro-modules 的 `com.margelo.nitro.NitroModulesPackage` CLI 猜对了，但也一并钉死更稳）。不配这个会在编译期 import 不到类。
3. **`android/gradle.properties`**：`reactNativeArchitectures` 由 4 架构改为 `armeabi-v7a,arm64-v8a`（只打真机，省体积/时间）。
4. **`android/app/build.gradle`** dependencies 增加 `implementation 'com.microsoft.onnxruntime:onnxruntime-android:1.21.0'`（带中文注释说明 NNAPI/版本对齐/为何 app 必须显式依赖）。
   - 关键原因：**封装库自身只在 CMake 链接 `libonnxruntime.so`，并不把它打进自己的 AAR**；最终 APK 必须由 app 依赖该 AAR 才会包含 `jni/<abi>/libonnxruntime.so`，否则运行时 `dlopen` 失败。NNAPI EP 内置于完整版 `onnxruntime-android`（不是 onnxruntime-mobile），运行时再通过 SessionOptions 开启、失败回退 CPU。
5. **`android/app/proguard-rules.pro`**：增加 `-keep class com.margelo.nitro.** { *; }`、`-keep class ai.onnxruntime.** { *; }` 等 keep/dontwarn（release 开了混淆，JNI 按类名反射不能被裁）。

### 已经验证过的点
- `npm install` 干净安装成功（926 包），patch-package 正常打上 RNTP 补丁。
- `npx react-native config` 退出码 0，且两个 nitro 包的 `packageImportPath/packageInstance` 已正确：
  - `import com.margelo.nitro.NitroModulesPackage;` / `new NitroModulesPackage()`
  - `import com.margelo.nitro.nitroonnxruntime.NitroOnnxruntimePackage;` / `new NitroOnnxruntimePackage()`
- onnxruntime-common 实际落地版本 = 1.21.0（override 生效）。

### 阶段 1 已完成（2026-08-30）
- [x] **CI 真实编译通过**：Android Build workflow 成功（Run ID: 33311494983），C++/prefab/老架构/Kotlin 全部编过。
- [x] APK 内确认包含 `lib/arm64-v8a/libonnxruntime.so`（~18MB）、`libNitroModules.so`（~1MB）、`libnitroonnxruntime.so`（~0.6MB）。
- [x] 已推 main → Android Build 成功 → arm64 APK 改名 app.apk → 强推 apk 分支 → gh-proxy 直链校验通过。
- [x] 修复了 3 处 RN 0.73 老架构兼容问题（用 patch-package 持久化，见 `patches/react-native-nitro-modules+0.35.0.patch`）：
  1. AndroidManifest 添加 `tools:overrideLibrary="ai.onnxruntime"` 解决 minSdk 冲突（app 21 vs onnxruntime 24）。
  2. Kotlin：`BaseReactPackage` → `TurboReactPackage`；`jsCallInvokerHolder` → `catalystInstance?.jsCallInvokerHolder`；`ReactModuleInfo` 命名参数改位置参数。
  3. C++：注释掉 `setExternalMemoryPressure` 调用（RN 0.73 的 JSI 没有这个方法，0.76+ 才加）。

---

## 5. 已踩过的坑（务必规避，省大量时间）

1. **npm 安装中途被 SIGTERM 杀掉会留下 0 字节残缺文件**（本次出现 139 个，含 `commander/lib/argument.js` 0 字节 → `react-native config` 报 `Argument is not a constructor`）。现象诡异但根因是残缺。处理：删 node_modules 干净重装。
   - 在本类 virtiofs 存储上 `rm -rf node_modules` 删海量小文件**极慢**（>6 分钟）。更快做法：`mv node_modules .trash_$$`（瞬时改名）→ 立即重装 → 后台慢慢 `rm -rf .trash_*`。
2. **不要升级 nitro-modules**：封装库 peer 要 `^0.35.0`，C++ ABI 必须匹配，固定 0.35.0。
3. **onnxruntime 版本三处要一致 1.21.0**：app 的 `onnxruntime-android:1.21.0`、封装库编译期抽头文件的也是 1.21.0、JS 的 onnxruntime-common override 到 1.21.0。
4. 自动链接类路径问题已用 `react-native.config.js` 解决，别再改 node_modules（重装会丢），根目录配置才持久。
5. 本地沙箱访问 dl.google.com 下载 **platform-36 会在 ~21% 损坏**（sdkmanager 报 `Error on ZipFile unknown archive`，重试多次都坏）。可靠办法：用 curl 断点续传手动下，再解压进 SDK：
   ```bash
   curl -L -C - --retry 5 --retry-all-errors -o platform-36.zip https://dl.google.com/android/repository/platform-36_r02.zip
   unzip -tq platform-36.zip   # 必须 ZIP_OK
   unzip -oq platform-36.zip -d $ANDROID_HOME/platforms   # 直接解出 platforms/android-36
   ```
   （virtiofs 上解压大量小文件很慢，耐心等；CI 网络正常，不受此影响。）
6. **react-native-nitro-modules 0.35.0 与 RN 0.73 有 3 处不兼容**（已用 patch-package 修复，`patches/react-native-nitro-modules+0.35.0.patch`）：
   - Kotlin：`BaseReactPackage` 在 RN 0.73 中不存在，改用 `TurboReactPackage`。
   - Kotlin：`ReactApplicationContext.jsCallInvokerHolder` 不存在，需从 `catalystInstance?.jsCallInvokerHolder` 取。
   - Kotlin：`ReactModuleInfo` 构造函数不支持命名参数，改用位置参数。
   - C++：`jsi::Object::setExternalMemoryPressure` 在 RN 0.73 中不存在（0.76+ 才有），注释掉不影响功能，只是 GC 内存压力提示没了。
7. **minSdkVersion 冲突**：`onnxruntime-android:1.21.0` 要求 minSdk 24，但项目是 21。解决：AndroidManifest 加 `<uses-sdk tools:overrideLibrary="ai.onnxruntime" />`。ONNX Runtime 实际在 API 21 上也能跑（核心 JNI 层兼容），只是官方声明支持 24+。

---

## 6. 本地编译环境（新机器从零搭；若嫌慢可直接走 CI，见末尾）

工具装在仓库外目录（例如 `~/tools`），不进 git：
```bash
# JDK17（无 root 就下便携版 Temurin17 tar.xz/tar.gz 解压）
# Android commandline-tools: https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
# 解压到 $ANDROID_HOME/cmdline-tools/latest
export JAVA_HOME=~/tools/jdk17
export ANDROID_HOME=~/tools/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0" \
           "ndk;26.1.10909125" "cmake;3.22.1"
# platform-36 若下载损坏，按第 5 节用 curl 手动装
```
仓库内（这两个文件已被 .gitignore，只本地用）：
- `android/local.properties` 写 `sdk.dir=<绝对路径>/android-sdk`
- `android/keystore.properties`：
  ```
  storeFile=debug.keystore
  storePassword=android
  keyAlias=androiddebugkey
  keyPassword=android
  ```

依赖与编译（**只编 arm64 一个 ABI** 省内存/时间；小内存机器限制堆和并发）：
```bash
npm install --no-audit --no-fund        # 首次，确保无 0 字节残缺
cd android
./gradlew :app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  -Dorg.gradle.jvmargs="-Xmx2048m -XX:MaxMetaspaceSize=1024m" \
  --max-workers=2 --no-daemon
```
产物：`android/app/build/outputs/apk/release/lx-music-mobile-v<ver>-arm64-v8a.apk`。
编译通过后务必解包检查三个 so 是否都在：
`unzip -l <apk> | grep -E "onnxruntime|Nitro"`，应能看到 `libonnxruntime.so`、`libNitroModules.so`、`libnitroonnxruntime.so`（arm64-v8a 与 armeabi-v7a 各一套）。

### 可能出现的问题与预案（真实编译时对照）
- 报找不到 prefab `ReactAndroid` / `react-native-nitro-modules`：确认是老架构且 autolinking 已包含两库；必要时在 app `build.gradle` 的 android{} 内确认 `buildFeatures { prefab true }`（库模块自带，app 一般不用）。
- 报 `libonnxruntime.so` 重复（2 files found）：在 app android{} 加 `packagingOptions { pickFirsts += ['**/libonnxruntime.so'] }`（按当前分析不会重复，真遇到再加）。
- C++ 用到 RN0.76+ API 编译失败：说明 nitro 0.35 对 0.73 有个别不兼容，优先用 patch-package 给 node_modules/react-native-nitro-modules 打补丁，不要升级 RN（升级 RN 风险极大，RNN 和多个 github fork 依赖会崩）。
- 内存不足 OOM：进一步降到 `--max-workers=1`、`-Xmx1536m`，只编 arm64。

### 省时间替代方案（直接走 CI）
若本地环境搭建太费时，可直接把本分支合并推到 main 让 Actions 编（CI 是标准 ubuntu，网络正常），失败就读 Actions 日志按上面预案改，再推。代价是每轮 5–10 分钟。**注意：推 main 即触发正式构建，成功后记得走第 1 节产物→apk 分支→直链流程。**

---

## 7. 阶段 2+ 技术备忘（先不实现，避免提前动代码）

- 模型：Demucs v4 `htdemucs_ft`，输出 4 stem（drums/bass/other/vocals），本需求只取 **vocals**；输入输出采样率 **44100**、双声道；需要固定分块（segment）+ 重叠相加，移动端按算力选 chunk（先小后调）。
- 推理走 `react-native-nitro-onnxruntime`（JS/TS API，底层 ORT 1.21）。ExecutionProvider 优先 **NNAPI**（API27+ / 有 NPU 更佳），不可用回退 CPU；线程数按设备核数限制。
- 模型文件较大（数十~上百 MB），不要打进 JS bundle；放 APP 私有目录，首次用下载或内置拷贝，校验完整性（阶段 2 定方案）。
- 与现有播放器（react-native-track-player 的 fork）对接：环形缓冲 4–8s、人声/原声切换不能跳进度、取消要干净回退原声；**不新增歌单/不改曲库**。
- 状态机：关闭 → 分离中(loading) → 人声模式(可切回原声)；异常一律回退原声并提示，不中断播放。
- UI 严格按截图位置与主题色，不新增页面、不弹全屏。

---

## 8. 本次阶段 1 的验收标准（Definition of Done）
- [ ] main 上 Android Build 为 success。
- [ ] arm64-v8a（及 armeabi-v7a）APK 内包含 libonnxruntime / libNitroModules / libnitroonnxruntime 三个 so。
- [ ] 应用能正常安装、启动、进入播放页，**界面与改动前一致、无崩溃**（阶段1不要求功能按钮）。
- [ ] gh-proxy 直链 HTTP 200、字节数与文件一致，可手机下载。
