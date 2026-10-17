# GitHub и выпуск версий

Проверки разработки, ручная сборка установщиков для macOS ARM64 и Windows x64 и выпуск версий через GitHub Releases.

## Согласованность версии

Версия должна совпадать в `package.json`, обеих корневых записях `package-lock.json`, `src-tauri/tauri.conf.json`, package-секции `src-tauri/Cargo.toml` и записи `clex-flow` в `src-tauri/Cargo.lock`.

```sh
node scripts/check-version.mjs
```

Теги версий используют формат `vMAJOR.MINOR.PATCH`. При изменении версии обновите конфигурации и lockfiles, затем повторите проверку.

## Сборка для тестирования

Конфигурация установщика применяется отдельно от режима разработки:

```sh
npm ci
npm run lint
npm test
node scripts/check-version.mjs
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run test:firmware-parity
npm run tauri -- build --target aarch64-apple-darwin --config src-tauri/tauri.release.conf.json --bundles app,dmg -- --locked
```

Нужны macOS Apple Silicon, Node.js 22.12+, Rust и Xcode Command Line Tools. ESP-IDF для сборки самого приложения не требуется. Для MCU-эксперимента нужна отдельная существующая ESP-IDF 5.4.4, как описано в [esp-idf.md](esp-idf.md).

Для Windows x64 после тех же проверок выполните:

```sh
npm run tauri -- build --target x86_64-pc-windows-msvc --config src-tauri/tauri.windows.release.conf.json --bundles nsis -- --locked
```

Целевой target должен быть установлен через `rustup target add`. Исходный код не запрещает ручную сборку macOS Intel, но установщики Intel не входят в матрицу выпусков.

Установщик macOS находится в `src-tauri/target/<target>/release/bundle/dmg/`, Windows – в `src-tauri/target/<target>/release/bundle/nsis/`. `.app` содержит MIT и сторонние уведомления в `Contents/Resources/`. Сборки/сертификаты не коммитятся.

## GitHub Actions

Файл: `.github/workflows/build-macos.yml`. Матрица: macOS ARM64 (`macos-15`) и Windows x64 (`windows-latest`). Target соответственно `aarch64-apple-darwin` и `x86_64-pc-windows-msvc`; Node 22 и Rust 1.93.1. Actions закреплены полными SHA. Используется официальный `tauri-apps/tauri-action`, существующие lockfiles и `beforeBuildCommand`; загрузка/установка ESP-IDF не выполняется.

### Обычная разработка

При push в `main` и в pull requests запускается **Check source** (`check-source.yml`): согласованность версии, ESLint, unit-тесты JavaScript и сборка веб-интерфейса. Изменения только Markdown, документации и лицензии пропускают автоматические проверки.

**Check native source** (`check-native.yml`) запускается при изменении Rust/Tauri, `src/`, тестов, файлов зависимостей, скриптов проверки версии/генерации или самого workflow. Проверяет форматирование, unit-тесты Rust и совпадение файлов прошивки JavaScript/Rust для 24 конфигураций S3/P4/Nano на macOS и Windows, с кешированием зависимостей и результатов компиляции. Ресурсы интерфейса подготавливаются для нативных тестов; установщики не создаются. Проверки не устанавливают ESP-IDF и не запускают интеграционные тесты, требующие SDK или сети.

Оба workflow можно запустить вручную. Для новых изменений той же ветки устаревшие проверки отменяются.

### Подготовка версии

Полная сборка установщиков запускается **только вручную**: **Build desktop installers → Run workflow**, с указанием конкретного проверенного commit или существующего тега. Push коммита/тега и создание Release не запускают её автоматически.

Права всех workflow – `contents: read`. Сборка не передаёт Tauri action параметры `tagName`, `releaseName` или `releaseId`; автоматическая публикация отключена. Результат – artifact с `.dmg` или `.exe` и SHA-256, срок хранения 30 дней.

Порядок выпуска по отдельному запросу:

1. Выберите проверенный commit и вручную соберите установщики именно из него.
2. Проверьте полученные файлы и их контрольные суммы на соответствующих системах.
3. Перед созданием тега и Pre-release проверьте уже существующие теги и Releases. Используйте фактическую версию приложения; существующие теги не перемещайте.
4. После подтверждения готовности создайте новый Pre-release, опишите реализованные возможности на русском языке и вручную прикрепите проверенные установщики из того же commit, что и тег. Без установщиков релиз может содержать исходный код.

Изменения `main` не меняют уже опубликованные теги и Releases. Новые установщики и релиз публикуются отдельно. Для очередной версии сначала отдельно согласуются её номер и состав; обычная разработка номер версии не повышает.

Для подготовки v0.1.2 пользователь подтвердил успешную прошивку и работу ESP32-S3-ETH и ESP32-P4-NANO. Аппаратную проверку отдельных профилей P4 (DSI/touch, аудио, камера) и восстановления Ethernet после потери Link следует фиксировать отдельно.

При подготовке v0.1.6 пользователь подтвердил радиообмен ESP-NOW и переключение Normal/Long Range на двух физических ESP32-S3, прошивку и выполнение программы на Arduino Nano. Это подтверждение не расширяет аппаратные заявления для остальных периферийных драйверов P4.

## Проверка перед прикреплением DMG

Проверьте установку из DMG и запуск на чистом Apple Silicon Mac, операции JSON-проектов, монтаж, три линии графа Blink, Undo/Redo, автосохранение, SDK-пути и настоящую сборку MCU. Отдельно подтвердите модель/ревизию платы, резистор/LED, выбранный порт, запись, Serial и Blink. Непроверенную аппаратную совместимость не указывайте в релизе.

Сверьте `CFBundleShortVersionString`, архитектуру, файл уведомлений, контрольную сумму и состояние подписи именно распространяемого файла. Не загружайте локальные JSON-проекты, SDK или журналы с персональными путями.

## Подпись и нотариализация macOS

Release overlay сейчас использует **ad-hoc** signing identity `-`. Она подходит для предварительной сборки Apple Silicon, но не подтверждает разработчика и не является Developer ID/notarization. Gatekeeper может блокировать скачанный установщик без Developer ID и нотариализации.

Предварительные выпуски не используют платные сертификаты, Developer ID, нотариализацию или внешние сервисы подписи. Локальная ad-hoc подпись остается техническим требованием ARM64. Инструкции первого запуска для macOS и Windows приведены в [README](../README.md#установка).

Источники: [официальный pipeline Tauri](https://v2.tauri.app/distribute/pipelines/github/), [build-only режим tauri-action](https://github.com/tauri-apps/tauri-action#tips-and-caveats), [подпись macOS](https://v2.tauri.app/distribute/sign/macos/), [DMG](https://v2.tauri.app/distribute/dmg/).

Windows использует `src-tauri/tauri.windows.release.conf.json` и NSIS; установщик успешно собран в Actions, его установка и работа SDK на пользовательской Windows требуют отдельной проверки. SDK/компиляторы не включаются в установщики ни одной платформы.
