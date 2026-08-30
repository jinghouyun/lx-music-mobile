package com.kugou.android.vivo;

import android.net.Uri;
import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.session.MediaSessionCompat;
import androidx.media.MediaBrowserServiceCompat;

import com.guichaguri.trackplayer.service.MediaSessionHolder;

import java.util.ArrayList;
import java.util.List;

/**
 * 给 vivo 原子随身听（及其他系统媒体浏览器）暴露浏览树：
 * root
 *  ├─ 播放列表（当前试听队列）
 *  ├─ 收藏列表（我喜欢）
 *  └─ 下载列表（下载任务）
 * 点击歌曲时复用 RNTP 的 MediaSession（onPlayFromMediaId -> remote-play-id -> JS）。
 */
public class VivoMediaBrowserService extends MediaBrowserServiceCompat implements MediaSessionHolder.Listener {

    @Override
    public void onCreate() {
        super.onCreate();
        VivoBrowserRepository.register(this);
        MediaSessionHolder.addListener(this);
    }

    @Override
    public void onDestroy() {
        MediaSessionHolder.removeListener(this);
        VivoBrowserRepository.unregister(this);
        super.onDestroy();
    }

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        // 共享 RNTP 播放服务的 MediaSession，保证面板里的播放控制与点歌走同一会话
        attachSessionToken();
        return new BrowserRoot(VivoBrowserRepository.ROOT_ID, null);
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowserCompat.MediaItem>> result) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        if (VivoBrowserRepository.ROOT_ID.equals(parentId)) {
            items.add(buildTab(VivoBrowserRepository.TAB_PLAYLIST, VivoBrowserRepository.TITLE_PLAYLIST));
            items.add(buildTab(VivoBrowserRepository.TAB_FAVORITE, VivoBrowserRepository.TITLE_FAVORITE));
            items.add(buildTab(VivoBrowserRepository.TAB_DOWNLOAD, VivoBrowserRepository.TITLE_DOWNLOAD));
        } else {
            for (Bundle song : VivoBrowserRepository.getChildren(parentId)) {
                items.add(buildSong(song));
            }
        }
        result.sendResult(items);
    }

    private MediaBrowserCompat.MediaItem buildTab(String mediaId, String title) {
        MediaDescriptionCompat desc = new MediaDescriptionCompat.Builder()
                .setMediaId(mediaId)
                .setTitle(title)
                .build();
        return new MediaBrowserCompat.MediaItem(desc, MediaBrowserCompat.MediaItem.FLAG_BROWSABLE);
    }

    private MediaBrowserCompat.MediaItem buildSong(Bundle song) {
        String mediaId = song.getString("mediaId", "");
        String title = song.getString("title", "");
        String artist = song.getString("artist", "");
        String artwork = song.getString("artwork");
        MediaDescriptionCompat.Builder builder = new MediaDescriptionCompat.Builder()
                .setMediaId(mediaId)
                .setTitle(title)
                .setSubtitle(artist);
        if (artwork != null && !artwork.isEmpty()) builder.setIconUri(Uri.parse(artwork));
        return new MediaBrowserCompat.MediaItem(builder.build(), MediaBrowserCompat.MediaItem.FLAG_PLAYABLE);
    }

    private void attachSessionToken() {
        MediaSessionCompat.Token token = MediaSessionHolder.getToken();
        if (token != null) {
            try {
                setSessionToken(token);
            } catch (Exception ignored) {
                // token 已设置过或会话失效时忽略，播放控制仍以 RNTP 服务为准
            }
        }
    }

    /** MediaSessionHolder 回调：RNTP 会话就绪后补上 token */
    @Override
    public void onToken(MediaSessionCompat.Token token) {
        if (token != null) {
            try {
                setSessionToken(token);
            } catch (Exception ignored) {
            }
        }
    }

    /** JS 下发新数据后，通知已连接的浏览器刷新全部节点 */
    public void onDataChanged() {
        notifyChildrenChanged(VivoBrowserRepository.ROOT_ID);
        notifyChildrenChanged(VivoBrowserRepository.TAB_PLAYLIST);
        notifyChildrenChanged(VivoBrowserRepository.TAB_FAVORITE);
        notifyChildrenChanged(VivoBrowserRepository.TAB_DOWNLOAD);
    }
}
