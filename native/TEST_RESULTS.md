# Результаты проверок

Повторная проверка **16 ноября** после исправления SDK в итоговом workflow: Node **170/170**, browser **15/15**, signing **4/4**, JVM **77/77**, build/web/native types и clean prebuild успешны, native compilation/lint успешны (0 errors / 107 warnings). Первопричины двух упавших GitHub runs и границы проверки: [CI_SDK_REPAIR_REPORT.md](CI_SDK_REPAIR_REPORT.md).

## Перенос PWA — 15 ноября 2026

Все числа ниже взяты из завершённых запусков этого задания. Эмулятор и физический Android не использовались.

| Проверка | Фактический результат |
|---|---|
| build:web (Vite + embed) | Успешно, собран встроенный HTML; промежуточных APK нет |
| typecheck:web | Успешно |
| native TypeScript | Успешно |
| Полный `npm test` | **168/168**, failures=0, skipped=0 |
| Реальный Chromium cache/UI integration | **15/15**, failures=0 |
| Python release signing tests | **4/4**; несовместимая и debug-подпись отклоняются |
| Expo Prebuild | Успешно; дополнительно `--clean` на копии тех же исходников/конфигурации |
| compileReleaseKotlin / compileReleaseJavaWithJavac | Успешно |
| testReleaseUnitTest | **77/77**, failures/errors/skipped=0 |
| C++ зависимости Expo | Проверены для arm64-v8a и armeabi-v7a в составе полного native/lint запуска |
| Android lintRelease | **0 errors, 107 warnings**; ни suppression, ни baseline, ни отключения проверок не добавлены |
| YAML | actionlint 1.7.7 + YAML parser: успешно |
| Source drift/idempotence | SHA-256 lock; helper тесты на drift; повторное применение плагинов; git diff --check |
| PWA/Android upstream main | На момент финальной сверки остаются исходными 55a5314 / 2948c22 |
| Production Supabase | Только SELECT/агрегаты/метаданные, результат в NOTIFICATION_DIAGNOSIS.md; production не изменялся |
| Новый APK / проверка нового APK | **Не выполнено:** прежняя 3.0.5 подписана Android Debug fallback; корректная совместимая недебажная подпись не предоставлена |
| Физический Android10/13+, FCM/вибромотор/locked-screen calls | **Требуется проверка на устройстве** |

Нативная команда:

```sh
./gradlew :app:compileReleaseKotlin :app:compileReleaseJavaWithJavac :app:testReleaseUnitTest :app:lintRelease --no-daemon --max-workers=2
```

JVM suites: IncomingAlerts 12, CallRuntime 8, MissedPolicy 3, HistoryStore 9, CallTiming 13, Proximity 4, MissedLedger 5, SoundResources 4, CallPresentation 6, CallState 13.

Новые/расширенные регрессии: read/cancel/display race, PostgreSQL microseconds, durable dedup после VM/process-state restart, damaged markers, second unread chat, explicit message summaries и сохранение missed calls, монтирование ReadSync/launch/resume/error/unmount, сброс visible chat после WebView failure, trace privacy и время входа в handler, реальный валидатор Notifee и legacy pattern migration, waveform bridge path validation/кэш, video activity ownership, JPG/PNG/WebP/GIF и binary fallback, HTML/IDB byte cache, source lock и Expo Android compatibility plugin.

Тесты Supabase/Notifee границ в JVM/Node не являются доказательством настоящей доставки через production FCM. Chromium тесты не эмулируют Android SQLite/Telecom/датчики. Доступность Edge Functions и таблиц проверена read-only отдельно, но двухаккаунтная отправка/получение не выполнялась.

## Реальные инфраструктурные сбои и их устранение

- Изначально присутствовала Java21 JRE без javac: установлен JDK21. В CI setup-java устанавливает JDK.
- Новый локальный JDK не доверял TLS proxy: использовано системное trust store, проверка TLS не отключалась.
- Ограничение диска среды 8ГБ при дополнительном debug runtime AAR: выбран уже включённый в проекте release JVM variant с тем же набором тестов, удалён только временный кэш. Для lint потребовалось восстановить NDK compiler/runtime. Никакие задачи или тесты не исключались.
- Локальные browser/child-process тесты нуждались в разрешённом execution environment; после корректного запуска пройдены полностью.
- В тестовом web bundler отсутствовали build-time public env replacements для нового PWA diagnostics import: исправлена конфигурация теста, не приложение.

## Исправленные lint ошибки

MissingPermission Telecom.placeCall — явный обработчик SecurityException; NewApi splash API33 — values-v33; camera hardware — optional features. Производственные правки находятся в plugins/, проходят Expo Prebuild и не исчезают после генерации android/.

Оставшиеся предупреждения относятся к устаревшим API зависимостей/шаблона, стилю Kotlin/KTX, локализации строк, ориентации и WorkManager job-ID ranges. Они не скрыты; полный lint report сохраняется с результатами.

GitHub Actions links успешной исходной базы и PWA указаны в PARITY_NOTIFICATIONS_REPORT.md. Они не выдаются за проверку новых изменений. Новый итоговый workflow сохраняет собственные результаты в artifacts; кандидат APK допускается только отдельным ручным запуском с прежней совместимой недебажной подписью.
