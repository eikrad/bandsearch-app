# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class app.bandsearch.* {
  native <methods>;
}

-keep class app.bandsearch.WryActivity {
  public <init>(...);

  void setWebView(app.bandsearch.RustWebView);
  java.lang.Class getAppClass(...);
  int getId();
  java.lang.String getVersion();
  int startActivity(...);
}

-keep class app.bandsearch.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class app.bandsearch.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class app.bandsearch.RustWebChromeClient,app.bandsearch.RustWebViewClient {
  public <init>(...);
}
