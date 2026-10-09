use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const MAX_SIZE: u64 = 2 * 1024 * 1024;

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
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать каталог проектов: {e}"))?;
    Ok(dir)
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
        serde_json::from_str(contents).map_err(|e| format!("Повреждённый JSON: {e}"))?;
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
    Ok(project_dir(&app)?.display().to_string())
}

#[tauri::command]
pub fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectFile>, String> {
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
    validate_contents(&contents, Some(&id))?;
    atomic_write(&project_path(&app, &id)?, &contents)
}

#[tauri::command]
pub fn delete_project(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = project_path(&app, &id)?;
    fs::remove_file(path).map_err(|e| format!("Не удалось удалить проект: {e}"))
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
}
