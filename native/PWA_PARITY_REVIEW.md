# Сверка Connect PWA → Android, 9 ноября 2026

Эталон: `Chimera1988/connect-messenger@df71ca06e615ca5f981ae9276bd3642587f76e1a`.
Исходный Android: `Chimera1988/connect-android@35c5db6c1ede1bd723c2b63dc204db2b6b623a8e`.
Проверены текущие исходники PWA, Android и старая матрица 199 пунктов. Ниже перечислены найденные различия и внесённые исправления. Это не утверждение о 100% совпадении работающих приложений.

## Что перенесено и исправлено

| Область | Что отличалось / исправление | Код |
|---|---|---|
| Оболочка и вход | Обработка ошибок и 15-секундный timeout входа, освобождение busy; окончание загрузки при сетевой ошибке; защита от перекрывающего polling и результатов старого аккаунта; обновление при возврате из фона | `src/App.tsx`, `src/nativeAppUtils.ts` |
| Навигация | Возврат из профиля в открытый чат; аппаратная кнопка назад закрывает инструменты чата и страницы настроек; поиск сбрасывается при переключении вкладок; контакты ищутся по имени и bio | `src/App.tsx`, `src/ConnectNativeChat.tsx`, `src/ConnectNativeSettings.tsx` |
| История | История удалённого участника сохраняется; заблокированные профили исключены из контактов; исправлены preview пересланных сообщений и даты списка | `src/App.tsx`, `src/nativeAppUtils.ts` |
| Чтение | Отметки по видимым сообщениям вместо немедленного прочтения всего диалога; вход у первого непрочитанного; разделитель; последовательная отправка receipts; окно истории 500 сообщений как PWA | `src/ConnectNativeChat.tsx`, `src/ConnectNativeChatReading.ts` |
| Доставка | Входящие из открытого списка чатов подтверждаются доставленными без изменения last_read_at; повтор при ошибке, пауза в фоне, защита более свежего server receipt | `src/ConnectNativeInbox.ts` |
| Локальные данные | Убраны недопустимые двоеточия SecureStore: скрытие чатов/сообщений, избранное/недавние стикеры, read markers, просмотр пропущенных звонков. Старые ошибочные ключи не могли сохраниться | `src/App.tsx`, `src/ConnectNativeStickers.tsx`, `src/ConnectNativePush.ts`, `src/ConnectNativeMissedCalls.ts` |
| Уведомления | Прочтение старого сообщения не удаляет новый push или входящий звонок; границы read timestamps не откатываются; cross-device reconcile использует timestamp уведомления | `src/ConnectNativePush.ts`, `src/ConnectNativeReadSync.ts` |
| Пересылка | Альбом копирует объекты/постеры в приватный каталог получателя, откат неудачного копирования, retry не дублирует уже отправленное; небольшой файл может пересылаться через download/upload при ошибке storage.copy | `src/ConnectNativeChat.tsx` |
| Медиа | Inline video по видимости и foreground, mute/fullscreen; кадры-превью видео в альбомах/профиле; gallery swipe между медиа сообщений и альбомов; preview перед отправкой камеры; переход по цитате; PWA-compatible dimensions и JPEG poster при загрузке | `src/ConnectNativeMedia.tsx`, `src/ConnectNativeAlbum.tsx`, `src/nativeMediaPreview.ts` |
| Голосовые | Устранён конфликт двух heartbeat записи; одна 8-секундная lease; одновременное воспроизведение voice notes исключено; предварительная волна из декодированного файла без проигрывания и без запроса микрофона | `src/ConnectNativeChat.tsx`, `src/ConnectNativeMedia.tsx`, `src/nativeWaveform.ts`, `plugins/waveform/` |
| Звонки | Realtime signaling/ICE плюс polling fallback; очередь ICE сохраняется после ошибки; отмена во время запроса микрофона/TURN/offer; защита двойного нажатия; ответ Telecom привязан к callId; актуальность входящего проверяется перед показом | `src/ConnectNativeVoice.tsx`, `src/ConnectNativeTelecom.ts`, `src/ConnectNativePush.ts` |
| Внешний вид звонка | Карточка, аватар, CONNECT · АУДИО, имя, статусы, таймер и подписанные кнопки по структуре PWA | `src/ConnectNativeVoice.tsx` |
| Профиль | Общий редактор имени/bio/аватара доступен в самом профиле и настройках, JPEG crop сохраняется | `src/ConnectNativeSettings.tsx`, `src/App.tsx` |
| Новые функции эталона | Обычные/скрытые приглашения с invite_type; управление видимостью участников через существующий admin endpoint. Эти функции отсутствовали в старой матрице 199 | `src/ConnectNativeInvites.tsx` |
| Внешний вид | Шесть исходных SVG геометрий вместо одинаковых волн; семь акцентных триад и произвольный HEX; фон светлой/тёмной тем; safe areas; reduced motion/background pause | `src/ConnectNativeScene.ts`, `src/ConnectNativeGlass.tsx`, `src/ConnectNativeAppearance.ts`, `src/App.tsx` |
| Glass | Настоящий Android backdrop blur через Expo 58 BlurTargetView и blurTarget для дока/панелей/заголовков/композера; API <31 получает предусмотренный SDK fallback; reduced transparency/minimal — solid | `src/ConnectNativeGlassPanel.tsx` |
| Цвет | Исправлен HEX-ввод; непрерывная HSV палитра и accessible sliders | `src/ConnectNativeColorPicker.tsx`, `src/nativeColorUtils.ts`, `src/ConnectNativeSettings.tsx` |
| Данные | Экспорт действительно достигает лимита 50 000 без прежнего обрыва около 25 000 и превышения остатка страницы; сброс настроек очищает локальное избранное/недавние стикеры | `src/ConnectNativeSettings.tsx`, `src/ConnectNativeStickers.tsx` |

Музыка, приглашения/пароли, видеокружки, медиатека, наборы стикеров, звуки, мини-плеер и мини-игра уже имели нативные реализации. Проверка их исходников не равна аппаратной приёмке. Видимого регулятора громкости музыки в текущем PWA нет: используется системная громкость, лишний контрол не добавлялся.

## Что ещё различается / требует отдельной разработки

- **06.13 / 09.10 — системная вставка изображений и клавиатурных GIF.** Фото из буфера добавляется через меню вложений. Нативный TextInput пока не обрабатывает Android IME `commitContent` / `receiveContent` и вставку картинки непосредственно системным пунктом «Вставить». Для этого нужен отдельный Android bridge TextInput с временными URI-разрешениями; обычный текст/эмодзи и меню буфера работают через имеющиеся интерфейсы.
- **Сохранение файла** вызывает системное Android-меню «Сохранить / Поделиться». Это платформенный аналог браузерного download, а не обещание автоматического появления файла в галерее.
- **Пиксельное совпадение не подтверждено.** Геометрия, палитры, blur и расположение перенесены в React Native. Шрифты, SVG filters, системные safe areas, клавиатура, размеры и анимации надо сравнить парными скриншотами на реальном Android.
- Новый waveform module сгенерирован Expo; локальной Android SDK в этой среде нет, поэтому Java/Kotlin-компиляция и реальные AAC/MP3/Opus/PCM не подтверждены. Для старых development builds/неподдерживаемых кодеков остаётся нейтральная волна, воспроизведение доступно. Лимиты декодирования: 128 МБ, 30 минут, 45 секунд download и decode; память ограничена, временный файл удаляется.

## Проверки

Локально пройдены установка locked dependencies, `npm run typecheck`, `npm test`, Metro Android/Hermes export, Expo Android prebuild с регистрацией waveform package, self-test/генерация старого аудита, YAML parser, actionlint и `git diff --check`.

Тесты исполняют production hooks/helpers с подменой native/network boundaries: read viewport, delivery, ICE/cancel-races, timestamps уведомлений, экспорт, палитры/геометрия, blur, очередь/кэш/cleanup waveform. Они не имитируют успешную доставку через настоящий сервер.

Старый аудит 199 пунктов по-прежнему является **поиском текстовых признаков**, не тестом работы. Он обновлён на текущий reference SHA; удаление PCM-listener меняет число признаков, хотя функция заменена полноценным decoder. Из score нельзя получать проценты готовности или разрешение на релиз.

## Как применить YAML-установщик

1. Загрузить выданный `connect-native-port.yml` в `.github/workflows/connect-native-port.yml` репозитория `Chimera1988/connect-android`.
2. Открыть Actions → **Connect Native — install audited PWA port (no APK)** → Run workflow на нужной ветке.
3. Workflow проверит применимость diff, установит исходники, выполнит TypeScript/тесты/Metro/prebuild, сохранит native/ и README.md коммитом в выбранную ветку и приложит отчёт. Повторный запуск уже применённого diff безопасен. При несовместимых изменениях он остановится без перезаписи файлов.
4. `compile_native=true` дополнительно компилирует Java/Kotlin и native dependencies без APK. APK/AAB, установка приложения, публикация и backend migrations не выполняются.

Для push у Actions должно быть разрешение **Read and write permissions** для GITHUB_TOKEN. Если политика репозитория запрещает запись, результаты проверок и полный source archive остаются в artifacts — их можно скачать и применить вручную.

## Аппаратная приёмка перед выпуском

Проверить на двух аккаунтах Android↔PWA: приглашения (обычные/скрытые), авторизация/пароль, сообщения/альбомы/пересылка/прочтение/удаление, фото/видео/GIF, голосовые/видеокружки/постеры/галерея; FCM при активном/фоновом/закрытом/заблокированном приложении; входящий/исходящий/занято/отклонён/пропущен; микрофон/динамик/Bluetooth/аудиофокус; звуки/уведомления/разрешения; профиль/медиатека/мини-плеер; светлая/тёмная тема, семь сцен и произвольный цвет. Сохранить скриншоты, устройство, версию Android и результат каждого сценария.

Схема базы, серверные endpoints, эталонный PWA и существующие данные не изменялись.
