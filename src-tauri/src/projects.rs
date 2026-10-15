use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const MAX_SIZE: u64 = 2 * 1024 * 1024;
// A migration and project writes must never resolve different directories concurrently.
static STORAGE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Serialize)]
struct StoragePreference {
    directory: PathBuf,
}

struct StoragePaths {
    default_dir: PathBuf,
    preference: PathBuf,
}

impl StoragePaths {
    fn directory(&self) -> Result<PathBuf, String> {
        if !self.preference.try_exists().map_err(|e| e.to_string())? {
            fs::create_dir_all(&self.default_dir)
                .map_err(|e| format!("Не удалось создать папку проектов: {e}"))?;
            return Ok(self.default_dir.clone());
        }
        let mut contents = String::new();
        fs::File::open(&self.preference)
            .map_err(|e| e.to_string())?
            .take(64 * 1024 + 1)
            .read_to_string(&mut contents)
            .map_err(|e| e.to_string())?;
        if contents.len() > 64 * 1024 {
            return Err("Настройка папки проектов повреждена".into());
        }
        let preference: StoragePreference = serde_json::from_str(&contents)
            .map_err(|e| format!("Не удалось прочитать настройку папки проектов: {e}"))?;
        if !preference.directory.is_absolute() || !preference.directory.is_dir() {
            return Err(format!(
                "Папка проектов недоступна: {}. Подключите диск и повторите попытку.",
                preference.directory.display()
            ));
        }
        Ok(preference.directory)
    }

    fn change_directory(&self, selected: &Path) -> Result<PathBuf, String> {
        if !selected.is_absolute() {
            return Err("Выберите полный путь к папке проектов".into());
        }
        let previous = self.directory()?;
        let source = fs::canonicalize(&previous).map_err(|e| e.to_string())?;
        let target = fs::canonicalize(selected)
            .map_err(|e| format!("Не удалось открыть выбранную папку: {e}"))?;
        if !target.is_dir() {
            return Err("Выберите папку для хранения проектов".into());
        }
        if source == target {
            return Ok(previous);
        }
        if source.starts_with(&target) || target.starts_with(&source) {
            return Err(
                "Выберите папку вне текущего каталога проектов и его родительских папок".into(),
            );
        }
        // Probe even an empty library before committing a new preference.
        let probe = tempfile::NamedTempFile::new_in(&target)
            .map_err(|e| format!("Нет доступа для записи в выбранную папку: {e}"))?;
        probe.as_file().sync_all().map_err(|e| e.to_string())?;
        drop(probe);
        let mut files = Vec::new();
        for entry in fs::read_dir(&source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.path().extension().and_then(|v| v.to_str()) != Some("json") {
                continue;
            }
            let metadata = entry.file_type().map_err(|e| e.to_string())?;
            if !metadata.is_file() {
                return Err(format!(
                    "Не удалось перенести {}: ожидается обычный JSON-файл",
                    entry.path().display()
                ));
            }
            // Preserve damaged JSON too: changing folders must never silently discard it.
            let contents = read_project(&entry.path())?;
            let destination = target.join(entry.file_name());
            match fs::symlink_metadata(&destination) {
                Ok(meta) => {
                    if !meta.is_file() || read_project(&destination)? != contents {
                        return Err(format!("В выбранной папке уже есть другой файл {}. Файлы не заменены; выберите другую папку.", entry.file_name().to_string_lossy()));
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
            files.push((destination, contents));
        }
        let mut created: Vec<(PathBuf, String)> = Vec::new();
        let result = (|| {
            for (destination, contents) in &files {
                if !destination.try_exists().map_err(|e| e.to_string())? {
                    let mut temporary =
                        tempfile::NamedTempFile::new_in(&target).map_err(|e| e.to_string())?;
                    temporary
                        .write_all(contents.as_bytes())
                        .map_err(|e| e.to_string())?;
                    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
                    temporary
                        .persist_noclobber(destination)
                        .map_err(|e| e.to_string())?;
                    created.push((destination.clone(), contents.clone()));
                }
                if read_project(destination)? != *contents {
                    return Err(
                        "Не удалось проверить копию проекта. Прежняя папка остается активной."
                            .into(),
                    );
                }
            }
            let parent = self
                .preference
                .parent()
                .ok_or("Не найден каталог настроек")?;
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            let contents = serde_json::to_string_pretty(&StoragePreference {
                directory: selected.to_path_buf(),
            })
            .map_err(|e| e.to_string())?;
            atomic_write(&self.preference, &contents)?;
            Ok(selected.to_path_buf())
        })();
        if result.is_err() {
            for (file, contents) in created {
                // Only remove copies made here, and only if nobody changed their contents.
                if read_project(&file).ok().as_ref() == Some(&contents) {
                    let _ = fs::remove_file(file);
                }
            }
        }
        result
    }
}

fn storage_paths(app: &tauri::AppHandle) -> Result<StoragePaths, String> {
    Ok(StoragePaths {
        default_dir: app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("projects"),
        preference: app
            .path()
            .app_config_dir()
            .map_err(|e| e.to_string())?
            .join("project-storage.json"),
    })
}

fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

fn project_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    storage_paths(app)?.directory()
}

fn project_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Некорректный ID проекта".into());
    }
    Ok(project_dir(app)?.join(format!("{id}.json")))
}

fn read_project(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut contents = String::new();
    file.take(MAX_SIZE + 1)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    if contents.len() as u64 > MAX_SIZE {
        return Err("JSON проекта превышает 2 МБ".into());
    }
    Ok(contents)
}

fn validate_contents(contents: &str, id: Option<&str>) -> Result<(), String> {
    if contents.len() as u64 > MAX_SIZE {
        return Err("JSON проекта превышает 2 МБ".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(contents).map_err(|e| format!("Поврежденный JSON: {e}"))?;
    let stored_id = value
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Не указан ID проекта")?;
    if !valid_id(stored_id) || id.is_some_and(|id| id != stored_id) {
        return Err("ID проекта не совпадает с именем файла".into());
    }
    if !matches!(
        value.get("formatVersion").and_then(|v| v.as_u64()),
        Some(1 | 2 | 3)
    ) {
        return Err("Неподдерживаемая версия проекта".into());
    }
    Ok(())
}

fn atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("Не найден каталог файла")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(contents.as_bytes())
        .map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct ProjectFile {
    id: String,
    contents: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub fn storage_path(app: tauri::AppHandle) -> Result<String, String> {
    let _lock = STORAGE_LOCK
        .lock()
        .map_err(|_| "Хранилище проектов занято")?;
    Ok(project_dir(&app)?.display().to_string())
}

#[tauri::command]
pub fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectFile>, String> {
    let _lock = STORAGE_LOCK
        .lock()
        .map_err(|_| "Хранилище проектов занято")?;
    let dir = project_dir(&app)?;
    let mut result = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !entry.file_type().map_err(|e| e.to_string())?.is_file()
            || path.extension().and_then(|s| s.to_str()) != Some("json")
        {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        let loaded = read_project(&path).and_then(|contents| {
            validate_contents(&contents, Some(&id))?;
            Ok(contents)
        });
        let (contents, error) = match loaded {
            Ok(c) => (Some(c), None),
            Err(e) => (None, Some(e)),
        };
        result.push(ProjectFile {
            id,
            contents,
            error,
        });
    }
    Ok(result)
}

#[tauri::command]
pub fn save_project(app: tauri::AppHandle, id: String, contents: String) -> Result<(), String> {
    let _lock = STORAGE_LOCK
        .lock()
        .map_err(|_| "Хранилище проектов занято")?;
    validate_contents(&contents, Some(&id))?;
    atomic_write(&project_path(&app, &id)?, &contents)
}

#[tauri::command]
pub fn delete_project(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let _lock = STORAGE_LOCK
        .lock()
        .map_err(|_| "Хранилище проектов занято")?;
    let path = project_path(&app, &id)?;
    fs::remove_file(path).map_err(|e| format!("Не удалось удалить проект: {e}"))
}

#[tauri::command]
pub async fn change_project_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = storage_paths(&app)?;
        let current = {
            let _lock = STORAGE_LOCK
                .lock()
                .map_err(|_| "Хранилище проектов занято")?;
            paths.directory()?
        };
        let selected = app
            .dialog()
            .file()
            .set_title("Выбрать папку для проектов CLEX Flow")
            .set_directory(&current)
            .blocking_pick_folder();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let selected = selected.into_path().map_err(|e| e.to_string())?;
        let _lock = STORAGE_LOCK
            .lock()
            .map_err(|_| "Хранилище проектов занято")?;
        paths
            .change_directory(&selected)
            .map(|path| Some(path.display().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_project(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("Открыть проект CLEX Flow")
            .add_filter("Проект JSON", &["json"])
            .blocking_pick_file();
        selected
            .map(|file| {
                let path = file.into_path().map_err(|e| e.to_string())?;
                read_project(&path)
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_project(app: tauri::AppHandle, contents: String) -> Result<bool, String> {
    validate_contents(&contents, None)?;
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("Экспорт проекта CLEX Flow")
            .set_file_name("project.clex.json")
            .add_filter("Проект JSON", &["json"])
            .blocking_save_file();
        match selected {
            None => Ok(false),
            Some(file) => {
                let path = file.into_path().map_err(|e| e.to_string())?;
                atomic_write(&path, &contents)?;
                Ok(true)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prevents_path_traversal() {
        assert!(valid_id("01234567-89ab-4cde-8fab-0123456789ab"));
        assert!(!valid_id("../../somewhere"));
        assert!(!valid_id("01234567/89ab-4cde-8fab-0123456789ab"));
    }

    #[test]
    fn validates_identity_and_size() {
        let json = r#"{"id":"01234567-89ab-4cde-8fab-0123456789ab","formatVersion":1}"#;
        assert!(validate_contents(json, Some("01234567-89ab-4cde-8fab-0123456789ab")).is_ok());
        assert!(validate_contents(json, Some("ffffffff-89ab-4cde-8fab-0123456789ab")).is_err());
        assert!(validate_contents(
            &json.replace("\"formatVersion\":1", "\"formatVersion\":2"),
            None
        )
        .is_ok());
        assert!(validate_contents(
            &json.replace("\"formatVersion\":1", "\"formatVersion\":3"),
            None
        )
        .is_ok());
        assert!(validate_contents(
            &json.replace("\"formatVersion\":1", "\"formatVersion\":4"),
            None
        )
        .is_err());
        assert!(validate_contents(&"x".repeat(MAX_SIZE as usize + 1), None).is_err());
    }

    #[test]
    fn replaces_file_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.json");
        atomic_write(&path, "first").unwrap();
        atomic_write(&path, "second").unwrap();
        assert_eq!(read_project(&path).unwrap(), "second");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    fn paths(root: &Path) -> StoragePaths {
        StoragePaths {
            default_dir: root.join("default/projects"),
            preference: root.join("config/project-storage.json"),
        }
    }

    #[test]
    fn switches_to_unicode_directory_preserves_sources_and_reloads_preference() {
        let root = tempfile::tempdir().unwrap();
        let storage = paths(root.path());
        let source = storage.directory().unwrap();
        let target = root.path().join("Другой диск - мои проекты");
        fs::create_dir(&target).unwrap();
        let id = "01234567-89ab-4cde-8fab-0123456789ab.json";
        fs::write(source.join(id), "{\"name\":\"Проект\"}").unwrap();
        fs::write(source.join("damaged.json"), "{broken").unwrap();
        fs::write(target.join("existing.json"), "{\"other\":true}").unwrap();
        storage.change_directory(&target).unwrap();
        assert_eq!(paths(root.path()).directory().unwrap(), target);
        assert_eq!(
            fs::read(source.join(id)).unwrap(),
            fs::read(target.join(id)).unwrap()
        );
        assert_eq!(
            fs::read_to_string(target.join("damaged.json")).unwrap(),
            "{broken"
        );
        assert_eq!(
            fs::read_to_string(target.join("existing.json")).unwrap(),
            "{\"other\":true}"
        );
        atomic_write(&storage.directory().unwrap().join(id), "new contents").unwrap();
        assert_eq!(fs::read_to_string(target.join(id)).unwrap(), "new contents");
        assert_eq!(
            fs::read_to_string(source.join(id)).unwrap(),
            "{\"name\":\"Проект\"}"
        );
    }

    #[test]
    fn conflicting_destination_never_overwrites_or_switches_the_library() {
        let root = tempfile::tempdir().unwrap();
        let storage = paths(root.path());
        let source = storage.directory().unwrap();
        let target = root.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(source.join("first.json"), "first").unwrap();
        fs::write(source.join("conflict.json"), "source").unwrap();
        fs::write(target.join("conflict.json"), "destination").unwrap();
        assert!(storage
            .change_directory(&target)
            .unwrap_err()
            .contains("другой файл"));
        assert_eq!(storage.directory().unwrap(), source);
        assert!(!storage.preference.exists());
        assert!(!target.join("first.json").exists());
        assert_eq!(
            fs::read_to_string(target.join("conflict.json")).unwrap(),
            "destination"
        );
        assert_eq!(
            fs::read_to_string(source.join("conflict.json")).unwrap(),
            "source"
        );
    }

    #[test]
    fn identical_files_are_reused_and_second_migration_keeps_the_current_library() {
        let root = tempfile::tempdir().unwrap();
        let storage = paths(root.path());
        let source = storage.directory().unwrap();
        let target = root.path().join("target");
        fs::create_dir(&target).unwrap();
        for dir in [&source, &target] {
            fs::write(dir.join("same.json"), "same").unwrap();
        }
        storage.change_directory(&target).unwrap();
        assert_eq!(storage.change_directory(&target).unwrap(), target);
        assert_eq!(fs::read_dir(&target).unwrap().count(), 1);
        let next = root.path().join("next");
        fs::create_dir(&next).unwrap();
        atomic_write(&target.join("same.json"), "updated").unwrap();
        storage.change_directory(&next).unwrap();
        assert_eq!(storage.directory().unwrap(), next);
        assert_eq!(
            fs::read_to_string(next.join("same.json")).unwrap(),
            "updated"
        );
        assert_eq!(
            fs::read_to_string(source.join("same.json")).unwrap(),
            "same"
        );
    }

    #[test]
    fn invalid_config_parent_does_not_change_project_files() {
        let root = tempfile::tempdir().unwrap();
        let initial = paths(root.path());
        let source = initial.directory().unwrap();
        fs::write(source.join("new.json"), "new").unwrap();
        fs::write(source.join("same.json"), "same").unwrap();
        let target = root.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("same.json"), "same").unwrap();
        let blocked = root.path().join("blocked");
        fs::write(&blocked, "not a directory").unwrap();
        let storage = StoragePaths {
            default_dir: source.clone(),
            preference: blocked.join("setting.json"),
        };
        // Reading the preference itself fails for a non-directory parent; nothing is copied.
        assert!(storage.change_directory(&target).is_err());
        assert!(!target.join("new.json").exists());
        assert_eq!(
            fs::read_to_string(target.join("same.json")).unwrap(),
            "same"
        );
        assert_eq!(initial.directory().unwrap(), source);
    }

    #[cfg(unix)]
    #[test]
    fn commit_failure_rolls_back_copies_without_deleting_preexisting_files() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let storage = paths(root.path());
        let source = storage.directory().unwrap();
        fs::write(source.join("new.json"), "new").unwrap();
        fs::write(source.join("same.json"), "same").unwrap();
        let target = root.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("same.json"), "same").unwrap();
        fs::create_dir(storage.preference.parent().unwrap()).unwrap();
        fs::set_permissions(
            storage.preference.parent().unwrap(),
            fs::Permissions::from_mode(0o555),
        )
        .unwrap();
        let result = storage.change_directory(&target);
        fs::set_permissions(
            storage.preference.parent().unwrap(),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        assert!(result.is_err());
        assert_eq!(storage.directory().unwrap(), source);
        assert!(!target.join("new.json").exists());
        assert_eq!(
            fs::read_to_string(target.join("same.json")).unwrap(),
            "same"
        );
        assert_eq!(fs::read_to_string(source.join("new.json")).unwrap(), "new");
    }

    #[test]
    fn unavailable_custom_drive_is_not_recreated_or_replaced_by_default_storage() {
        let root = tempfile::tempdir().unwrap();
        let storage = paths(root.path());
        let source = storage.directory().unwrap();
        let target = root.path().join("removable-drive");
        fs::create_dir(&target).unwrap();
        storage.change_directory(&target).unwrap();
        fs::remove_dir(&target).unwrap();
        assert!(storage.directory().unwrap_err().contains("недоступна"));
        assert!(!target.exists());
        assert!(source.is_dir());
    }

    #[test]
    fn rejects_relative_nested_file_targets_and_corrupt_settings_without_resetting() {
        let root = tempfile::tempdir().unwrap();
        let storage = paths(root.path());
        let source = storage.directory().unwrap();
        assert!(storage.change_directory(Path::new("relative")).is_err());
        let nested = source.join("nested");
        fs::create_dir(&nested).unwrap();
        assert!(storage.change_directory(&nested).is_err());
        assert!(storage.change_directory(source.parent().unwrap()).is_err());
        let file = root.path().join("file");
        fs::write(&file, "file").unwrap();
        assert!(storage.change_directory(&file).is_err());
        fs::create_dir(storage.preference.parent().unwrap()).unwrap();
        fs::write(&storage.preference, "{broken").unwrap();
        assert!(storage.directory().is_err());
        assert_eq!(fs::read_to_string(&storage.preference).unwrap(), "{broken");
    }

    #[cfg(unix)]
    #[test]
    fn read_only_target_and_json_symlinks_are_rejected_without_data_loss() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = tempfile::tempdir().unwrap();
        let storage = paths(root.path());
        let source = storage.directory().unwrap();
        fs::write(source.join("project.json"), "source").unwrap();
        let target = root.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o555)).unwrap();
        let result = storage.change_directory(&target);
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_err());
        assert_eq!(storage.directory().unwrap(), source);
        symlink(source.join("project.json"), target.join("project.json")).unwrap();
        assert!(storage.change_directory(&target).is_err());
        fs::remove_file(target.join("project.json")).unwrap();
        symlink(source.join("project.json"), source.join("link.json")).unwrap();
        assert!(storage.change_directory(&target).is_err());
        assert!(!target.join("project.json").exists());
        assert_eq!(
            fs::read_to_string(source.join("project.json")).unwrap(),
            "source"
        );
    }
    #[cfg(windows)]
    #[test]
    fn windows_readonly_preference_rolls_back_copies_and_retains_active_directory() {
        let root = tempfile::tempdir().unwrap();
        let storage = paths(root.path());
        let source = storage.directory().unwrap();
        let first = root.path().join("first");
        fs::create_dir(&first).unwrap();
        storage.change_directory(&first).unwrap();
        fs::write(first.join("new.json"), "new").unwrap();
        let target = root.path().join("target");
        fs::create_dir(&target).unwrap();
        let original = fs::metadata(&storage.preference).unwrap().permissions();
        let mut readonly = original.clone();
        readonly.set_readonly(true);
        fs::set_permissions(&storage.preference, readonly).unwrap();
        let result = storage.change_directory(&target);
        fs::set_permissions(&storage.preference, original).unwrap();
        assert!(result.is_err());
        assert_eq!(storage.directory().unwrap(), first);
        assert!(!target.join("new.json").exists());
        assert_eq!(fs::read_to_string(first.join("new.json")).unwrap(), "new");
        assert!(source.is_dir());
    }
}
