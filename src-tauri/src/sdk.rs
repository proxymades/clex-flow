use crate::{
    idf::{self, Service},
    idf_environment::{self, Environment},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};
use tauri::Manager;

pub const REQUIRED_VERSION: &str = "5.4.4";
pub const PLATFORM: &str = "esp32s3";
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Sdk {
    pub id: String,
    pub family: String,
    pub version: String,
    pub root: String,
    pub python: Option<String>,
    pub tools_path: Option<String>,
    #[serde(default)]
    pub git_path: Option<String>,
    pub managed: bool,
    pub slot: Option<String>,
    pub state: String,
    pub diagnostic: String,
    pub checked_at: Option<u64>,
    pub environment: Option<Environment>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AvailableVersion {
    pub version: String,
    pub supported: bool,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub format: u32,
    pub installations: Vec<Sdk>,
    pub active: BTreeMap<String, String>,
    pub available: Vec<AvailableVersion>,
    pub catalog_error: String,
}
impl Default for Registry {
    fn default() -> Self {
        Self {
            format: 1,
            installations: Vec::new(),
            active: BTreeMap::new(),
            available: vec![AvailableVersion {
                version: REQUIRED_VERSION.into(),
                supported: true,
            }],
            catalog_error: String::new(),
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub installations: Vec<Sdk>,
    pub active: BTreeMap<String, String>,
    pub available: Vec<AvailableVersion>,
    pub catalog_error: String,
    pub managed_path: String,
    pub host: String,
    pub environment: Option<Environment>,
}
#[derive(Clone)]
pub struct Paths {
    pub registry: PathBuf,
    pub managed: PathBuf,
    pub cache: PathBuf,
}
impl Paths {
    pub fn for_app(app: &tauri::AppHandle) -> Result<Self, String> {
        Ok(Self {
            registry: app
                .path()
                .app_config_dir()
                .map_err(|e| e.to_string())?
                .join("sdk-manager.json"),
            managed: app
                .path()
                .app_local_data_dir()
                .map_err(|e| e.to_string())?
                .join("sdks/esp-idf"),
            cache: app
                .path()
                .app_cache_dir()
                .map_err(|e| e.to_string())?
                .join("sdk-manager"),
        })
    }
    pub fn load(&self) -> Result<Registry, String> {
        match fs::read(&self.registry) {
            Ok(bytes) => {
                let registry: Registry = serde_json::from_slice(&bytes).map_err(|e| {
                    format!("Настройки SDK повреждены; исходный файл сохранён: {e}")
                })?;
                if registry.format != 1 {
                    return Err("Неизвестный формат настроек SDK".into());
                }
                Ok(registry)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Registry::default()),
            Err(e) => Err(e.to_string()),
        }
    }
    pub fn save(&self, registry: &Registry) -> Result<(), String> {
        use std::io::Write;
        let parent = self.registry.parent().ok_or("Нет каталога настроек SDK")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        temporary
            .write_all(&serde_json::to_vec_pretty(registry).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary
            .persist(&self.registry)
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn slot(&self, version: &str) -> Result<PathBuf, String> {
        if !valid_version(version) {
            return Err("Некорректная версия SDK".into());
        }
        Ok(self.managed.join(format!("v{version}")))
    }
}
pub fn valid_version(version: &str) -> bool {
    let p: Vec<_> = version.split('.').collect();
    p.len() == 3
        && p.iter()
            .all(|v| !v.is_empty() && v.len() <= 3 && v.bytes().all(|b| b.is_ascii_digit()))
}
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn identity(root: &Path) -> String {
    format!("{:x}", Sha256::digest(root.to_string_lossy().as_bytes()))
}
fn new_external(root: &Path, python: Option<String>, tools: Option<String>) -> Option<Sdk> {
    let root = root.canonicalize().ok()?;
    let version = idf_environment::sdk_version(&root).ok()?;
    Some(Sdk {
        id: identity(&root),
        family: "esp-idf".into(),
        version,
        root: root.to_string_lossy().into(),
        python,
        tools_path: tools,
        git_path: None,
        managed: false,
        slot: None,
        state: "detected".into(),
        diagnostic: "Требуется проверка инструментов".into(),
        checked_at: None,
        environment: None,
    })
}
fn upsert(registry: &mut Registry, sdk: Sdk) -> String {
    let id = sdk.id.clone();
    if let Some(old) = registry
        .installations
        .iter_mut()
        .find(|old| old.root == sdk.root)
    {
        if !old.managed {
            old.python = sdk.python.or(old.python.clone());
            old.tools_path = sdk.tools_path.or(old.tools_path.clone());
            old.version = sdk.version;
            old.git_path = sdk.git_path.or(old.git_path.clone());
        }
        return old.id.clone();
    }
    registry.installations.push(sdk);
    id
}
pub fn eim_config_paths(home: &Path) -> Vec<PathBuf> {
    #[allow(unused_mut)]
    let mut paths = vec![home.join(".espressif/tools/eim_idf.json")];
    #[cfg(windows)]
    {
        paths.extend([
            PathBuf::from(r"C:\Espressif\tools\eim_idf.json"),
            PathBuf::from(r"C:\esp\tools\eim_idf.json"),
            home.join("AppData/Local/Espressif/tools/eim_idf.json"),
        ]);
    }
    paths
}
pub fn detect(registry: &mut Registry, paths: &Paths, legacy: Option<&Path>) -> Result<(), String> {
    let home = idf_environment::home()?;
    for config in eim_config_paths(&home) {
        if let Ok(bytes) = fs::read(&config) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if let Some(entries) = value["idfInstalled"].as_array() {
                    for entry in entries {
                        if let Some(root) = entry["path"].as_str() {
                            if let Some(mut sdk) = new_external(
                                Path::new(root),
                                entry["python"].as_str().map(str::to_owned),
                                entry["idfToolsPath"].as_str().map(str::to_owned),
                            ) {
                                sdk.git_path = value["gitPath"].as_str().map(str::to_owned);
                                upsert(registry, sdk);
                            }
                        }
                    }
                }
            }
        }
    }
    if let Some(path) = legacy {
        if let Ok(bytes) = fs::read(path) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if let Some(root) = value["root"].as_str() {
                    if let Some(sdk) = new_external(
                        Path::new(root),
                        value["python"].as_str().map(str::to_owned),
                        None,
                    ) {
                        upsert(registry, sdk);
                    }
                }
            }
        }
    }
    if let Some(root) = std::env::var_os("IDF_PATH") {
        if let Some(sdk) = new_external(
            &PathBuf::from(root),
            std::env::var_os("IDF_PYTHON_ENV_PATH").map(|p| {
                idf_environment::executable(&PathBuf::from(p))
                    .to_string_lossy()
                    .into()
            }),
            std::env::var("IDF_TOOLS_PATH").ok(),
        ) {
            upsert(registry, sdk);
        }
    }
    for base in [
        home.join(".espressif"),
        home.join(".espressif-s3"),
        home.join("esp"),
        PathBuf::from(r"C:\Espressif"),
        PathBuf::from(r"C:\esp"),
    ] {
        if let Some(sdk) = new_external(&base.join("esp-idf"), None, None) {
            upsert(registry, sdk);
        }
        if let Ok(entries) = fs::read_dir(base) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    if let Some(sdk) = new_external(&entry.path().join("esp-idf"), None, None) {
                        upsert(registry, sdk);
                    }
                }
            }
        }
    }
    // Rediscover only our owned slots; never treat a directory as removable by location alone.
    if let Ok(entries) = fs::read_dir(&paths.managed) {
        for entry in entries.flatten() {
            if let Ok(bytes) = fs::read(entry.path().join(".clex-sdk.json")) {
                if let Ok(owner) = serde_json::from_slice::<Owner>(&bytes) {
                    if owner.family == "esp-idf" && valid_version(&owner.version) {
                        let slot = paths.slot(&owner.version)?;
                        if slot == entry.path()
                            && !registry.installations.iter().any(|s| s.id == owner.id)
                        {
                            registry
                                .installations
                                .push(managed_sdk(&slot, &owner.version));
                        }
                    }
                }
            }
        }
    }
    for sdk in &mut registry.installations {
        if sdk.managed && ["installing", "failed", "interrupted"].contains(&sdk.state.as_str()) {
            continue;
        }
        if !Path::new(&sdk.root).is_dir() {
            sdk.state = "missing".into();
            sdk.environment = None;
            sdk.diagnostic = "SDK удалён, перемещён или установка ещё не завершена".into();
        } else if let Ok(version) = idf_environment::sdk_version(Path::new(&sdk.root)) {
            if version != sdk.version {
                sdk.state = "invalid".into();
                sdk.environment = None;
                sdk.diagnostic = "Версия SDK изменилась; повторите проверку".into();
            }
        } else {
            sdk.state = "invalid".into();
            sdk.environment = None;
            sdk.diagnostic = "Неполная или повреждённая установка".into();
        }
    }
    Ok(())
}
#[derive(Serialize, Deserialize)]
struct Owner {
    id: String,
    family: String,
    version: String,
}
pub fn managed_sdk(slot: &Path, version: &str) -> Sdk {
    Sdk {
        id: identity(slot),
        family: "esp-idf".into(),
        version: version.into(),
        root: slot
            .join(format!("v{version}/esp-idf"))
            .to_string_lossy()
            .into(),
        python: Some(
            idf_environment::executable(&slot.join(format!("tools/python/v{version}/venv")))
                .to_string_lossy()
                .into(),
        ),
        tools_path: Some(slot.join("tools").to_string_lossy().into()),
        git_path: None,
        managed: true,
        slot: Some(slot.to_string_lossy().into()),
        state: "installing".into(),
        diagnostic: String::new(),
        checked_at: None,
        environment: None,
    }
}
fn no_link(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("Каталог SDK является символической ссылкой; операция запрещена".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Каталог SDK является reparse point; операция запрещена".into());
        }
    }
    Ok(())
}
pub fn claim_slot(paths: &Paths, sdk: &Sdk) -> Result<PathBuf, String> {
    let slot = paths.slot(&sdk.version)?;
    fs::create_dir_all(&paths.managed).map_err(|e| e.to_string())?;
    no_link(&paths.managed)?;
    if slot.exists() {
        assert_owned(paths, sdk)?;
    } else {
        fs::create_dir(&slot).map_err(|e| e.to_string())?;
        fs::write(
            slot.join(".clex-sdk.json"),
            serde_json::to_vec(&Owner {
                id: sdk.id.clone(),
                family: "esp-idf".into(),
                version: sdk.version.clone(),
            })
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(slot)
}
pub fn assert_owned(paths: &Paths, sdk: &Sdk) -> Result<PathBuf, String> {
    if !sdk.managed || sdk.family != "esp-idf" {
        return Err("Удаление и переустановка пользовательских SDK запрещены".into());
    }
    let slot = paths.slot(&sdk.version)?;
    if sdk.slot.as_deref() != Some(slot.to_string_lossy().as_ref()) {
        return Err("Путь SDK не соответствует управляемому каталогу".into());
    }
    no_link(&paths.managed)?;
    no_link(&slot)?;
    let canonical = slot.canonicalize().map_err(|e| e.to_string())?;
    if canonical.parent()
        != Some(
            paths
                .managed
                .canonicalize()
                .map_err(|e| e.to_string())?
                .as_path(),
        )
    {
        return Err("SDK находится вне каталога CLEX Flow".into());
    }
    let owner: Owner =
        serde_json::from_slice(&fs::read(slot.join(".clex-sdk.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if owner.id != sdk.id || owner.version != sdk.version || owner.family != "esp-idf" {
        return Err("Маркер владельца SDK не совпадает".into());
    }
    Ok(slot)
}
pub fn validate(paths: &Paths, sdk: &Sdk) -> Result<Environment, String> {
    idf_environment::inspect(
        Path::new(&sdk.root),
        sdk.python.as_deref().map(Path::new),
        sdk.tools_path.as_deref().map(Path::new),
        sdk.git_path.as_deref().map(Path::new),
        &paths.cache.join("environments"),
    )
}
fn legacy(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|p| p.join("idf-settings.json"))
}
pub fn auto_environment(
    app: &tauri::AppHandle,
    inner: &idf::Inner,
    root: Option<String>,
    python: Option<String>,
) -> Result<Environment, String> {
    let paths = Paths::for_app(app)?;
    let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
    let mut registry = paths.load()?;
    detect(&mut registry, &paths, legacy(app).as_deref())?;
    if let Some(root) = root.filter(|v| !v.trim().is_empty()) {
        let sdk = new_external(
            Path::new(&root),
            python.filter(|v| !v.trim().is_empty()),
            None,
        )
        .ok_or("Указанный SDK недоступен или повреждён")?;
        let id = upsert(&mut registry, sdk);
        registry.active.insert(PLATFORM.into(), id);
    } else if !registry.active.contains_key(PLATFORM) {
        if let Some(sdk) = registry
            .installations
            .iter()
            .find(|sdk| sdk.version == REQUIRED_VERSION && Path::new(&sdk.root).is_dir())
        {
            registry.active.insert(PLATFORM.into(), sdk.id.clone());
        }
    }
    let selected=registry.active.get(PLATFORM).cloned().ok_or_else(||{let _=paths.save(&registry);"Нужна ESP-IDF 5.4.4. Откройте «Инструменты разработки» и выберите существующий SDK или установку.".to_string()})?;
    let sdk = registry
        .installations
        .iter()
        .find(|sdk| sdk.id == selected)
        .cloned()
        .ok_or("Выбранный SDK не найден")?;
    let result = validate(&paths, &sdk);
    let target = registry
        .installations
        .iter_mut()
        .find(|s| s.id == selected)
        .unwrap();
    match &result {
        Ok(env) => {
            target.state = "ready".into();
            target.diagnostic = env.version.clone();
            target.python = Some(env.python.clone());
            target.tools_path = Some(env.tools_path.clone());
            target.checked_at = Some(now());
            target.environment = Some(env.clone());
        }
        Err(error) => {
            target.state = "invalid".into();
            target.diagnostic = error.clone();
            target.environment = None;
        }
    }
    paths.save(&registry)?;
    result
}
#[tauri::command]
pub fn sdk_list(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
) -> Result<Snapshot, String> {
    let paths = Paths::for_app(&app)?;
    let _guard = state.0.sdk_gate.lock().map_err(|e| e.to_string())?;
    let mut registry = paths.load()?;
    detect(&mut registry, &paths, legacy(&app).as_deref())?;
    if !idf::busy(&state.0) {
        for sdk in &mut registry.installations {
            if sdk.state == "installing" {
                sdk.state = "interrupted".into();
                sdk.diagnostic = "Установка прервана; можно повторить".into();
            }
        }
    }
    paths.save(&registry)?;
    let environment = state
        .0
        .environment
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .filter(|e| {
            Path::new(&e.root).is_dir()
                && registry.active.get(PLATFORM).is_some_and(|id| {
                    registry
                        .installations
                        .iter()
                        .any(|sdk| &sdk.id == id && sdk.root == e.root && sdk.state == "ready")
                })
        });
    Ok(Snapshot {
        installations: registry.installations,
        active: registry.active,
        available: registry.available,
        catalog_error: registry.catalog_error,
        managed_path: paths.managed.to_string_lossy().into(),
        host: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        environment,
    })
}
#[tauri::command]
pub async fn sdk_refresh_versions(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
) -> Result<(), String> {
    if idf::busy(&state.0) {
        return Err("Дождитесь завершения операции".into());
    }
    let paths = Paths::for_app(&app)?;
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = crate::sdk_installer::versions();
        let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
        let mut registry = paths.load()?;
        match result {
            Ok(versions) => {
                registry.available = versions;
                registry.catalog_error.clear();
                paths.save(&registry)
            }
            Err(error) => {
                registry.catalog_error = error.clone();
                paths.save(&registry)?;
                Err(error)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
fn store_result(
    paths: &Paths,
    inner: &idf::Inner,
    id: &str,
    result: &Result<Environment, String>,
    activate: bool,
) -> Result<(), String> {
    let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
    let mut registry = paths.load()?;
    let sdk = registry
        .installations
        .iter_mut()
        .find(|sdk| sdk.id == id)
        .ok_or("SDK отсутствует")?;
    match result {
        Ok(env) => {
            sdk.state = "ready".into();
            sdk.diagnostic = env.version.clone();
            sdk.checked_at = Some(now());
            sdk.python = Some(env.python.clone());
            sdk.tools_path = Some(env.tools_path.clone());
            sdk.environment = Some(env.clone());
            if activate {
                registry.active.insert(PLATFORM.into(), id.into());
                *inner.environment.lock().map_err(|e| e.to_string())? = Some(env.clone());
            }
        }
        Err(error) => {
            sdk.state = "invalid".into();
            sdk.diagnostic = error.clone();
            sdk.environment = None;
        }
    }
    paths.save(&registry)
}
#[tauri::command]
pub fn sdk_select(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    id: String,
    sdk_id: String,
) -> Result<(), String> {
    let paths = Paths::for_app(&app)?;
    let inner = state.0.clone();
    let sdk = {
        let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
        paths
            .load()?
            .installations
            .into_iter()
            .find(|sdk| sdk.id == sdk_id)
            .ok_or("SDK не найден")?
    };
    let cancel = idf::reserve(&inner, &id)?;
    std::thread::spawn(move || {
        idf::publish(
            &app,
            &inner,
            &id,
            "sdk_select",
            "running",
            "system",
            "Проверяем SDK и активируем окружение",
            None,
        );
        let result = validate(&paths, &sdk);
        let outcome = if cancel.load(Ordering::SeqCst) {
            Ok(None)
        } else {
            store_result(&paths, &inner, &sdk_id, &result, true).and_then(|_| result.map(|_| None))
        };
        idf::finish(&app, &inner, &id, "sdk_select", outcome, &cancel);
    });
    Ok(())
}
#[tauri::command]
pub fn sdk_register(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    root: String,
    python: Option<String>,
) -> Result<(), String> {
    if idf::busy(&state.0) {
        return Err("Дождитесь завершения операции".into());
    }
    let paths = Paths::for_app(&app)?;
    let _guard = state.0.sdk_gate.lock().map_err(|e| e.to_string())?;
    let mut registry = paths.load()?;
    let sdk = new_external(
        Path::new(&root),
        python.filter(|p| !p.trim().is_empty()),
        None,
    )
    .ok_or("Указанная ESP-IDF недоступна или повреждена")?;
    upsert(&mut registry, sdk);
    paths.save(&registry)
}
#[tauri::command]
pub fn sdk_remove(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    id: String,
    sdk_id: String,
) -> Result<(), String> {
    let paths = Paths::for_app(&app)?;
    let inner = state.0.clone();
    let sdk = {
        let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
        paths
            .load()?
            .installations
            .into_iter()
            .find(|s| s.id == sdk_id)
            .ok_or("SDK не найден")?
    };
    let slot = assert_owned(&paths, &sdk)?;
    let cancel = idf::reserve(&inner, &id)?;
    std::thread::spawn(move || {
        idf::publish(
            &app,
            &inner,
            &id,
            "sdk_remove",
            "running",
            "system",
            "Удаление SDK, принадлежащего CLEX Flow",
            None,
        );
        let result = (|| {
            if cancel.load(Ordering::SeqCst) {
                return Ok(None);
            }
            assert_owned(&paths, &sdk)?;
            // std::fs removes symlinks inside the tree rather than following them.
            fs::remove_dir_all(&slot).map_err(|e| format!("Не удалось удалить SDK: {e}"))?;
            let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
            let mut registry = paths.load()?;
            registry.installations.retain(|s| s.id != sdk_id);
            let selected = registry.active.get(PLATFORM) == Some(&sdk_id);
            registry.active.retain(|_, selected| selected != &sdk_id);
            if selected {
                *inner.environment.lock().map_err(|e| e.to_string())? = None;
            }
            paths.save(&registry)?;
            cancel.store(false, Ordering::SeqCst);
            Ok(None)
        })();
        idf::finish(&app, &inner, &id, "sdk_remove", result, &cancel);
    });
    Ok(())
}
#[tauri::command]
pub async fn sdk_install_plan(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    version: String,
) -> Result<crate::sdk_installer::InstallPlan, String> {
    let paths = Paths::for_app(&app)?;
    if !valid_version(&version) || !paths.load()?.available.iter().any(|v| v.version == version) {
        return Err("Версия отсутствует в каталоге".into());
    }
    if idf::busy(&state.0) {
        return Err("Дождитесь завершения операции".into());
    }
    tauri::async_runtime::spawn_blocking(move || crate::sdk_installer::plan(&version))
        .await
        .map_err(|e| e.to_string())?
}
pub fn installation_state(
    paths: &Paths,
    inner: &idf::Inner,
    sdk_id: &str,
    state: &str,
    message: &str,
) -> Result<(), String> {
    let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
    let mut registry = paths.load()?;
    let sdk = registry
        .installations
        .iter_mut()
        .find(|s| s.id == sdk_id)
        .ok_or("SDK отсутствует")?;
    sdk.state = state.into();
    sdk.diagnostic = message.into();
    paths.save(&registry)
}
pub fn completed_install(
    paths: &Paths,
    inner: &idf::Inner,
    sdk_id: &str,
    env: &Environment,
) -> Result<(), String> {
    store_result(paths, inner, sdk_id, &Ok(env.clone()), true)
}
#[tauri::command]
pub fn sdk_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    id: String,
    version: String,
    allow_prerequisites: bool,
) -> Result<(), String> {
    let paths = Paths::for_app(&app)?;
    let inner = state.0.clone();
    crate::sdk_installer::host_asset()?;
    let sdk = {
        let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
        let registry = paths.load()?;
        if !registry.available.iter().any(|v| v.version == version) || !valid_version(&version) {
            return Err("Версия отсутствует в официальном каталоге".into());
        }
        let slot = paths.slot(&version)?;
        let sdk = managed_sdk(&slot, &version);
        if registry
            .installations
            .iter()
            .any(|s| s.version == version && s.state == "ready" && Path::new(&s.root).is_dir())
        {
            return Err("Эта версия SDK уже доступна. Выберите обнаруженную установку без повторной загрузки.".into());
        }
        sdk
    };
    let cancel = idf::reserve(&inner, &id)?;
    std::thread::spawn(move || {
        let registration = (|| {
            let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
            let mut registry = paths.load()?;
            if let Some(entry) = registry
                .installations
                .iter_mut()
                .find(|entry| entry.id == sdk.id)
            {
                entry.state = "installing".into();
                entry.diagnostic.clear();
            } else {
                registry.installations.push(sdk.clone());
            }
            paths.save(&registry)
        })();
        if let Err(error) = registration {
            idf::finish(&app, &inner, &id, "sdk_install", Err(error), &cancel);
            return;
        }
        let result = crate::sdk_installer::install(
            &app,
            &inner,
            &id,
            &paths,
            &sdk,
            allow_prerequisites,
            &cancel,
        );
        if cancel.load(Ordering::SeqCst) {
            let _ = installation_state(
                &paths,
                &inner,
                &sdk.id,
                "interrupted",
                "Установка остановлена. Повторите её для продолжения.",
            );
        } else if let Err(error) = &result {
            let _ = installation_state(&paths, &inner, &sdk.id, "failed", error);
        }
        let result = if cancel.load(Ordering::SeqCst) {
            Ok(())
        } else {
            result
        };
        idf::finish(
            &app,
            &inner,
            &id,
            "sdk_install",
            result.map(|_| None),
            &cancel,
        );
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn paths(root: &Path) -> Paths {
        Paths {
            registry: root.join("config/sdk.json"),
            managed: root.join("managed"),
            cache: root.join("cache"),
        }
    }
    #[test]
    fn versions_cannot_escape_managed_root() {
        assert!(valid_version("5.4.4"));
        for bad in ["../5.4.4", "v5.4.4", "5.4", "5.4.4/../../", "5.4.4-beta"] {
            assert!(!valid_version(bad));
        }
    }
    #[test]
    fn external_sdk_cannot_be_removed() {
        let d = tempfile::tempdir().unwrap();
        let p = paths(d.path());
        let mut sdk = managed_sdk(&p.slot("5.4.4").unwrap(), "5.4.4");
        sdk.managed = false;
        assert!(assert_owned(&p, &sdk).is_err());
    }
    #[test]
    fn ownership_and_isolation_are_required() {
        let d = tempfile::tempdir().unwrap();
        let p = paths(d.path());
        let sdk = managed_sdk(&p.slot("5.4.4").unwrap(), "5.4.4");
        let slot = claim_slot(&p, &sdk).unwrap();
        assert_eq!(assert_owned(&p, &sdk).unwrap(), slot);
        fs::write(slot.join(".clex-sdk.json"), b"{}").unwrap();
        assert!(assert_owned(&p, &sdk).is_err());
    }
    #[test]
    fn multiple_versions_persist_independently() {
        let d = tempfile::tempdir().unwrap();
        let p = paths(d.path());
        let mut r = Registry::default();
        for v in ["5.4.4", "5.5.2"] {
            r.installations.push(managed_sdk(&p.slot(v).unwrap(), v));
        }
        r.active
            .insert(PLATFORM.into(), r.installations[1].id.clone());
        p.save(&r).unwrap();
        let loaded = p.load().unwrap();
        assert_eq!(loaded.installations.len(), 2);
        assert_eq!(loaded.active, r.active);
    }
    #[cfg(unix)]
    #[test]
    fn managed_symlink_does_not_authorize_external_deletion() {
        use std::os::unix::fs::symlink;
        let d = tempfile::tempdir().unwrap();
        let p = paths(d.path());
        fs::create_dir_all(&p.managed).unwrap();
        let outside = d.path().join("external");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("sentinel"), "user SDK").unwrap();
        let sdk = managed_sdk(&p.slot("5.4.4").unwrap(), "5.4.4");
        symlink(&outside, p.slot("5.4.4").unwrap()).unwrap();
        assert!(assert_owned(&p, &sdk).is_err());
        assert!(outside.join("sentinel").is_file());
    }
}
