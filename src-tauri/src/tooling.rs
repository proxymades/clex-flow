use crate::{arduino, idf, sdk, sdk_installer};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
};
use tauri::Manager;
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    root: Option<PathBuf>,
    #[serde(default)]
    previous_roots: Vec<PathBuf>,
}
fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("tooling.json"))
}
fn settings(app: &tauri::AppHandle) -> Result<Settings, String> {
    match fs::read(settings_path(app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn default_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("sdks"))
}
pub fn tools_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(settings(app)?.root.unwrap_or(default_root(app)?))
}
pub fn tool_roots(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    let s = settings(app)?;
    let mut roots = s.previous_roots;
    roots.push(default_root(app)?);
    if let Some(root) = s.root {
        roots.push(root);
    }
    roots.sort();
    roots.dedup();
    Ok(roots)
}
#[tauri::command]
pub async fn tooling_directory(
    app: tauri::AppHandle,
    state: tauri::State<'_, idf::Service>,
    root: Option<String>,
    choose: Option<bool>,
) -> Result<String, String> {
    if idf::busy(&state.0) {
        return Err("Дождитесь завершения операции".into());
    }
    let root = if choose.unwrap_or(false) {
        use tauri_plugin_dialog::DialogExt;
        let dialog_app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            dialog_app
                .dialog()
                .file()
                .set_title("Папка инструментов разработки")
                .blocking_pick_folder()
                .map(|path| path.into_path().map(|p| p.to_string_lossy().into_owned()))
                .transpose()
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??
    } else {
        root
    };
    if idf::busy(&state.0) {
        return Err("Дождитесь завершения операции".into());
    }
    if let Some(root) = root {
        let root = PathBuf::from(root.trim().trim_matches('"'));
        if !root.is_absolute()
            || root
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err("Выберите абсолютный путь папки инструментов".into());
        }
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        tempfile::NamedTempFile::new_in(&root)
            .map_err(|e| format!("Нет доступа на запись: {e}"))?;
        let root =
            crate::idf_environment::tool_path(&root.canonicalize().map_err(|e| e.to_string())?);
        let mut s = settings(&app)?;
        s.previous_roots = tool_roots(&app)?;
        s.root = Some(root);
        arduino::write_json(&settings_path(&app)?, &s)?;
    }
    Ok(tools_root(&app)?.to_string_lossy().into())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    target: String,
    name: String,
    ready: bool,
    diagnostic: String,
    estimated_min: u64,
    estimated_max: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    root: String,
    bundles: Vec<Bundle>,
    estimated_min: u64,
    estimated_max: u64,
}
const TARGETS: [(&str, &str); 3] = [
    ("esp32s3", "ESP32-S3 · ESP-IDF 5.4.4"),
    ("esp32p4", "ESP32-P4 · ESP-IDF 5.4.4"),
    (arduino::TARGET, "Arduino Nano · AVR Boards 1.8.6"),
];
fn probe(
    app: &tauri::AppHandle,
    inner: &idf::Inner,
    target: &str,
) -> Result<crate::idf_environment::Environment, String> {
    if target == arduino::TARGET {
        return arduino::auto_environment(app, None, None);
    }
    let selected = sdk::auto_environment(app, inner, None, None, None, target);
    if selected
        .as_ref()
        .is_ok_and(|env| env.sdk_version == sdk::REQUIRED_VERSION)
    {
        return selected;
    }
    // A manually selected newer SDK must not make the required version look ready.
    // Reuse another installed 5.4.4 before offering any download.
    let paths = sdk::Paths::for_app(app)?;
    let candidates = paths.load()?.installations.into_iter().filter(|sdk| {
        sdk.version == sdk::REQUIRED_VERSION && std::path::Path::new(&sdk.root).is_dir()
    });
    for sdk in candidates {
        if let Ok(env) = sdk::auto_environment(
            app,
            inner,
            Some(sdk.root),
            sdk.python,
            sdk.tools_path,
            target,
        ) {
            if env.sdk_version == sdk::REQUIRED_VERSION {
                return Ok(env);
            }
        }
    }
    Err(selected
        .err()
        .unwrap_or_else(|| format!("Для {target} нужна ESP-IDF {}", sdk::REQUIRED_VERSION)))
}
#[tauri::command]
pub async fn tooling_plan(
    app: tauri::AppHandle,
    state: tauri::State<'_, idf::Service>,
) -> Result<Plan, String> {
    let inner = state.0.clone();
    let id = "00000000-0000-4000-8000-000000000002";
    let lease = idf::reserve(&inner, id)?;
    let worker = inner.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut bundles = vec![];
        let mut min = 0;
        let mut max = 0;
        for (target, name) in TARGETS {
            let checked = probe(&app, &worker, target);
            let ready = checked.is_ok();
            let (estimated_min, estimated_max) = if ready {
                (0, 0)
            } else {
                let p = if target == arduino::TARGET {
                    arduino::install_plan()?
                } else {
                    sdk_installer::plan_for(sdk::REQUIRED_VERSION, target)?
                };
                (p.estimated_min, p.estimated_max)
            };
            min += estimated_min;
            max += estimated_max;
            bundles.push(Bundle {
                target: target.into(),
                name: name.into(),
                ready,
                diagnostic: checked.map(|env| env.version).unwrap_or_else(|e| e),
                estimated_min,
                estimated_max,
            });
        }
        Ok(Plan {
            root: tools_root(&app)?.to_string_lossy().into(),
            bundles,
            estimated_min: min,
            estimated_max: max,
        })
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    drop(lease);
    idf::release(&inner, id);
    result
}
pub fn stage(app: &tauri::AppHandle, inner: &Arc<idf::Inner>, id: &str, message: &str) {
    idf::publish(
        app,
        inner,
        id,
        "sdk_install",
        "running",
        "system",
        message,
        None,
    );
}
fn prepare_esp(
    app: &tauri::AppHandle,
    inner: &Arc<idf::Inner>,
    id: &str,
    target: &str,
    allow: bool,
    cancel: &Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    let paths = sdk::Paths::for_app(app)?;
    let slot = paths.slot_for(sdk::REQUIRED_VERSION, target)?;
    let package = sdk::managed_sdk_for(&slot, sdk::REQUIRED_VERSION, target);
    {
        let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
        let mut registry = paths.load()?;
        if let Some(old) = registry
            .installations
            .iter_mut()
            .find(|s| s.id == package.id)
        {
            old.state = "installing".into();
            old.diagnostic.clear();
        } else {
            registry.installations.push(package.clone());
        }
        paths.save(&registry)?;
    }
    let result = sdk_installer::install(app, inner, id, &paths, &package, allow, cancel);
    if cancel.load(Ordering::SeqCst) {
        let _ = sdk::installation_state(
            &paths,
            inner,
            &package.id,
            "interrupted",
            "Установка остановлена",
        );
    } else if let Err(e) = &result {
        let _ = sdk::installation_state(&paths, inner, &package.id, "failed", e);
    }
    result
}
#[tauri::command]
pub fn sdk_prepare_all(
    app: tauri::AppHandle,
    state: tauri::State<'_, idf::Service>,
    id: String,
    targets: Vec<String>,
    target: Option<String>,
    confirmed: bool,
    allow_prerequisites: bool,
) -> Result<(), String> {
    if !confirmed {
        return Err("Сначала подтвердите объем загрузки инструментов".into());
    }
    if targets.len() > 3 || targets.iter().any(|t| !TARGETS.iter().any(|(v, _)| t == v)) {
        return Err("Неизвестная платформа инструментов".into());
    }
    let selected = crate::boards::target(target)?;
    let inner = state.0.clone();
    let cancel = idf::reserve(&inner, &id)?;
    std::thread::spawn(move || {
        let saved = inner.environment.lock().ok().and_then(|e| e.clone());
        let result = (|| {
            for (target, name) in TARGETS {
                if cancel.load(Ordering::SeqCst) {
                    return Ok(None);
                }
                stage(&app, &inner, &id, &format!("Проверка {name}"));
                if probe(&app, &inner, target).is_ok() {
                    stage(&app, &inner, &id, &format!("{name}: готово"));
                    continue;
                }
                // Only the packages shown and confirmed in the plan may be downloaded.
                if !targets.iter().any(|t| t == target) {
                    return Err(format!("{name}: окружение изменилось. Повторите проверку и подтвердите новый объем загрузки."));
                }
                if target == arduino::TARGET {
                    arduino::install(&app, &inner, &id, &cancel)?;
                } else {
                    prepare_esp(&app, &inner, &id, target, allow_prerequisites, &cancel)?;
                }
                if cancel.load(Ordering::SeqCst) {
                    return Ok(None);
                }
            }
            Ok(None)
        })();
        let restored = if cancel.load(Ordering::SeqCst) {
            saved
        } else {
            probe(&app, &inner, &selected).ok().or(saved)
        };
        if let Ok(mut env) = inner.environment.lock() {
            *env = restored;
        }
        idf::finish(
            &app,
            &inner,
            &id,
            "sdk_install",
            if cancel.load(Ordering::SeqCst) {
                Ok(None)
            } else {
                result
            },
            &cancel,
        );
    });
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn separate_platform_names() {
        assert_eq!(TARGETS.len(), 3);
        assert!(!TARGETS.iter().any(|(t, _)| *t == "rp2040"));
    }
    #[test]
    fn tooling_settings_keep_old_roots() {
        let s: Settings =
            serde_json::from_str(r#"{"root":"/tools","previousRoots":["/old"]}"#).unwrap();
        assert_eq!(s.previous_roots, vec![PathBuf::from("/old")]);
    }
}
