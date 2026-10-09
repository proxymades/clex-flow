# GitHub и выпуск версий

Сборка установщиков для macOS Apple Silicon и порядок выпуска версий через GitHub Releases.

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

Установщик находится в `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/`. `.app` содержит MIT и сторонние уведомления в `Contents/Resources/`. Сборки/сертификаты не коммитятся.

## GitHub Actions

Файл: `.github/workflows/build-macos.yml`. Runner `macos-15` / ARM64, target `aarch64-apple-darwin`, Node 22, проверенная Rust 1.93.1. Actions закреплены полными SHA. Используется официальный `tauri-apps/tauri-action`, существующие lockfiles и `beforeBuildCommand`; загрузка/установка ESP-IDF не выполняется.

Триггеры:

1. В Actions явно выберите **Build macOS Apple Silicon → Run workflow**, указав проверяемую ветку, commit или существующий тег.
2. Сборка также запускается на событии `release.published`, после того как владелец отдельно создаст и опубликует Release. Проверяются соответствие тега версии и Pre-release для 0.1.0.

Push обычного коммита или тега сам по себе ничего не публикует и не запускает workflow. Права `contents: read`; action не получает `tagName`, `releaseName` или `releaseId`. Поэтому она не может создать тег/Release или прикрепить установщик к нему. Результат – review artifact с `.dmg` и SHA-256, срок хранения 30 дней. Проверка структуры DMG и unit-тесты не заменяют испытание приложения.

Порядок выпуска после проверки артефакта:

- Выберите конкретный проверенный commit; создайте `v0.1.0` на нём без перемещения существующих тегов.
- Создайте Release `CLEX Flow v0.1.0` со статусом Pre-release, опишите фактические ограничения.
- Если опубликованный Release вызвал новую сборку, проверьте именно новый артефакт; не считайте его проверенным только из-за одинаковой версии.
- После проверки вручную прикрепите точный `.dmg` и его SHA-256. Workflow не выполняет это автоматически.

## Проверка перед прикреплением DMG

Проверьте установку из DMG и запуск на чистом Apple Silicon Mac, операции JSON-проектов, монтаж, три линии графа Blink, Undo/Redo, автосохранение, SDK-пути и настоящую сборку MCU. Отдельно подтвердите модель/ревизию платы, резистор/LED, выбранный порт, запись, Serial и Blink. Непроверенную аппаратную совместимость не указывайте в релизе.

Сверьте `CFBundleShortVersionString`, архитектуру, файл уведомлений, контрольную сумму и состояние подписи именно распространяемого файла. Не загружайте локальные JSON-проекты, SDK или журналы с персональными путями.

## Подпись и нотариализация macOS

Release overlay сейчас использует **ad-hoc** signing identity `-`. Она подходит для предварительной сборки Apple Silicon, но не подтверждает разработчика и не является Developer ID/notarization. Gatekeeper может блокировать скачанный установщик без Developer ID и нотариализации.

Для обычного внешнего распространения подготовьте Apple Developer ID Application, подпись приложения/DMG, отправку в Apple notary service и stapling. Сертификат, пароль и Apple credentials храните в GitHub Secrets или защищённом локальном окружении. Подпись и нотариализация не настроены в текущем workflow.

Источники: [официальный pipeline Tauri](https://v2.tauri.app/distribute/pipelines/github/), [build-only режим tauri-action](https://github.com/tauri-apps/tauri-action#tips-and-caveats), [подпись macOS](https://v2.tauri.app/distribute/sign/macos/), [DMG](https://v2.tauri.app/distribute/dmg/).
