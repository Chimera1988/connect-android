# Connect Native

Native Android client built with Expo SDK 58 / React Native 0.88; no WebView. Uses existing Connect Messenger accounts, Supabase data and Connect HTTPS proxy.

## Implemented in source

Messages and inbox previews, search, read state and cross-device notification clearing, file attachments up to 100 MB (TUS upload), albums, voice messages, video notes, stickers and emoji, media galleries, contacts and profile screens, call journal, WebRTC audio-only calls and Android Telecom integration, sound selection, and seven themes. Liquid Glass visual foundation is an ongoing adaptation, not a pixel-identical copy of the PWA.

Native-only resources: `assets/connect-icon.png` and `google-services.json` (Firebase public client configuration). Android package in `app.json` is `com.connect.messenger`; the standalone QA workflow adds `.native` only to the generated test APK.

## Build and test

The obsolete QA workflow is disabled because it still references legacy `app/`. A new Native-only test APK workflow is required before the next installable QA build. Production release signing must be configured separately. The QA package needs its own real Firebase registration for reliable push notifications.

Compilation is not equivalent to device testing: verify sign-in, messaging, uploads, audio-only calls, foreground/background behavior, call lock screen, ringtones and Bluetooth routing on physical Android devices.
