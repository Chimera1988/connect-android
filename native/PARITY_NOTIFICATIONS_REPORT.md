# Connect Android — сверка 15 ноября 2026

Статус: исходники обновлены; доступные автоматические, нативные и lint-проверки пройдены. Выпуск заблокирован требованиями к подписи и не завершает аппаратную/production-приёмку. Аппаратная приёмка не выполнена. Состояние конкретного телефона и живую доставку FCM модельные тесты не подтверждают.

## Зафиксированные источники

- Android main: `2948c22df5d3060ae0e15c199737b2cd82c77af3`, версия 3.0.5 (23).
- PWA main: `55a5314043e604bdd2f21d35a032bc34fc1ce075`; это результат последнего успешного Media egress workflow, а не старый снимок из README.
- База трёхстороннего переноса клиентских изменений: `b53f0b1`; она уже включает предшествующий перенос геометрии/миниатюр. Сохранены изменения Android относительно этой базы: native SQLite, каталоги, лимиты/очистка кэша, прокси, мост, рекордер, аудиозвонки.
- Прочитаны полностью `connect-messenger/AGENTS.md`, корневой README Android, native/README, web/README, исторический PWA_PARITY_REVIEW. Нативные постоянные изменения находятся в src/ и plugins/, не в генерируемом android/.
- Обновление: 3.0.6 (24), `com.connect.messenger`, minSDK29. Схема хранилищ, ключи сессии/пользовательских настроек и подпись не заменялись. Новые read/dedup/diagnostic ключи добавляются к существующим данным.

Проверены jobs и steps успешных запусков:

- [Chat activity: sticker file video FIX5 — 43749517999](https://github.com/Chimera1988/connect-messenger/actions/runs/43749517999): activity tests, TSX, Chromium, полный набор и production build прошли; результат `7452d3d` включён в эталон.
- [Faster chat sends voice and stickers FIX3 — 43740340592](https://github.com/Chimera1988/connect-messenger/actions/runs/43740340592): targeted regressions, реальный cache lifecycle, typecheck/full suite/build прошли; результат `f4fb307` включён.
- [Media egress — 43757167243](https://github.com/Chimera1988/connect-messenger/actions/runs/43757167243): RED/GREEN браузерных запросов, полный набор и build прошли; результат `55a5314` включён.
- [Android 3.0.5 — 43305424323](https://github.com/Chimera1988/connect-android/actions/runs/43305424323): предшествующая рабочая сборочная база. Это исторический run, не подтверждение новых изменений.

Изучены первопричины недавних сбоев, а не только exit code:

| Run | Подтверждённая причина | Предотвращение |
|---|---|---|
| Android 43300341562 | `thumbnail requests bounded: expected exactly one match, found 0` | Нет исторического установщика/слепых замен; проверка SHA-256 итоговых исходников |
| Android 43301703552 | `TS2307 Cannot find module './generated/pwa'` | build:web до native typecheck |
| PWA 43748299580 | `TS2322` у неподдерживаемого input onCancel | Перенесён успешный код с addEventListener/removeEventListener cancel; typecheck |

## Матрица соответствия

«Реализовано» ниже означает наличие подключённого производственного пути и перечисленных автоматических проверок. Это не означает аппаратную или пиксельную приёмку. «Нативная адаптация» означает сохранённый Android-путь вместо браузерного API.

| Функциональная группа | До обновления | После обновления / код и проверка |
|---|---|---|
| Liquid Glass, семь тем, фон/контраст | Реализовано, более старый CSS | Реализовано: globals/liquid-glass/calls CSS + hybrid/android.css; визуальная приёмка на телефоне требуется |
| Нижняя панель, moving capsule, жесты вложенных экранов | Частично | Перенесены актуальные page/CSS обработчики; Android BackHandler и safe area сохранены |
| Списки/аватары/online статусы | Частично | PresenceAvatar включён и в Android; новые CSS списков, исходные темы/иконки сохранены |
| Android 10, клавиатура, системные жесты | Нативная адаптация | Сохранены withConnectKeyboard, adjustResize, safe areas, chrome80 build target; CSS fallback при отсутствии backdrop-filter; стоимость эффектов на физическом Android10 не измерялась |
| Мгновенное открытие, скролл/окно истории | Реализовано частично | Сохранена SQLite гидратация и paging; перенесены актуальные entry/send изменения без замены native history браузерным IDB |
| Быстрая отправка в длинном чате | Частично | Optimistic send, замена временного ID серверным, восстановление draft при ошибке; прогрессивная подпись медиа максимум 4 worker |
| Время/доставка/прочтение | Реализовано | Сохранены receipts; подключён нативный read reconciliation; inbox-delivery/chat-reading/read-reconcile тесты |
| Фото/видео/альбомы/ответы/пересылки | Частично | Актуальный shared UI; сохранены приватное копирование, постеры, native media path; реальная отправка двум аккаунтам не проверена |
| Голосовой плеер, скорость начала | Частично | preload=none, нет eager decode всех voice при открытии; быстрый play, retry signed URL, небольшой warmup |
| Настоящая звуковая волна | Требовала адаптации | Новый разрешённый media:waveform мост к существующему ConnectWaveform; decode только после play, очередь/лимиты/cleanup прежние; кэш формы по owner+path. Кодеки требуют устройства |
| Видео-кружки, ориентация/стоп-кадр | Нативная адаптация | Сохранён ConnectHybridRecorder/Expo Camera и существующий native recorder; shared UI/poster изменения перенесены. Физическая ориентация не подтверждена |
| Превью/миниатюры/предзагрузка | Реализовано частично | Android bounded cache/leases сохранён; перенесён отказ от параллельного original download на play для audio/video |
| Кэш аватаров/медиа/сообщений, лимиты/очистка | Реализовано | Сохранены SQLite и IDB byte cache, retired guards, бюджет history; браузерные интеграционные тесты |
| WebP личных стикеров, стабильные URL | Частично | prefetchStickerWebp + resolveCachedMedia со стабильным storage identity; подпись не блокирует весь каталог |
| JPG/JPEG/PNG → WebP, прозрачность/фон | Отсутствовало в снимке | Перенесены prepareStickerFile и проверяемый fallback binary transport; конвертация не удаляет фон; PNG alpha тестируется в Chromium |
| GIF анимация | Реализовано | GIF возвращается исходным файлом, не статичным WebP; регрессионные тесты |
| Редактор личных наборов и отдельные стикеры | Частично | Актуальный editor page; удаление/cleanup через существующие Connect endpoints, без новой privileged миграции |
| Личный стикер у получателя | Частично | Перенесены catalog priority/progressive signing, стабильные identities. Межаккаунтная серверная приёмка требуется |
| Одинаковая политика качества | Требует нативной адаптации | Перенесён эталонный connectOptimizeMedia с его native guard: Android оставляет существующий recorder/upload путь. Кодек/битрейт не объявляется одинаковым без измерений |
| Окончательное удаление без заглушки | Частично | Перенесён connect-delete-forever вызов и локальное удаление/retired guards; авторитетная серверная Edge Function не изменялась и её живое выполнение не проверено |
| Защита от повторного появления удалённого | Реализовано частично | Сохранён native drop/history retirement; shared serverDeleted фильтры. Требуется серверный сценарий офлайн→онлайн |
| Печатает/записывает голосовое | Реализовано | Сохранены typing_until/recording_until и единая очередь conversation_user_state |
| Выбирает стикер/файл/записывает видео | Отсутствовало/частично | Перенесены composerActivity/visiblePeerActivity/TTL; Android video=true только по реальному record-state, не открытию камеры |
| Очистка активности | Частично | cancel/completion, смена чата, visibility, TTL и сериализация существующего state; activity regression tests |
| Только аудиозвонки, native lockscreen | Реализовано, нативно | Нативные Telecom/WebRTC/IncomingCallActivity/Proximity не заменялись; браузерный WebRTC-контроллер по-прежнему не монтируется |
| Рингтон/гудки/вибрация звонков/соединение | Нативная адаптация | Существующий единственный ConnectCallCoordinator/AudioGate сохранён; call runtime/race/controller тесты; телефон обязателен |
| Журнал/пропущенные/счётчики | Реализовано | Сохранены native missed ledger и counters; новые chat cleanup тесты не удаляют missed-call |
| Раздельные свои мелодии, настройки | Реализовано | Сохранены SecureStore, MediaStore URI, call coordinator и server enum; новые message каналы имеют явный vibrationPattern, прежние системные настройки не сбрасываются |
| Очистка шторки после чтения | Частично, дефекты | ReadSync теперь смонтирован; display/cancel сериализованы; summary удаляется только без непрочитанных children; read high-water/durable dedup; см. отдельный диагноз |
| Доставка FCM/регистрация | Реализовано частично | Сохранены native durable token JobScheduler и high-priority data transport; улучшена дедупликация; реальная причина всех потерь не установлена без событий сервера/устройства |
| Диагностика push | Частично | Ограниченный metadata trace received/shown/read/dismissed/registered, 16 событий; токены/содержимое не записываются. Сервер queue/FCM response timestamps пока отсутствуют |

## Что приходит автоматически

`native/web` встроен в APK: изменения React/CSS/lib/public из PWA **не приходят** в установленную 3.0.5 автоматически. Перенос, Vite build и новый APK обязательны. Серверные `/api/*`, Supabase REST/Realtime, Storage и Edge Functions используются общие: их уже развёрнутое поведение доступно обеим версиям без копирования сервера в APK. Репозиторий сам по себе не доказывает текущую серверную конфигурацию.

FCM, разрешения, NotificationChannel, системная шторка, звуки, Telecom, proximity, native recording, SQLite и bridge требуют обновления Android-кода/плагинов. Старые ConnectNativeChat/Inbox остаются в дереве с тестами, но в активном HybridConnect UI не монтируются; исправления сделаны в реальном App/bridge/push пути.

## Проверки и ограничения выпуска

Результаты текущего выполнения приведены в TEST_RESULTS.md. На работающем Supabase read-only проверены trigger, queue/HTTP агрегаты, состояние регистраций, поля activity/read и deployments; результаты и пределы корреляции — в NOTIFICATION_DIAGNOSIS.md. PWA-репозиторий и production сервер этой работой не изменялись. Ни одного промежуточного APK не собиралось.

Workflow `connect-android-parity-notifications-final.yml` не устанавливает исторические патчи и не делает commits/push. Он проверяет snapshot hashes, актуальность PWA main, package ID/version/minSDK, совместимые инструменты из RN Gradle TOML, web/native TypeScript, unit/browser tests, prebuild, Kotlin/Java/JVM/lint. На PR выполняет проверки без APK; ручной запуск на main может собрать один кандидат только после всех проверок и проверки подписи.

В журнале job 131487345403 успешного run 43305424323 подтверждены signing="Android debug key (fallback)" и сертификат предыдущей 3.0.5 — Android Debug `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. Одновременно сохранить этот сертификат и выпустить APK с недебажной release-подписью невозможно. Workflow прямо отказывает debug fallback, даже если его передали как secret. Если на устройстве установлена другая действительно release-подписанная версия, нужен её прежний keystore и подтверждённый SHA-256 в `CONNECT_PREVIOUS_CERT_SHA256`. Самовольной смены сертификата или удаления данных нет.

Для подписи предусмотрены существующие `CONNECT_RELEASE_KEYSTORE_BASE64`, `CONNECT_RELEASE_STORE_PASSWORD`, `CONNECT_RELEASE_KEY_ALIAS`, `CONNECT_RELEASE_KEY_PASSWORD`. Они не входят в архив исходников/логи. Release secrets используются только workflow_dispatch, не PR.

## Требуется проверка на устройстве

На физическом Android10 и Android13+ с двумя аккаунтами Android↔PWA: foreground/background/закрытый процесс/заблокированный экран; Wi-Fi↔мобильная сеть/Doze/перезагрузка/переустановка и токен; серия уведомлений/повторы/чтение второго устройства/summary/второй непрочитанный чат/сохранение missed calls; разрешения, звук/вибрация/системные channels/DND; voice и видеокружок/ориентация/кодеки; первая отправка в длинный чат; личные наборы/получатель/GIF/cleanup; кэш/миниатюры/удаление/офлайн-восстановление; входящие/исходящие/locked-screen calls/Bluetooth/proximity/журнал. Сравнить парные скриншоты всех тем, safe areas, клавиатуры и Android10 эффектов. Эмуляторная/физическая приёмка в этом отчёте не выдумана.


## Дополнительные ошибки, обнаруженные обязательным Android lint

Исправлены без suppression/baseline/отключения тестов: MissingPermission у Telecom.placeCall — явный SecurityException failure path с сохранением прежнего завершения вызова; NewApi у windowSplashScreenBehavior — атрибут вынесен в values-v33 с полным сохранением splash style для SDK29; PermissionImpliesUnsupportedChromeOsHardware — camera/autofocus объявлены optional. Постоянные правки: plugins/telecom/ConnectCallService.kt и withConnectAndroidCompatibility.js; порядок Expo модов проверен, source drift и идемпотентность покрыты тестами.
