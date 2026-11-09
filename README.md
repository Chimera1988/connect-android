# Connect Native — Android

Текущая сверка и исправления PWA: [native/PWA_PARITY_REVIEW.md](native/PWA_PARITY_REVIEW.md). Старые отчёты phase10/final-parity-review описывают предыдущие снимки; они не подтверждают текущую работоспособность.

This repository now contains **only the native React Native / Expo Android client** in `native/`. The old WebView Android sources and Gradle build have been retired. The Connect Messenger PWA is a separate repository and is **not** deleted or changed here.

## Native test APK

The previous QA build workflow depends on the deleted WebView resources and is deactivated. A fresh Native-only APK workflow will replace it; do not run the old one. The QA application ID will remain `com.connect.messenger.native`, distinct from the production `com.connect.messenger`.

The test APK is signed with a disposable debug key and **is not a final production release**. Firebase push in the QA package needs separately registered Firebase Android configuration and real-device tests. Audio calls, Bluetooth, background notifications, camera and media require real-device checks.

The native app uses the same users and Connect backend as the PWA. Its Firebase config and launcher icon now live inside `native/` rather than the deleted WebView project.

## Development

`cd native && npm ci && npx expo prebuild --platform android`

The old `app/` and root Android Gradle scripts have been deleted. Old GitHub Actions workflows are retained only as disabled history because the default Actions token cannot remove workflow definitions. Legacy source can be restored from Git history if needed.
