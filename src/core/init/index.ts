import { initSetting } from '@/core/common'
import registerPlaybackService from '@/plugins/player/service'
import initTheme from './theme'
import initI18n from './i18n'
import initUserApi from './userApi'
import initPlayer from './player'
import dataInit from './dataInit'
import initSync from './sync'
import initCommonState from './common'
import { initDeeplink } from './deeplink'
import { initDownloadTasks } from '@/core/download'
import { setApiSource } from '@/core/apiSource'
import commonActions from '@/store/common/action'
import { checkUpdate } from '@/core/version'
import { bootLog } from '@/utils/bootLog'
import { state as userApiState } from '@/store/userApi/state'
import { updateSetting } from '@/core/common'

let isFirstPush = true
const handlePushedHomeScreen = async() => {
  // 已移除：启动「谨防被骗」弹窗与「许可协议」签署弹窗，进入首页直接初始化
  if (isFirstPush) {
    isFirstPush = false
    void checkUpdate()
    void initDeeplink()
  }
}

let isInited = false
export default async() => {
  if (isInited) return handlePushedHomeScreen
  bootLog('Initing...')
  commonActions.setFontSize(global.lx.fontSize)
  bootLog('Font size changed.')
  const setting = await initSetting()
  bootLog('Setting inited.')

  await initTheme(setting)
  bootLog('Theme inited.')
  await initI18n(setting)
  bootLog('I18n inited.')

  await initUserApi(setting)
  bootLog('User Api inited.')

  // 全新安装/重置后音源为空，或已选音源已被删除/失效时，自动选中第一个可用音源，
  // 做到“打开就能听”，无需手动去音源选择里点选。
  let apiSource = setting['common.apiSource']
  const apiList = userApiState.list
  const currentApi = apiList.find(a => a.id === apiSource)
  // 跳过已宕机的中转音源（六音/野花/野草依赖的中转服务器已离线）
  const isDeadSource = !!currentApi && ['六音', '野花', '野草'].some(n => currentApi.name.includes(n))
  const isCurrentValid = !!apiSource && !!currentApi && !isDeadSource
  if (!isCurrentValid && apiList.length) {
    // 优先 Free listen（纯平台直连，不依赖第三方中转服务器，最稳定）
    const preferred = apiList.find(a => a.name.includes('Free listen')) ?? apiList.find(a => !['六音', '野花', '野草'].some(n => a.name.includes(n))) ?? apiList[0]
    apiSource = preferred.id
    setting['common.apiSource'] = apiSource
    await updateSetting({ 'common.apiSource': apiSource })
    bootLog(`Auto selected api source: ${preferred.name}`)
  }
  setApiSource(apiSource)
  bootLog('Api inited.')

  registerPlaybackService()
  bootLog('Playback Service Registered.')
  await initPlayer(setting)
  bootLog('Player inited.')
  const { initVocalSeparation } = await import('@/core/vocalSeparation')
  await initVocalSeparation()
  bootLog('Vocal separation inited.')
  await dataInit(setting)
  bootLog('Data inited.')
  await initCommonState(setting)
  bootLog('Common State inited.')

  void initDownloadTasks()
  bootLog('Download tasks inited.')

  void initSync(setting)
  bootLog('Sync inited.')

  isInited ||= true

  return handlePushedHomeScreen
}
