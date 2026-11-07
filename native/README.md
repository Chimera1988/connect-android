# Connect Native v2 — рабочая основа нового Android-клиента (не финальный APK)

## Цель
Полностью нативный Android-клиент без WebView. Тот же сервер Connect Messenger (Supabase + веб API), те же пользователи и данные. Никакой замены работающего `app/` до завершения всех функций и проверок. Пользовательский релиз — один, без промежуточных неполных версий.

## Уже реализовано в исходниках
- Expo SDK 58 / React Native 0.88, свой интерфейс Android, не WebView;
- защищённое хранение Supabase-сессии;
- вход в существующий Connect, переписки, отправка текста, контакты и профили;
- история вызовов из существующего `connect_calls`;
- семь цветовых вариантов (на текущем этапе адаптация палитры, не пиксельная копия веб-экрана);
- REST-запросы через тот же DuckDNS reverse-proxy, что и у PWA;
- сохранена старую WebView сборка в `app/` (native в папке `native/`).

## Добавлено в исходники мессенджера (без промежуточного APK)
- отдельный нативный экран чата с ответом, редактированием, удалением у обоих, выбором, копированием, пересылкой;
- выбор фото/видео, съёмка камерой, отправка документов через системный выбор Android, просмотр изображений, видео и прослушивание аудио;
- запись и отправка голосовых сообщений через `expo-audio` (Android разрешение RECORD_AUDIO);
- личные и чужие фото/видео/музыка в профилях, просмотр с переходом назад/вперёд, загрузка и удаление своих файлов;
- нативный журнал вызовов с выбором/удалением/очисткой только у себя (использует действующую таблицу `connect_call_journal_settings`);
- данные и формат вложений совместимы с Connect PWA, WebView не используется.

Важно: новые файлы пока грузятся напрямую до **20 МБ**. Для стабильной загрузки 20–100 МБ требуется реализовать возобновляемую отправку. Это не финальный релиз APK.

## Не реализовано в этой заготовке
Это старт исходного проекта, **не готовая замена существующему APK**: видеокружки, все форматы альбомов и стикеров, реакции, расширенный поиск, полная загрузка 100 МБ, полноценные FCM-пуши, запись токена устройства, нативные аудиозвонки WebRTC + Telecom, экран звонка на блокировке, выбранные мелодии и системные настройки разрешений. Их потребуется реализовать, протестировать и затем выпустить одной полной APK-сборкой. Не выдавать этот проект за законченное приложение.

## Как запускать при разработке
1. В директории `native/`: `npm install && npx expo install --fix`.
2. Настройте `.env` по `.env.example`. `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — **только** публикуемый клиентский ключ, не `service_role`.
3. `npx expo prebuild --platform android` для нативной Android-части.
4. `cd android && ./gradlew assembleRelease` для автономной сборки. Release APK может быть подписан только после настройки постоянного ключа подписи. Не заменять действующее приложение без проверки совместимости.
5. Android `applicationId` в разработке — `com.connect.messenger.native`, поэтому тестовую версию можно установить параллельно со старой.

## Технические ограничения
- Сетевой прокси покрывает HTTP, но не WebSocket. Для уведомлений и звонков необходима отдельная работа с FCM, WebSocket и push-транспор­том.
- Публичный SDK ключ идёт в мобильное приложение, а серверные secrets остаются на сервере.
- UI нативный: прямое копирование JSX/HTML/CSS из PWA не заменяет переноса поведения компонентов.
- При релизе использовать постоянную подпись и `applicationId=com.connect.messenger`, только после миграции и тестов.

## Native FCM notifications (source integration)
- Authenticated registration and removal of device tokens with Connect server.
- Native Android channels for messages and calls; data-only FCM handling and tap navigation.
- Uses existing Firebase app `com.connect.messenger` for future release only; do not install over WebView APK until fully tested and signed.
- WebRTC, Telecom, native incoming-call UI and lock-screen call acceptance are not implemented by this workflow.

## Native audio calls (foreground)
- Audio WebRTC calls use existing Connect `connect_calls` RPC and `connect_call_ice` tables.
- Callers notify the existing Connect server via `/api/push/call`; TURN credentials come from authenticated `/api/calls/ice`.
- Android mic, earpiece/speaker routing, mute and audio focus use react-native-webrtc and react-native-incall-manager. No WebView.
- Incoming calls appear while the native application is open; FCM taps resync pending calls.
- Android Telecom / ConnectionService, full-screen locked-phone incoming UI, background media services, ringtone selection and real-device network testing remain necessary before replacement of the old APK.
- Audio RTC is not a replacement for Android's system volume APIs; hardware volume controls remain authoritative.

## Android Telecom / lock-screen calls
- Self-managed ConnectionService (react-native-callkeep): Connect draws its own voice call interface.
- High-priority Notifee incoming call notifications with Answer/Decline and a best-effort full-screen intent.
- User/device must permit full-screen call notifications on Android 14+. An active foreground call uses system audio focus.
- Incoming FCM and foreground polling both feed the same Supabase/WebRTC call; no duplicate server calls.
- Background/killed-app acceptance, Bluetooth/headset and lock-screen presentation require tests on real devices.
