package com.connect.waveform;

import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;
import java.util.Collections;

public final class ConnectWaveformPackage extends BaseReactPackage {
  @Override public NativeModule getModule(String name, ReactApplicationContext context) {
    return "ConnectWaveform".equals(name) ? new ConnectWaveformModule(context) : null;
  }

  @Override public ReactModuleInfoProvider getReactModuleInfoProvider() {
    return () -> Collections.singletonMap("ConnectWaveform", new ReactModuleInfo(
        "ConnectWaveform", ConnectWaveformModule.class.getName(), false, false, false, false));
  }
}
