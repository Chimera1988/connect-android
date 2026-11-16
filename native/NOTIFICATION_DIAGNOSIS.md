# Диагностика уведомлений, 15 ноября 2026

Android `2948c22`, PWA `55a5314`. Supabase-проект проверен read-only через подключённый MCP. Журналы Next/FCM сервера и физический телефон для воспроизведения недоступны; ниже отдельно приведены реальные технические результаты Supabase. Подтверждённые дефекты ниже отделены от непроверенных причин живых пропусков.

## A. Прочитанные уведомления

Подтверждено и исправлено:

1. В активном HybridConnect не монтировался useConnectNativeReadSync, хотя файл существовал. Подключён к ownerId в App.tsx. Старые ConnectNativeChat/Inbox не являются активным UI.
2. dismissChatPush ожидал pending display, но не резервировал очередь на время getDisplayedNotifications/cancelNotification. Новый display мог заменить тот же chat ID между timestamp-проверкой и отменой, после чего cancel удалял уже новое непрочитанное уведомление. Тест с барьером воспроизводит потерю. Теперь display/cancel используют одну очередь на чат.
3. Явный message-summary не очищался. Теперь message/chat/message-summary summaries одного чата отменяются только без нового/недатированного unread child. Другой чат, incoming-call и missed-call сохраняются. Автоматические Android group summaries управляются ОС после удаления children и требуют телефона.
4. Date.parse терял микросекунды PostgreSQL: unread message позже readAt в той же миллисекунде мог ошибочно отменяться. Теперь используется общий chatTimeKey PWA для сохранения точности; тест воспроизводит и проверяет границу.
5. Исправлено восстановление повреждённого read timestamp. Обычные маркеры по-прежнему монотонны и сериализованы.

Цепочка: web markRead/viewport → успешный upsert conversation_user_state.last_read_at → ConnectAndroid.dismissConversationNotifications(id,iso) → versioned read bridge → rememberReadAt/dismissChatPush → Notifee.cancelNotification → Android NotificationManager. Это настоящая отмена системного уведомления, а не скрытие в интерфейсе.

Другие устройства: `/api/push/read` проверяет серверный last_read_at и отправляет normal-priority read hint (TTL5мин). Его мгновенное выполнение под Doze не гарантируется. Теперь при foreground/resume/Realtime и ограниченной 35-секундной сверке видимых message alerts монтируемый hook получает авторитетные границы чтения. Агрессивного message polling вместо FCM нет.

Уведомление без корректного createdAt намеренно не считается прочитанным. Legacy alerts без времени остаются ограничением: нельзя удалять потенциально новый push по времени получения. Обычный текущий webhook передаёт created_at.

## B. Доставка

Исправленные клиентские причины ошибочного поведения:

- Указанная гонка display/cancel могла удалить реально полученный новый push.
- После ошибки/эвикции WebView сохранялся visibleConversation. Неотображаемый бывший чат продолжал подавлять push. App callbacks теперь сбрасывают native visible/active chat; регрессионный тест выполняет реальные callback bodies.
- Дедупликация сравнивала messageId только с текущей шторкой. После swipe/restart дубликат мог появиться снова. Теперь последний успешно показанный ID/time хранится в SecureStore на чат; более старый push не заменяет новый. Повреждённый JSON не блокирует последующие сообщения.

Проверенный существующий транспорт сохранён:

- ConnectPushTokenService.onNewToken сохраняет токен через зашифрованное native хранилище.
- ConnectPushTokenJob: persisted JobScheduler, NETWORK_TYPE_ANY, exponential backoff; enable восстанавливает токен после login, в том числе выданный до login; cancellation/epoch защищают sign-out/account changes.
- ConnectCallSession и restore receiver сохраняют существующий boot/package-replacement путь. JS register/onTokenRefresh использует тот же `/api/push/register`.
- Manifest заменяет RN Firebase receiver/service одним Connect receiver/service. Сообщения идут штатным RNFirebase foreground/headless путём; звонки остаются у своего native владельца. Entry-point устанавливает background handler.
- Текущий сервер отправляет data-only messageId/conversationId/createdAt, priority=high, TTL24ч; показ принадлежит Notifee. Конкурирующий notification payload не создаётся. Сторонний mixed notification+data payload не является проверенным Connect-контрактом.

Не установлены без живых событий: факт создания/повтора webhook; время server queue/FCM acceptance; реальный токен и Firebase project телефона; запуск headless JS; реальные POST_NOTIFICATIONS/channel block; OEM battery restrictions, Doze, force-stop, переход сетей, cold boot/reinstall.

Риск по серверному коду: message route обходит devices последовательно, поэтому медленный Web Push способен задержать последующий Android send. Это не доказанная причина конкретного production пропуска. Сервер этой работой не изменялся. Постоянный foreground service или агрессивный polling для сообщений не добавлялись.

## C. Вибрация

Проверен ConnectNativeSoundSettings: канал зависит от tone/silent/vibrate/custom URI; существующие каналы не переписываются. Старая soft→new resource миграция сохраняет block, importance, DND, visibility, vibration и пользовательский sound. Системное отключение нельзя обходить созданием нового канала.

Новые message channels явно получают vibration true/false и pattern `[200,100,200,100]` при разрешённой вибрации, bypassDnd=false. Message display явно использует onlyAlertOnce=false: новый message в том же chat ID может подавать сигнал. Уже созданные каналы не удаляются/пересоздаются для сброса ограничений. Нативные звонки и их отдельная vibration policy сохранены.

Дополнительно воспроизведена ошибка старой миграции: Android/OEM может вернуть pattern с нулевой задержкой или нечётной длиной, который Notifee 9.1.8 запрещает передавать в createChannel. Раньше копирование такого поля прерывало создание канала и показ push. Теперь при невозможности точно перенести pattern сохраняется исходный legacy channel, включая звук/вибрацию/системную блокировку; настройки не сбрасываются. Тест использует настоящий валидатор установленной Notifee. Это проверенная возможность отказа в коде, но без журнала телефона нельзя утверждать, что именно она вызвала конкретный наблюдавшийся пропуск.

Причина всей непоследовательной физической вибрации не доказана. На телефоне нужны фактические channel ID/importance/vibration, разрешения, Connect prefs, DND/режим звука и время каждого показа. Успех Notifee display не доказывает движение вибромотора.

## Диагностика и её пределы

ConnectNativePush хранит максимум 16 событий в `connect-native-push-trace-v1`; доступ через getNativePushDiagnostics() и кнопку «Журнал уведомлений» в настройках уведомлений Android (ограниченный authenticated bridge):

- stage: received/shown/read/dismissed/registered/registration-failed;
- at: время этапа устройства;
- eventAt: исходный валидный createdAt/подтверждённый readAt;
- conversationId и безопасный messageId для корреляции.

Нет body/title, сообщений, FCM/session tokens, SDP, URL и секретов. Ошибка diagnostic storage не блокирует показ/очистку. Прежние ключи сохраняют последние времена регистрации/получения. `shown` — успешный вызов Notifee, не физическая приёмка. `received` — JS FCM handler, не время низкоуровневого receiver.

Нынешний серверный message route не даёт коррелированных queue/FCM-response timestamps. Полная требуемая цепочка **ещё не подтверждена**. Для окончательного расследования нужен доступ к журналам работающего backend/webhook/FCM и logcat телефона во время воспроизведения; server instrumentation следует документировать и тестировать отдельно. Клиенту не приписаны выдуманные server timestamps.

Тесты исполняют production push/read code с подменой внешних Notifee/SecureStore/Supabase границ: границы чтения, другой unread chat, missed calls, summary, cancel/display race, persistent duplicate после restart, повреждённые маркеры, настройки tone/vibrate и privacy. Hook проверен на launch/resume/server read/error/unmount. Sound tests проверяют наследование user channels и pattern нового канала. Они не эмулируют production Firebase, NotificationManager или физический Android10.


## Read-only проверка работающего Supabase

15 ноября 2026, около 21:47–21:56 UTC, проект `tpwkmoxxzjfdsqsomhhr` ACTIVE_HEALTHY. Содержимое сообщений, endpoints/FCM tokens, subscriptions и секреты не читались; схема и данные не изменялись.

- INSERT trigger `connect_message_push_trigger` включён, вызывает `public.connect_message_push_notify`. В теле подтверждено использование `net.http_post` и пути `/api/push/message` (выбирались только технические признаки, не текст функции с секретами).
- В push_devices: 3 Android и 1 Web регистрации; needs_push_refresh=0 для всех. Android updated_at от 10:09:59 до 18:59:09 UTC 15 ноября. Это не проверка валидности каждого токена у FCM.
- Текущая net.http_request_queue пуста.
- В сохранённом буфере net._http_response 48 ответов за 12:35:57–17:35:49 UTC: HTTP200 — 40; HTTP401 — 3; HTTP500 — 2; HTTP503 — 2; транспортная ошибка без HTTP-статуса — 1; timed_out=0. Среди HTTP200: 27 ответов с sent=1, 4 с sent=0, 9 без sent. Буфер общий для pg_net: **нельзя приписать все ошибки отправке сообщений**, поскольку message trigger не сохраняет request_id в корреляционный журнал. HTTP200/sent также не является подтверждением показа на устройстве.
- В окне логов 14 ноября 21:47 — 15 ноября 21:47 UTC найдена 1 ошибка SQLSTATE57014 с context connect_message_push_notify: отмена SQL-запроса в контексте триггера. Без message/request correlation нельзя связать её с конкретным пропавшим уведомлением или считать ошибкой FCM.
- conversation_user_state **не входит** в публикацию supabase_realtime; messages входит. Поэтому instant callback state-подписки на работающем проекте не подтверждается. Android использует существующие HTTP сверки (shared foreground refresh и native launch/resume/35s checks) плюс read FCM hints; публикация базы не менялась.
- Подтверждены activity_kind/activity_until/typing_until/recording_until/last_read_at/last_delivered_at. Статусы активности считывает существующий shared refresh; новый competing state не создавался.
- Edge Functions connect-delete-forever (v1), connect-sticker-webp-convert (v4), connect-sticker-legacy-webp (v4) ACTIVE. Это подтверждение наличия deployment, а не межаккаунтный функциональный тест.

Эти результаты показывают реальные ошибки до/в HTTP-слое и отсутствие сквозной корреляции; сводить проблему к Android Doze или FCM оснований нет. Для завершения расследования нужны журналы работающего Next `/api/push/message` с response FCM и синхронный device journal/logcat на двух тестовых аккаунтах. Совместимое серверное instrumentation должно сохранять только eventId/requestId и created/queued/accepted/error timestamps без тела сообщения и token; новый серверный патч без его собственных тестов здесь не внедрялся.
