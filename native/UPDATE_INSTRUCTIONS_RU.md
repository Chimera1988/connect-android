# Обновление Connect Android

1. Перенести все изменённые исходники из архива/патча в connect-android, включая native/scripts/release, app.json, source lock и отчёт. Один YAML без исходников недостаточен. YAML разместить в .github/workflows/connect-android-parity-release.yml на main.
2. Actions → Connect Android | PWA parity release → mode=check. Требуется успешный verify job, включая Gradle/JVM/lint. Summary и connect-parity-checks-<run_id> содержат результаты.
3. Для этой поставки выбрать apk; previous_release=connect-android-v3.0.7-b25. Нужны прежние production signing secrets в environment production. Результат: GitHub Release connect-android-v3.0.8-b26 и connect-apk-result-<run_id>: Connect.apk, SHA256, отчёт и native baseline.
4. Установить APK26 системным installer поверх APK25 с тем же сертификатом; не удалять приложение и не очищать данные. Проверить профиль, авторизацию, настройки и переписки. Пройти PWA_ANDROID_DEVICE_TEST_MATRIX.csv. Установленная версия читается из Android PackageManager.
5. Только после установки новой базы использовать ota с previous_release=connect-android-v3.0.8-b26 и EXPO_TOKEN в production environment. OTA v2 несовместима с APK25/v1. Идентификатор и URL будут в Actions Summary и connect-ota-result-<run_id>. Откат к проверенному OTA group описан в полном отчёте.

В этой среде новый APK не собран: Android SDK/NDK отсутствуют, Gradle download заблокирован. Production APK/OTA не опубликованы. 249 JS-тестов, 15 Chromium-сценариев, 4 Python-проверки, оба typecheck, UI build, Expo prebuild/export и YAML/actionlint прошли; это не аппаратная приёмка.
