package com.apple.android.music.vocalsep

/** 用户主动取消（切歌/切回原唱）时抛出，不作为错误提示给用户 */
class SeparationCancelledException : Exception("separation cancelled")
