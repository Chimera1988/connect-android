# Ошибки итогового workflow — 16 ноября 2026

Проверена фактическая `connect-android/main` на `20dab66175e05640a6eee5faa97b9e6b641e2851`.
Эталон PWA по-прежнему `55a5314043e604bdd2f21d35a032bc34fc1ce075`; повторная проверка удалённой main подтвердила SHA.

## Причины двух красных запусков

| Запуск | Первопричина | Что подтверждает журнал |
|---|---|---|
| [43809573377](https://github.com/Chimera1988/connect-android/actions/runs/43809573377), job 133107974374, SHA 679f615 | Workflow загружен до установки полного обновления исходников. В этом commit отсутствует `native/PARITY_SOURCE_LOCK.json`. | Шаг Require current sources завершился на `test -s native/PARITY_SOURCE_LOCK.json`; установки зависимостей и сборки не было. Отсутствие файлов отчёта вызвало вторую, зависимую ошибку upload-artifact. |
| [43812610819](https://github.com/Chimera1988/connect-android/actions/runs/43812610819), job 133117419822, SHA 20dab66 | Неправильный ID пакета Android SDK: `platforms;android-37`. | `Warning: Failed to find package 'platforms;android-37'` на шаге Generate native project. Перед этим прошли build:web, обе TypeScript-проверки, 168 Node-тестов, браузерная проверка, 4 signing-теста и Expo Prebuild. До native compilation и подписания выполнение не дошло. |

`compileSdk = "37"` в установленном React Native TOML — номер API, а не ID пакета SDK Manager.
Пакет опубликован как **`platforms;android-37.0`**. Это подтверждают официальный repository XML,
локальный `platforms/android-37.0/source.properties` и успешный исторический workflow
`connect-android-3.0.5-release.yml`, который запрашивал именно этот пакет.

## Исправление

- `check-parity-source.mjs --tools` отдельно возвращает проверенный `sdkPlatform` наряду с compileSdk, buildTools и NDK. Для неизвестного API останавливается с SOURCE_DRIFT.
- Итоговый YAML передаёт SDK Manager это полное имя пакета; версии Gradle/JDK/SDK/NDK и Android minSdk не понижались.
- Source lock содержит точное имя пакета и обновлённые SHA-256 трёх изменённых проверяемых файлов. Проверки не удалены и не ослаблены.
- Предварительная проверка теперь называет отсутствующий файл, вместо молчаливого `test -s`.
- Новая регрессия исполняет настоящий bash-блок SDK из YAML, подменяя только внешние команды Expo/SDK Manager. На старом YAML она воспроизвела запрос `platforms;android-37` и упала; на исправленном получает `platforms;android-37.0` и проходит. Отдельно проверены повторный запуск, неизвестный API и неверный пакет в lock.

Этот тест не выдаётся за скачивание SDK или запуск GitHub Actions. Код приложения, данные, native services, PWA и ключи подписи этим исправлением не меняются.

## Повторные локальные проверки 16 ноября

| Проверка | Результат |
|---|---|
| Полный npm test | **170/170**, fail=0, skipped=0; включая две новые регрессии SDK |
| Браузерный cache/UI integration | **15/15**, failed=0 |
| build:web, typecheck:web, native TypeScript | Успешно |
| Signing policy unit tests | **4/4** |
| Expo Prebuild --clean | Успешно в отдельной копии с побайтно совпадающими app.json и plugins; рабочие native test reports сохранены |
| compileReleaseKotlin, compileReleaseJavaWithJavac, testReleaseUnitTest, lintRelease | BUILD SUCCESSFUL, 556 tasks; 77 JVM-тестов, failures/errors/skipped=0; lint 0 errors / 107 warnings |
| YAML / source protection | actionlint 1.7.7; source lock проверяет все 368 файлов; git diff --check |

Локальные browser tests выполнялись с `/usr/bin/chromium` через предусмотренный `CHROMIUM_PATH`.
Первый локальный полный запуск после перезапуска среды обнаружил отсутствующий браузер в стандартном Playwright cache;
после задания существующего executable весь набор выполнен повторно, без пропусков и изменений тестов.
В CI установка браузера точной версии `playwright-core@1.58.2` и проверка executable уже стоят до npm test;
в реальном запуске 43812610819 этот этап прошёл.

Новый удалённый успешный run и APK этим отчётом не заявляются. Итоговая проверка APK остаётся заблокирована условиями подписи ниже.

## Условия APK

Исправление SDK не снимает отдельное ограничение подписи: исторический APK 3.0.5 имел Android Debug certificate.
Существующий запрет выпускать debug APK как окончательный сохранён. `release_candidate=false` запускает проверки;
`release_candidate=true` дополнительно требует прежнюю совместимую недебажную подпись.
Замена сертификата не используется как обход. Физическая доставка FCM, вибромотор и звонки на заблокированном устройстве требуют проверки на телефоне.
