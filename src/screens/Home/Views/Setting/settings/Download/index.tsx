import { memo } from 'react'
import { View, TouchableOpacity } from 'react-native'
import Section from '../../components/Section'
import SubTitle from '../../components/SubTitle'
import CheckBoxItem from '../../components/CheckBoxItem'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'

const FileNameSetting = memo(() => {
  const t = useI18n()
  const fileName = useSettingValue('download.fileName')
  const options: Array<{ value: '歌名 - 歌手' | '歌手 - 歌名' | '歌名', label: string }> = [
    { value: '歌名 - 歌手', label: '歌名 - 歌手' },
    { value: '歌手 - 歌名', label: '歌手 - 歌名' },
    { value: '歌名', label: '歌名' },
  ]
  return (
    <SubTitle title={t('setting_download_name')}>
      {options.map(opt => (
        <CheckBoxItem
          key={opt.value}
          check={fileName === opt.value}
          label={opt.label}
          onChange={() => { updateSetting({ 'download.fileName': opt.value }) }}
        />
      ))}
    </SubTitle>
  )
})

const MaxDownloadNumSetting = memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const maxNum = useSettingValue('download.maxDownloadNum')
  const nums = [1, 2, 3, 4, 5, 6]
  return (
    <SubTitle title={t('setting_download_max_num')}>
      <View style={styles.numRow}>
        {nums.map(n => (
          <TouchableOpacity
            key={n}
            onPress={() => { updateSetting({ 'download.maxDownloadNum': n }) }}
            style={[styles.numBtn, {
              borderColor: maxNum === n ? theme['c-primary'] : theme['c-border-background'],
              backgroundColor: maxNum === n ? theme['c-primary'] : 'transparent',
            }]}
          >
            <Text size={13} color={maxNum === n ? theme['c-primary-font-active'] : theme['c-font']}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SubTitle>
  )
})

const SkipExistSetting = memo(() => {
  const t = useI18n()
  const skip = useSettingValue('download.skipExistFile')
  return (
    <CheckBoxItem
      check={skip}
      label={t('setting_download_skip_exist')}
      onChange={val => { updateSetting({ 'download.skipExistFile': val }) }}
    />
  )
})

const UseOtherSourceSetting = memo(() => {
  const t = useI18n()
  const val = useSettingValue('download.isUseOtherSource')
  return (
    <CheckBoxItem
      check={val}
      label={t('setting_download_use_other_source')}
      onChange={v => { updateSetting({ 'download.isUseOtherSource': v }) }}
    />
  )
})

const EmbedPicSetting = memo(() => {
  const t = useI18n()
  const val = useSettingValue('download.isEmbedPic')
  return (
    <CheckBoxItem
      check={val}
      label={t('setting_download_embed_pic')}
      onChange={v => { updateSetting({ 'download.isEmbedPic': v }) }}
    />
  )
})

const DownloadLrcSetting = memo(() => {
  const t = useI18n()
  const enabled = useSettingValue('download.isDownloadLrc')
  const tLrc = useSettingValue('download.isDownloadTLrc')
  const rLrc = useSettingValue('download.isDownloadRLrc')
  const lxLrc = useSettingValue('download.isDownloadLxLrc')
  return (
    <SubTitle title={t('setting_download_lyric')}>
      <CheckBoxItem
        check={enabled}
        label={t('setting_download_is_enable')}
        onChange={v => { updateSetting({ 'download.isDownloadLrc': v }) }}
      />
      {enabled ? (
        <>
          <CheckBoxItem
            check={tLrc}
            label={t('setting_download_tlyric')}
            onChange={v => { updateSetting({ 'download.isDownloadTLrc': v }) }}
          />
          <CheckBoxItem
            check={rLrc}
            label={t('setting_download_rlyric')}
            onChange={v => { updateSetting({ 'download.isDownloadRLrc': v }) }}
          />
          <CheckBoxItem
            check={lxLrc}
            label={t('setting_download_lxlyric')}
            onChange={v => { updateSetting({ 'download.isDownloadLxLrc': v }) }}
          />
        </>
      ) : null}
    </SubTitle>
  )
})

export default memo(() => {
  const t = useI18n()
  return (
    <Section title={t('setting_download')}>
      <FileNameSetting />
      <MaxDownloadNumSetting />
      <View style={styles.checkGroup}>
        <SkipExistSetting />
        <UseOtherSourceSetting />
        <EmbedPicSetting />
      </View>
      <DownloadLrcSetting />
    </Section>
  )
})

const styles = createStyle({
  numRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingLeft: 15,
  },
  numBtn: {
    width: 40,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    marginBottom: 8,
  },
  checkGroup: {
    marginBottom: 10,
  },
})
