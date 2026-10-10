# GitHub и выпуск версий

Проверки разработки, ручная сборка установщиков для macOS ARM64/Intel и Windows x64 и выпуск версий через GitHub Releases.

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
npm run tauri -- build --target aarch64-apple-darwin --config src-tauri/tauri.release.conf.json --bundles app,dmg -- --locked
```

Нужны macOS Apple Silicon, Node.js 22.12+, Rust и Xcode Command Line Tools. ESP-IDF для сборки самого приложения не требуется. Для MCU-эксперимента нужна отдельная существующая ESP-IDF 5.4.4, как описано в [esp-idf.md](esp-idf.md).

Для Windows x64 после тех же проверок выполните:

```sh
npm run tauri -- build --target x86_64-pc-windows-msvc --config src-tauri/tauri.windows.release.conf.json --bundles nsis -- --locked
```

Для macOS Intel замените target на `x86_64-apple-darwin`. Целевой target должен быть установлен через `rustup target add`.

Установщик macOS находится в `src-tauri/target/<target>/release/bundle/dmg/`, Windows – в `src-tauri/target/<target>/release/bundle/nsis/`. `.app` содержит MIT и сторонние уведомления в `Contents/Resources/`. Сборки/сертификаты не коммитятся.

## GitHub Actions

Файл: `.github/workflows/build-macos.yml`. Матрица: macOS ARM64 (`macos-15`), macOS x64 (`macos-15-intel`) и Windows x64 (`windows-latest`). Target соответственно `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc`; Node 22 и Rust 1.93.1. Actions закреплены полными SHA. Используется официальный `tauri-apps/tauri-action`, существующие lockfiles и `beforeBuildCommand`; загрузка/установка ESP-IDF не выполняется.

### Обычная разработка

При push в `main` и в pull requests запускается **Check source** (`check-source.yml`): согласованность версии, ESLint, unit-тесты JavaScript и сборка веб-интерфейса. Изменения только Markdown, документации и лицензии пропускают автоматические проверки.

**Check native source** (`check-native.yml`) запускается при изменении Rust/Tauri, файлов зависимостей, проверки версии или самого workflow. Проверяет форматирование и unit-тесты Rust на macOS и Windows, с кешированием зависимостей и результатов компиляции. Ресурсы интерфейса подготавливаются для нативных тестов; установщики не создаются. Проверки не устанавливают ESP-IDF и не запускают интеграционные тесты, требующие SDK или сети.

Оба workflow можно запустить вручную. Для новых изменений той же ветки устаревшие проверки отменяются.

### Подготовка версии

Полная сборка установщиков запускается **только вручную**: **Build desktop installers → Run workflow**, с указанием конкретного проверенного commit или существующего тега. Push коммита/тега и создание Release не запускают её автоматически.

Права всех workflow – `contents: read`. Сборка не передаёт Tauri action параметры `tagName`, `releaseName` или `releaseId`; автоматическая публикация отключена. Результат – artifact с `.dmg` или `.exe` и SHA-256, срок хранения 30 дней.

Порядок выпуска по отдельному запросу:

1. Выберите проверенный commit и вручную соберите установщики именно из него.
2. Проверьте полученные файлы и их контрольные суммы на соответствующих системах.
3. Перед созданием тега и Pre-release проверьте уже существующие теги и Releases. Используйте фактическую версию приложения; существующие теги не перемещайте.
4. Создайте или обновите согласованный Pre-release, опишите реализованные возможности на русском языке и вручную прикрепите проверенные установщики из того же commit, что и тег. Без установщиков релиз может содержать исходный код.

Уже опубликован Pre-release `v0.1.0`. Последующие изменения `main` не меняют этот тег и не публикуются автоматически. Для очередной версии сначала отдельно согласуются её номер и состав; обычная разработка номер версии не повышает.

## Проверка перед прикреплением DMG

Проверьте установку из DMG и запуск на чистом Apple Silicon Mac, операции JSON-проектов, монтаж, три линии графа Blink, Undo/Redo, автосохранение, SDK-пути и настоящую сборку MCU. Отдельно подтвердите модель/ревизию платы, резистор/LED, выбранный порт, запись, Serial и Blink. Непроверенную аппаратную совместимость не указывайте в релизе.

Сверьте `CFBundleShortVersionString`, архитектуру, файл уведомлений, контрольную сумму и состояние подписи именно распространяемого файла. Не загружайте локальные JSON-проекты, SDK или журналы с персональными путями.

## Подпись и нотариализация macOS

Release overlay сейчас использует **ad-hoc** signing identity `-`. Она подходит для предварительной сборки Apple Silicon, но не подтверждает разработчика и не является Developer ID/notarization. Gatekeeper может блокировать скачанный установщик без Developer ID и нотариализации.

Для обычного внешнего распространения подготовьте Apple Developer ID Application, подпись приложения/DMG, отправку в Apple notary service и stapling. Сертификат, пароль и Apple credentials храните в GitHub Secrets или защищённом локальном окружении. Подпись и нотариализация не настроены в текущем workflow.

Источники: [официальный pipeline Tauri](https://v2.tauri.app/distribute/pipelines/github/), [build-only режим tauri-action](https://github.com/tauri-apps/tauri-action#tips-and-caveats), [подпись macOS](https://v2.tauri.app/distribute/sign/macos/), [DMG](https://v2.tauri.app/distribute/dmg/).

Windows использует `src-tauri/tauri.windows.release.conf.json` и NSIS; установщик успешно собран в Actions, его установка и работа SDK на пользовательской Windows требуют отдельной проверки. SDK/компиляторы не включаются в установщики ни одной платформы.
