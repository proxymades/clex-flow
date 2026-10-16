# Изменения ESP-NOW

Реализация выполнена локально поверх ранее подготовленной поддержки Arduino Nano. Версия приложения сохранена: **0.1.5**. Коммит, отправка на GitHub, установщики и релиз в рамках этой задачи не создавались.

Настройки, блоки, ограничения и порядок проверки на двух платах описаны в [руководстве ESP-NOW](espnow.md).

## Проверки

- 145 JavaScript-тестов прошли; ESLint без ошибок.
- 60 Rust-тестов прошли, 5 интеграционных тестов по умолчанию пропущены; необходимые проверки SDK запускались отдельно.
- Совпадение файлов JavaScript/Rust-генератора проверено для 17 конфигураций.
- ESP-IDF 5.4.4 успешно собрал четыре сценария: запуск без peers, обмен командами, отправитель с кнопкой, ESP-NOW вместе с Ethernet и LVGL/ST7789.
- Универсальное событие GPIO проверено программно и компиляцией AVR для Nano.
- Два программных экземпляра C-драйвера прошли проверки HMAC, кириллицы, повторов, ACK, перезапуска, таймаутов, очереди и Normal/LR.
- Интерфейс проверен Playwright и просмотром скриншотов.
- Существующие сгенерированные файлы для S3 GPIO, S3 Ethernet/дисплея и P4 остались без изменений.
- Физическая радиосвязь между двумя платами еще требует проверки.

## Файлы этой задачи

Список получен сравнением SHA-256 с состоянием рабочего дерева перед началом ESP-NOW. Изменения Arduino Nano, уже существовавшие к этому моменту, не включены, кроме файлов, дополнительно измененных для ESP-NOW или универсального события GPIO.

- `README.md`
- `docs/architecture.md`
- `docs/espnow.md`
- `examples/espnow-button.clex.json`
- `examples/espnow-receiver.clex.json`
- `package.json`
- `scripts/check-firmware-parity.mjs`
- `src-tauri/src/idf.rs`
- `src/assembly/AssemblyInspector.jsx`
- `src/assembly/HardwareLibrary.jsx`
- `src/assembly/model.js`
- `src/catalog/assets/espnow.svg`
- `src/catalog/boards/espressif-devkitc-1-v1-1-n8r8.json`
- `src/catalog/boards/waveshare-esp32-s3-eth.json`
- `src/catalog/modules/clex.hardware.button.json`
- `src/catalog/modules/clex.hardware.espnow.json`
- `src/catalog/modules/clex.logic.espnow-ack.json`
- `src/catalog/modules/clex.logic.espnow-command-received.json`
- `src/catalog/modules/clex.logic.espnow-command-send.json`
- `src/catalog/modules/clex.logic.espnow-mode.json`
- `src/catalog/modules/clex.logic.espnow-received.json`
- `src/catalog/modules/clex.logic.espnow-send.json`
- `src/catalog/modules/clex.logic.espnow-status.json`
- `src/catalog/modules/clex.logic.gpio-edge.json`
- `src/espnow/EspNowSettings.jsx`
- `src/espnow/model.js`
- `src/firmware/drivers/esp-idf/espnow-runtime.js`
- `src/firmware/drivers/espnow.js`
- `src/firmware/drivers/gpio-edge.js`
- `src/firmware/generator.js`
- `src/firmware/platforms/arduino-avr.js`
- `src/firmware/runtime-profiles.json`
- `src/logic/LogicInspector.jsx`
- `src/logic/LogicLibrary.jsx`
- `src/logic/LogicNode.jsx`
- `src/logic/model.js`
- `src/screens/Workspace.jsx`
- `src/styles.css`
- `tests/espnow-fixture.js`
- `tests/espnow-runtime.mjs`
- `tests/espnow-ui.cjs`
- `tests/espnow.test.js`
- `tests/gpio-edge.test.js`
- `tests/input-edge-fixture.js`
- `tests/nano-runtime.mjs`
- `docs/espnow-changes.md` – этот отчет.
