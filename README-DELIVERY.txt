Исправление итогового workflow Connect Android — 16 ноября 2026

База репозитория: Chimera1988/connect-android@20dab66175e05640a6eee5faa97b9e6b641e2851
Проверенный локальный commit: 0d94692c4556aef5ab761a91f0fbe07a233f7e02
PWA main: 55a5314043e604bdd2f21d35a032bc34fc1ce075

Установить ВСЕ шесть файлов из архива в существующий репозиторий по их путям.
Сохраняйте прежнее имя .github/workflows/connect-android-parity-notifications-final.yml.
Один YAML без native/scripts/check-parity-source.mjs и native/PARITY_SOURCE_LOCK.json
несовместим: SOURCE_DRIFT намеренно проверяет их совместно.
Повторная замена файлов теми же байтами не создаёт дополнительных правок.
Не запускать исторические install-sources workflows заново: они вернут прежний снимок.

Альтернатива для git: на указанной базе проверить и применить Connect-Android-CI-repair.patch
через git apply --check и git apply. При неизвестных изменениях сначала проверить diff;
не перезаписывать текущие правки и не делать force-push.

После установки: Actions → Connect Android — PWA parity and notification verification.
release_candidate=false выполняет проверки без APK.
release_candidate=true дополнительно требует прежнюю совместимую недебажную подпись.
APK не создавался: прежний сертификат 3.0.5 — Android Debug fallback; безопасный выпуск
с сохранением сертификата не подтверждён. Ключи и пользовательские данные не менялись.

Локально: Node170/170, browser15/15, Python4/4, JVM77/77; build:web, TypeScript,
clean Expo Prebuild, Kotlin/Java compilation и Android lint успешны. Lint:0 errors/107 warnings.
Две новые регрессии воспроизвели неверное SDK имя и проверили исправленный bash-шаг YAML.
Browser executable локально /usr/bin/chromium; в CI устанавливается locked Playwright browser.

Публикация: GitHub API отклонил создание ветки HTTP403:
Resource not accessible by integration. Удалённая main не изменена этим исправлением.
Нового успешного GitHub run нет. Ссылки на два диагностированных запуска — в отчёте.
