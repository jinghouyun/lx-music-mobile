package com.kugou.android.vivo;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * vivo 原子随身听浏览数据仓库（进程内静态持有）。
 * JS 侧通过 VivoListModule 下发三个列表，VivoMediaBrowserService 读取。
 */
public class VivoBrowserRepository {
    // 浏览树节点 id
    public static final String ROOT_ID = "__lx_root__";
    public static final String TAB_PLAYLIST = "__lx_tab_playlist__";
    public static final String TAB_FAVORITE = "__lx_tab_favorite__";
    public static final String TAB_DOWNLOAD = "__lx_tab_download__";

    // Tab 展示名（原子随身听面板顶部的三个页签名）
    public static final String TITLE_PLAYLIST = "播放列表";
    public static final String TITLE_FAVORITE = "收藏列表";
    public static final String TITLE_DOWNLOAD = "下载列表";

    private static final List<Bundle> playlist = new ArrayList<>();
    private static final List<Bundle> favorite = new ArrayList<>();
    private static final List<Bundle> download = new ArrayList<>();

    private static final CopyOnWriteArrayList<VivoMediaBrowserService> services = new CopyOnWriteArrayList<>();
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

    /** JS 下发三组列表，每组元素 Bundle: mediaId/title/artist/artwork */
    public static synchronized void update(List<Bundle> pl, List<Bundle> fav, List<Bundle> dl) {
        replace(playlist, pl);
        replace(favorite, fav);
        replace(download, dl);
        notifyChanged();
    }

    private static void replace(List<Bundle> target, List<Bundle> source) {
        target.clear();
        if (source != null) target.addAll(source);
    }

    public static synchronized List<Bundle> getChildren(String parentId) {
        List<Bundle> source;
        switch (parentId) {
            case TAB_PLAYLIST:
                source = playlist;
                break;
            case TAB_FAVORITE:
                source = favorite;
                break;
            case TAB_DOWNLOAD:
                source = download;
                break;
            default:
                return new ArrayList<>();
        }
        // 返回拷贝，避免遍历时被 JS 线程更新
        return new ArrayList<>(source);
    }

    static void register(VivoMediaBrowserService service) {
        services.addIfAbsent(service);
    }

    static void unregister(VivoMediaBrowserService service) {
        services.remove(service);
    }

    /** 数据变化后通知已连接的系统浏览器重新加载各节点 */
    private static void notifyChanged() {
        mainHandler.post(() -> {
            for (VivoMediaBrowserService service : services) {
                service.onDataChanged();
            }
        });
    }
}
