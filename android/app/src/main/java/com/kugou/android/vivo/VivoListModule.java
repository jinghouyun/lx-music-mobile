package com.kugou.android.vivo;

import android.os.Bundle;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;

import java.util.ArrayList;
import java.util.List;

/**
 * JS -> 原生：下发原子随身听三个列表的数据。
 */
public class VivoListModule extends ReactContextBaseJavaModule {

    VivoListModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "VivoListModule";
    }

    @ReactMethod
    public void updateLists(ReadableArray playlist, ReadableArray favorite, ReadableArray download) {
        List<Bundle> pl = toBundles(playlist);
        List<Bundle> fav = toBundles(favorite);
        List<Bundle> dl = toBundles(download);
        VivoBrowserRepository.update(pl, fav, dl);
    }

    private List<Bundle> toBundles(ReadableArray array) {
        List<Bundle> result = new ArrayList<>();
        if (array == null) return result;
        for (int i = 0; i < array.size(); i++) {
            ReadableMap map = array.getMap(i);
            if (map == null) continue;
            result.add(Arguments.toBundle(map));
        }
        return result;
    }
}
