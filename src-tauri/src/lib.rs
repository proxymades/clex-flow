mod idf;
mod idf_environment;
mod menu;
mod projects;
mod sdk;
mod sdk_installer;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(idf::Service::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(service) = window.app_handle().try_state::<idf::Service>() {
                    idf::shutdown(&service);
                }
            }
        })
        .menu(menu::build)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit-studio" {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("studio-quit-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            projects::list_projects,
            projects::save_project,
            projects::delete_project,
            projects::import_project,
            projects::export_project,
            projects::storage_path,
            idf::idf_environment,
            idf::idf_ports,
            idf::idf_build,
            idf::idf_flash,
            idf::idf_monitor,
            idf::idf_cancel,
            idf::idf_events,
            sdk::sdk_list,
            sdk::sdk_refresh_versions,
            sdk::sdk_register,
            sdk::sdk_select,
            sdk::sdk_install,
            sdk::sdk_install_plan,
            sdk::sdk_remove,
        ])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить CLEX Flow");
}
