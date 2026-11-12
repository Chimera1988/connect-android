# CONNECT_ANDROID_PWA_304_UI_PARITY_20261112

- PWA reference (unchanged): `Chimera1988/connect-messenger@d64183598bdee2efa81a1c6bb96cde1ae14fbc99`
- Three-way merge baseline: `5efd8518730ce247f4dfba2f46d818f3d6cb7482`
- Android source: `Chimera1988/connect-android`, update `3.0.4 (22)`
- Transplanted PWA UI: chat/gallery, voice/audio UI, circles, albums, forwarded media, receipts, sticker and emoji styling.
- Cached Android chat/history/profile behavior retained in `native/web` through the three-way merge and profile-specific overlay update.
- Kept native Kotlin Telecom, notification channels, FCM, proximity service, ring tones, launcher icon, SQLite and Android WebView/bridge.
- Existing PWA E2EE and speech-transcription state not changed. No transcription endpoint included.
- Physical QA pending: Android 10 Poco F1, Android 11+, all seven themes, call/lockscreen/audio, media gallery, sticker badges, read receipts and overlay bounds.
- Build/test success alone does not certify pixel equivalence on all Android devices.
