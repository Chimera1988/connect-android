# Connect 2.2.5 (15) — P0 по реальной диагностике

**Исправления реализованы и автоматически проверены. Реальные аудиозвонки на физических устройствах ожидают приёмки.**

База — Android2.2.4(14), локальный ab638d6d73981a059f79cd118a5fb94e0df1931a, пакет com.connect.messenger. Ветки main прочитаны без отката Android: актуальная публичная Android7fccbfd содержит ту же функциональную базу. PWA синхронизирована с f67c6c4, включая Turnix. Интеграция Turnix, серверная схема, E2EE, кеш, SQLite-история, сообщения, семь тем, SVG, 96 WebP, медиатека и пользовательские настройки не заменялись.

## Точная причина A: finish(MISSED, LOCAL) через 116 мс

Реальный callId f44bc330-688f-48c8-a183-f7ccd65fc83a, operationId b225dbd4-20eb-4f9b-b2c4-b87263858f6a. Supabase возвращает `created_at = 2026-11-10T21:27:07.068419+00:00`.

В Android10 AOSP `DateTimeFormatterBuilder.InstantPrinterParser.parse()` заканчивает формат литералом `Z` (android-10.0.0_r1, строка3259). Поэтому `Instant.parse()` на API29 отвергает числовое смещение `+00:00`. В 2.2.4 `ConnectCallService.created()` скрывал исключение и возвращал **0L**. В `dial()` это давало:

`ringDeadline = elapsedRealtime + (60000 - (wallNow - 0)).coerceIn(1, 60000)`

То есть оставалась **1 миллисекунда**. Следующий `tick()` — единственный локальный путь MISSED для исходящего — завершал вызов. Это соответствует supplied created21:27:06.617 → finish21:27:06.733. Подтверждённая цепочка не требует гипотезы о старом таймере, Telecom или TURN. Сервер хранит ended, а не missed, потому что существующий `connect_finish_audio_call` разрешает missed от вызывающего только после 40 секунд. Answer отсутствует, trickle ICE не успевал сохраняться. JDK21 принимает числовой offset и ранее скрывал эту несовместимость Android10.

Источники: реальная строка Supabase; исходник AOSP https://android.googlesource.com/platform/libcore/+/refs/tags/android-10.0.0_r1/ojluni/src/main/java/java/time/format/DateTimeFormatterBuilder.java . Сводка и SHA исходника — ROOT-CAUSE.json. Регрессия использует source-derived fixture старого парсера; это не запуск телефона/MIUI.

## Точная причина B: FCM получен, входящий не показан

Для 89476a5d-006e-417f-84e4-e3ceb64c601b сервер возвращает `2026-11-10T21:27:37.331392+00:00`. Тот же `created()` возвращал0. В `receive()` проверка `validIncoming()` требовала created>0: вызов отвергался **до** Telecom.addNewIncomingCall, publish, уведомления, Activity и сигналов. Hint подтверждался/удалялся, пустой Service останавливался; foreground-discovery опять находил живую строку каждые3сек и запускал Service. `telecom / registered` обозначал только onCreate-регистрацию PhoneAccount, а не показ входящего. FCM и offer/5 ICE в этом сценарии присутствуют; причина не в отсутствии push-доставки.

## Изменённые методы и поведение

- `ConnectCallTiming.parse/window`: API29-совместимый OffsetDateTime/ISO_OFFSET_DATE_TIME, Z и числовые offsets, 0–9 дробных знаков, корректные epoch milliseconds. Ошибка разбора становится INVALID_TIMESTAMP, никогда нулевой датой и deadline1мс. Интервал ожидания **остался60000мс**.
- `ConnectCallSession.request` + `ConnectCallServerClock`: возраст строки калибруется HTTPS Date; countdown основан на elapsedRealtime. Отключено кеширование нативных API-запросов. Возраст, источник часов, deadline и remainingMs экспортируются, без заголовков/токенов.
- `ConnectCallService.startTick`: каждый Runnable захватывает поколение вызова; старые callbacks отвергаются, auth-смена очищает вызов. OFFER_CREATED, PRESENTING и ANSWERING добавлены к состояниям, невозможные переходы запрещены. Логические исходящие переходы PREPARING→OFFER_CREATED→RINGING→CONNECTING→ACTIVE; входящие RECEIVED→VALIDATING→PRESENTING→RINGING→ANSWERING→CONNECTING→ACTIVE. Внутренние legacy имена не меняют серверные статусы и UI-протокол.
- `ConnectIncomingGate.dispatch`, `receive`, `ConnectCallValidation`: один pending/validating/presenting/owned на callId для FCM receiver, FirebaseMessagingService, JobScheduler и foreground polling. Дубли не создают новый Service/звук/Activity. Временный сбой получает backoff, окончательный отказ — отрицательный кеш. Проверяются аккаунт, callee, status, серверное время и локальный terminal-marker. Отдельные коды NO_SESSION, AUTH_401/403, NETWORK_RETRY, WRONG_OWNER, SERVER_ENDED, EXPIRED, INVALID_TIMESTAMP и AUTH_CHANGED.
- `showNotification`, `ConnectCallCoordinatorModule.showOnce`, `ConnectIncomingCallActivity`: PRESЕNTING создаёт CallStyle/full-screen intent для существующей нативной Activity. В журнале отдельно запрос показа, фактический screen/visible, запрет уведомлений/канала/full-screen, исключение Activity. Получение FCM не объявляется показом экрана. MainActivity/WebView/splash не становятся входящим экраном.
- `ConnectCallAudio.incoming/stopSignals`: сохранён единственный владелец Connect Call/своей мелодии и повторной вибрации. Добавлены проверяемые причины тишины: DND, silent/vibrate, нулевая громкость, настройки Connect/канала, отсутствие вибромотора, недоступный URI. PLAY_REQUESTED и фактический флаг PLAYING плеера различаются; это не подтверждение слышимости физического динамика.
- `sampleMedia`: сохранён RTP-gate ACTIVE (transport, remote track, ADM record/playout, focus, inbound/outbound audio packets). Добавлены только безопасные сведения выбранной пары: relay/host/srflx/prflx и OPUS/OTHER, без IP, SDP и TURN-ключей. Полученный TURN config не приравнивается к рабочему медиареле.
- `end` + `ConnectCallCleanup`: источник завершения и переход экспортируются; таймеры помечаются TIMER_RING/SETUP/RECONNECT/ACK, пользователь USER, подтверждение сервера SERVER, потеря авторизации AUTH_CHANGED, ошибки/Telecom — отдельными источниками. Очистка независимо пытается закрыть PeerConnection, tracks/source/factory/ADM, сигналы/focus, WakeLock, Telecom; DONE/PARTIAL показывает результат. Нотификация и foreground service завершаются прежним владельцем. Отмена до RPC очищает поздний orphan-call; чужой поздний отказ не завершает выигравшее устройство.
- `ConnectCallState`, `ConnectCallsHub.missed/statusText` в обоих клиентах: исходящий тайм-аут — NO_ANSWER/«Без ответа»; локальная отмена — CANCELLED; MISSED остаётся входящим. Серверная семантика сохраняется. Удалены ложные missed-badge для declined и ended без answer; отмена отображается как отмена, failed как ошибка соединения.

## «Android не ответил. Повторите действие.»

Найдена точная строка: `native/web/hybrid/runtime.ts`, общий 60-секундный таймер pending-команды моста. Она не означала конкретную неисправность WebRTC. Из supplied-экспорта нельзя установить, какая именно команда истекла: старый формат не записывал command/requestId. Возможный бюджет calls:dial был разрешение60с + подготовка28с, больше внешних60с; также перед вызовом ожидалась остановка записи.

Теперь App.handle и нативный traceBridge фиксируют START/DONE/ERROR/TIMEOUT с названием команды и requestId. Отказ native dial возвращается вызывающему, не превращается в успешный bridge ACK. Ожидания ограничены: разрешение25с, возвращение видимого Activity2с, native preparation28с, остановка записи3с — общий предел58с при внешнем60с. Сам ring-timeout не увеличен. Отмена/завершение не блокируются общей busy-категорией незавершённого dial. Timeout отменяет только соответствующую pending-подготовку; активный или следующий вызов не завершается. Ошибка называет операцию. Экспорт из существующих настроек сохранён в прежнем JSONL-формате с добавленными полями.

## Проверки

- Android: typecheck, typecheck:web, все20 файлов npm-тестов, build:web прошли.
- Kotlin/Java release compilation, testReleaseUnitTest, lintVitalRelease и assembleRelease прошли:610 задач,40 выполнены,570 up-to-date.38 JVM-тестов:13 CallState,13 Timing/validation/gate/cleanup,6 presentation/RTP,6 SQLite HistoryStore; ошибок и пропусков0.
- Регрессии покрывают точные два created_at, старое падение парсера/API29, старый deadline1мс и116мс, Z/offsets/доли/единицы, старое поколение таймера и смену wall-clock, дедупликацию FCM/polling, backoff/окончательный отказ, отменённый/истёкший входящий, PRESENTING→RINGING→ANSWERING, запрет невозможных переходов, разные коды отказа, независимую очистку, новый вызов после ошибки, command-specific bridge timeout, сохранение активного вызова и корректные badge/подписи.
- PWA с текущим Turnix: typecheck, полный npm test и production build прошли. Синтетический WebRTC проверяет реальные Linux peer/Opus и PCM, но не APK/телефон/FCM/физический микрофон/Turnix-реле.
- APK проверен на целостность, applicationId,2.2.5(15),minSdk29, release/non-debuggable, ARM64+ARMv7, встроенные JS/96WebP/темы/Connect Call, нативные классы и сертификат.15 ресурсов предоставленных иконок совпадают с исходным архивом,13 PNG в APK совпадают пиксель в пиксель; compiled Kotlin tree совпадает с plugin source. Установка/лаунчер на телефоне не проверялись.
- Одна точечная Kotlin-компиляция выявила затенение AudioSource параметром диагностики; исправлено. Также очищены только старые промежуточные app Kotlin-классы. Финальная полная сборка прошла; отключённых тестов нет.
- Новых зависимостей нет; прежние npm ci соответствуют тем же lockfile, итоговые workflow выполняют свежий npm ci. SQL-миграции, изменения сервера/ключей/Turnix не требуются.

## Реальная приёмка на Poco F1

Все телефонные сценарии ниже пока **НЕ ПРОВЕРЕНЫ**: нет физического устройства/ADB/двух тестовых аккаунтов. Успешные логи APK→PWA/PWA→APK не создавались и не подменялись JVM-результатами.

1. Установить приложенный APK поверх именно2.2.4 с тем же сертификатом, без удаления приложения. Проверить «О приложении»:2.2.5(15). Вход/данные/свои звуки должны сохраниться.
2. Использовать два разных аккаунта: Poco и PWA. Сначала APK→PWA, затем PWA→APK: убедиться, что ожидание длится нормально, входящий экран/звук/вибрация появляются, после ответа слышны оба участника минимум20сек. Затем повторить APK→APK с отдельным Android.
3. Для каждого направления проверить отбой с каждой стороны, отклонение, отмену до ответа, ожидание «Без ответа» и повторный звонок без перезапуска. Перед входящим оставить непрочитанное сообщение. Отбой не должен оставлять сигналы/уведомление, сообщение должно сохраниться.
4. Повторить входящий на главном экране, в другом чате, в фоне, при заблокированном/выключенном экране; отдельно после перезапуска и перезагрузки с первым разблокированием. Не использовать системный force-stop как тест FCM-доставки.
5. Проверить обычный/vibrate/silent/DND, Connect Call и свой файл, микрофон/громкую связь/Bluetooth/громкость/proximity. При запрете разрешения должна быть понятная ошибка; повтор после выдачи разрешения должен работать.
6. Проверить Wi-Fi, разные мобильные сети и переход между ними. Запись TURN ready недостаточна: искать выбранную пару relay (если прямой путь не подходит), audio BIDIRECTIONAL_RTP, ACTIVE и реальную слышимость. При прямом успешном соединении host/srflx также допустимы.
7. После серии минимум3 звонков каждого направления открыть существующие настройки уведомлений → подготовка звонков → «Сохранить диагностику звонков». Сохранить callId, UTC/версию/состояние экрана/сеть и результат. Проверить последовательность deadline VALID (remaining близко60000), RINGING, ICE ACK, ANSWER/CONNECTING, RTP/ACTIVE, finish/source и cleanup/DONE. Для входящего должны быть VALIDATING accepted, PRESENTING, notification-posted и screen/visible. Если последнего нет — это неподтверждённый показ Activity, а не успешный тест.

Аналогичные проверки нужны на Android13 и14+: full-screen ограничения и уведомления нельзя считать проверенными по Android10. Принудительно включать MIUI-разрешения, обходить DND/блокировку или обещать доставку после force-stop приложение не пытается.

## Итоговые файлы и подпись

Connect.apk: **2.2.5 (15)**, com.connect.messenger, Android10+.
SHA-256: `749b4f86b495e0bc217556991c4f720e1a0d8f7fc8bec9a1b7478e78a88121a6`.
Сертификат: **Android Debug, fallback**, SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. Подпись проверена apksigner и совпадает с переданным APK2.2.4. Production-ключ недоступен; совпадение с иной установленной сборкой не обещается. Реальная установка поверх2.2.4 не выполнялась.

В Android ZIP один APK, патч от ab638d6, результаты и исходные workflow для той же реализации. PWA YAML нужен только для согласованного журнала/счётчика, не для нативного исправления времени; актуальная Turnix/API-реализация сохраняется. Изменения GitHub/production не объявляются опубликованными до фактического применения. Коммиты/перечень файлов — CHANGESET.json.
