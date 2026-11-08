### Connect Native — этап 10: 199-пунктовая проверка (NO APK)
- 199 пунктов / 20 групп. Текстовые признаки в исходниках: **180**; требуют разбора: **19**.
- Подтверждений реальным устройством: **0/199** (их нельзя получить при TypeScript-проверке).
- Релиз: **НЕ ГОТОВ**. Автоматическая проверка НЕ открывает выпуск APK.
- Технические защитные проверки: все прошли
- Подробности: Actions → artifacts → `connect-native-phase10-parity-report`.

| Проверка | Результат |
|---|---|
| Android user-facing app name is Connect | OK |
| App package remains com.connect.messenger | OK |
| Calls remain audio-only (no video:true) | OK |
| Native UI does not mount a WebView | OK |
| Phase 9 mini-game source is present | OK |
| Phase 9 cross-device read sync source is present | OK |
| Native call bridge is present | OK |
| Native FCM push integration is present | OK |
| Legacy APK auto-build disabled | OK |
