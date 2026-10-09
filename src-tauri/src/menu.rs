use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Wry,
};

// Нативный пункт Quit macOS завершает процесс напрямую. Пользовательский
// пункт направляет ⌘Q через проверку несохранённых изменений в frontend.
pub fn build(app: &AppHandle<Wry>) -> tauri::Result<Menu<Wry>> {
    let quit = MenuItem::with_id(
        app,
        "quit-studio",
        "Завершить CLEX Flow",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let application = Submenu::with_items(
        app,
        "CLEX Flow",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("О CLEX Flow"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "Файл",
        true,
        &[&PredefinedMenuItem::close_window(
            app,
            Some("Закрыть окно"),
        )?],
    )?;
    let edit = Submenu::with_items(
        app,
        "Правка",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Отменить"))?,
            &PredefinedMenuItem::redo(app, Some("Повторить"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Вырезать"))?,
            &PredefinedMenuItem::copy(app, Some("Скопировать"))?,
            &PredefinedMenuItem::paste(app, Some("Вставить"))?,
            &PredefinedMenuItem::select_all(app, Some("Выделить всё"))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Окно",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Свернуть"))?,
            &PredefinedMenuItem::maximize(app, Some("Масштабировать"))?,
            &PredefinedMenuItem::close_window(app, Some("Закрыть окно"))?,
        ],
    )?;
    Menu::with_items(app, &[&application, &file, &edit, &window])
}
