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
    #[serde(default = "crate::boards::default_target")]
    pub target: String,
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
                    format!("Настройки SDK повреждены; исходный файл сохранен: {e}")
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
    pub fn slot_for(&self, version: &str, target: &str) -> Result<PathBuf, String> {
        crate::boards::compiler(target)?;
        let slot = self.slot(version)?;
        Ok(if target == PLATFORM {
            slot
        } else {
            self.managed.join(format!("v{version}-{target}"))
        })
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
        target: PLATFORM.into(),
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
// Discovery fills missing/stale hints; it must not undo a working manual override.
fn upsert_detected(registry: &mut Registry, mut sdk: Sdk) -> String {
    if let Some(old) = registry
        .installations
        .iter()
        .find(|old| old.root == sdk.root && old.state == "ready")
    {
        if old
            .python
            .as_deref()
            .is_some_and(|path| Path::new(path).is_file())
        {
            sdk.python = old.python.clone();
        }
        if old
            .tools_path
            .as_deref()
            .is_some_and(|path| Path::new(path).is_dir())
        {
            sdk.tools_path = old.tools_path.clone();
        }
        if old
            .git_path
            .as_deref()
            .is_some_and(|path| Path::new(path).is_file())
        {
            sdk.git_path = old.git_path.clone();
        }
    }
    upsert(registry, sdk)
}

pub fn eim_config_paths(home: &Path) -> Vec<PathBuf> {
    let mut configs: Vec<_> = crate::sdk_discovery::installation_bases(home)
        .iter()
        .flat_map(|base| crate::sdk_discovery::registries(base))
        .collect();
    configs.push(home.join("AppData/Local/Espressif/tools/eim_idf.json"));
    crate::sdk_discovery::unique(configs)
}

fn read_registration(registry: &mut Registry, config: &Path) {
    let Ok(file) = fs::File::open(config) else {
        return;
    };
    use std::io::Read;
    let mut bytes = Vec::new();
    if file.take(1024 * 1024 + 1).read_to_end(&mut bytes).is_err() || bytes.len() > 1024 * 1024 {
        return;
    }
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return;
    };
    let entries: Vec<_> = match &value["idfInstalled"] {
        serde_json::Value::Array(entries) => entries.iter().collect(),
        serde_json::Value::Object(entries) => entries.values().collect(),
        _ => return,
    };
    for entry in entries {
        let Some(root) = entry["path"].as_str() else {
            continue;
        };
        let tools = entry["idfToolsPath"]
            .as_str()
            .or_else(|| value["idfToolsPath"].as_str())
            .map(str::to_owned);
        if let Some(mut sdk) = new_external(
            Path::new(root),
            entry["python"].as_str().map(str::to_owned),
            tools,
        ) {
            sdk.git_path = value["gitPath"].as_str().map(str::to_owned);
            upsert_detected(registry, sdk);
        }
    }
}

fn detect_base(registry: &mut Registry, base: &Path) {
    for config in crate::sdk_discovery::registries(base) {
        read_registration(registry, &config);
    }
    for root in crate::sdk_discovery::roots_in(base) {
        if let Some(sdk) = new_external(&root, None, None) {
            upsert_detected(registry, sdk);
        }
    }
}

fn external_selection(
    registry: &mut Registry,
    root: &str,
    python: Option<String>,
    tools: Option<String>,
) -> Result<Sdk, String> {
    let selected = PathBuf::from(root.trim().trim_matches('"'));
    for base in crate::sdk_discovery::related_bases(&selected) {
        for config in crate::sdk_discovery::registries(&base) {
            read_registration(registry, &config);
        }
    }
    let mut roots = crate::sdk_discovery::roots_in(&selected);
    // The installer may keep SDK sources on a different disk than its tools.
    let mut local = Registry::default();
    for config in crate::sdk_discovery::registries(&selected) {
        read_registration(&mut local, &config);
    }
    for sdk in local.installations {
        let root = PathBuf::from(sdk.root);
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    let root = if idf_environment::sdk_version(&selected).is_ok() {
        selected
    } else {
        let compatible: Vec<_> = roots
            .iter()
            .filter(|root| {
                idf_environment::sdk_version(root).ok().as_deref() == Some(REQUIRED_VERSION)
            })
            .collect();
        match compatible.as_slice() {
            [root] => (*root).clone(),
            [] if roots.len() == 1 => roots[0].clone(),
            [] if roots.is_empty() => return Err("В выбранной папке ESP-IDF не найдена. Укажите папку установки Espressif или каталог с tools/idf.py.".into()),
            [] => return Err("В этой папке найдены другие версии ESP-IDF. Укажите каталог нужного SDK с tools/idf.py.".into()),
            _ => return Err("В выбранной папке несколько установок ESP-IDF 5.4.4. Укажите каталог конкретного SDK с tools/idf.py.".into()),
        }
    };
    let normalize = |value: Option<String>| {
        value
            .map(|v| v.trim().trim_matches('"').to_owned())
            .filter(|v| !v.is_empty())
    };
    new_external(&root, normalize(python), normalize(tools))
        .ok_or("Указанная ESP-IDF недоступна или повреждена".into())
}

pub fn detect(registry: &mut Registry, paths: &Paths, legacy: Option<&Path>) -> Result<(), String> {
    let home = idf_environment::home()?;
    for config in eim_config_paths(&home) {
        read_registration(registry, &config);
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
                        upsert_detected(registry, sdk);
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
            upsert_detected(registry, sdk);
        }
    }
    for base in crate::sdk_discovery::installation_bases(&home) {
        detect_base(registry, &base);
    }
    // Rediscover only our owned slots; never treat a directory as removable by location alone.
    if let Ok(entries) = fs::read_dir(&paths.managed) {
        for entry in entries.flatten() {
            if let Ok(bytes) = fs::read(entry.path().join(".clex-sdk.json")) {
                if let Ok(owner) = serde_json::from_slice::<Owner>(&bytes) {
                    if owner.family == "esp-idf" && valid_version(&owner.version) {
                        let slot = paths.slot_for(&owner.version, &owner.target)?;
                        if slot == entry.path()
                            && !registry.installations.iter().any(|s| s.id == owner.id)
                        {
                            registry.installations.push(managed_sdk_for(
                                &slot,
                                &owner.version,
                                &owner.target,
                            ));
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
            sdk.diagnostic = "SDK удален, перемещен или установка еще не завершена".into();
        } else if let Ok(version) = idf_environment::sdk_version(Path::new(&sdk.root)) {
            if version != sdk.version {
                sdk.state = "invalid".into();
                sdk.environment = None;
                sdk.diagnostic = "Версия SDK изменилась; повторите проверку".into();
            }
        } else {
            sdk.state = "invalid".into();
            sdk.environment = None;
            sdk.diagnostic = "Неполная или поврежденная установка".into();
        }
    }
    Ok(())
}
#[derive(Serialize, Deserialize)]
struct Owner {
    #[serde(default = "crate::boards::default_target")]
    target: String,
    id: String,
    family: String,
    version: String,
}
#[cfg(test)]
pub fn managed_sdk(slot: &Path, version: &str) -> Sdk {
    managed_sdk_for(slot, version, PLATFORM)
}
pub fn managed_sdk_for(slot: &Path, version: &str, target: &str) -> Sdk {
    Sdk {
        target: target.into(),
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
    let slot = paths.slot_for(&sdk.version, &sdk.target)?;
    fs::create_dir_all(&paths.managed).map_err(|e| e.to_string())?;
    no_link(&paths.managed)?;
    if slot.exists() {
        assert_owned(paths, sdk)?;
    } else {
        fs::create_dir(&slot).map_err(|e| e.to_string())?;
        fs::write(
            slot.join(".clex-sdk.json"),
            serde_json::to_vec(&Owner {
                target: sdk.target.clone(),
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
    let slot = paths.slot_for(&sdk.version, &sdk.target)?;
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
    if owner.id != sdk.id
        || owner.version != sdk.version
        || owner.family != "esp-idf"
        || owner.target != sdk.target
    {
        return Err("Маркер владельца SDK не совпадает".into());
    }
    Ok(slot)
}
pub fn validate(paths: &Paths, sdk: &Sdk) -> Result<Environment, String> {
    validate_target(paths, sdk, &sdk.target)
}
pub fn validate_target(paths: &Paths, sdk: &Sdk, target: &str) -> Result<Environment, String> {
    idf_environment::inspect_target(
        target,
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
    tools_path: Option<String>,
    target: &str,
) -> Result<Environment, String> {
    let paths = Paths::for_app(app)?;
    let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
    let mut registry = paths.load()?;
    detect(&mut registry, &paths, legacy(app).as_deref())?;
    if let Some(root) = root.filter(|v| !v.trim().is_empty()) {
        let sdk = external_selection(&mut registry, &root, python, tools_path)?;
        let id = upsert(&mut registry, sdk);
        registry.active.insert(target.into(), id);
    } else if !registry.active.contains_key(target) {
        if let Some(sdk) = registry
            .installations
            .iter()
            .find(|sdk| sdk.version == REQUIRED_VERSION && Path::new(&sdk.root).is_dir())
        {
            registry.active.insert(target.into(), sdk.id.clone());
        }
    }
    let selected=registry.active.get(target).cloned().ok_or_else(||{let _=paths.save(&registry);"Нужна ESP-IDF 5.4.4. Откройте «Инструменты разработки» и выберите существующий SDK или установку.".to_string()})?;
    let sdk = registry
        .installations
        .iter()
        .find(|sdk| sdk.id == selected)
        .cloned()
        .ok_or("Выбранный SDK не найден")?;
    let result = validate_target(&paths, &sdk, target);
    let selected_sdk = registry
        .installations
        .iter_mut()
        .find(|s| s.id == selected)
        .unwrap();
    match &result {
        Ok(env) => {
            selected_sdk.state = "ready".into();
            selected_sdk.diagnostic = env.version.clone();
            selected_sdk.python = Some(env.python.clone());
            selected_sdk.tools_path = Some(env.tools_path.clone());
            selected_sdk.checked_at = Some(now());
            selected_sdk.environment = Some(env.clone());
        }
        Err(error) => {
            selected_sdk.diagnostic = error.clone();
            if !selected_sdk
                .environment
                .as_ref()
                .is_some_and(|env| env.target != target)
            {
                selected_sdk.state = "invalid".into();
                selected_sdk.environment = None;
            }
        }
    }
    paths.save(&registry)?;
    result
}
#[tauri::command]
pub fn sdk_list(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    target: Option<String>,
) -> Result<Snapshot, String> {
    let target = crate::boards::target(target)?;
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
            e.target == target
                && Path::new(&e.root).is_dir()
                && registry.active.get(&target).is_some_and(|id| {
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
    target: &str,
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
                registry.active.insert(env.target.clone(), id.into());
                *inner.environment.lock().map_err(|e| e.to_string())? = Some(env.clone());
            }
        }
        Err(error) => {
            sdk.diagnostic = error.clone();
            if !sdk
                .environment
                .as_ref()
                .is_some_and(|env| env.target != target)
            {
                sdk.state = "invalid".into();
                sdk.environment = None;
            }
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
    target: Option<String>,
) -> Result<(), String> {
    let target = crate::boards::target(target)?;
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
        let result = validate_target(&paths, &sdk, &target);
        let outcome = if cancel.load(Ordering::SeqCst) {
            Ok(None)
        } else {
            store_result(&paths, &inner, &sdk_id, &result, true, &target)
                .and_then(|_| result.map(|_| None))
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
    tools_path: Option<String>,
) -> Result<(), String> {
    if idf::busy(&state.0) {
        return Err("Дождитесь завершения операции".into());
    }
    let paths = Paths::for_app(&app)?;
    let _guard = state.0.sdk_gate.lock().map_err(|e| e.to_string())?;
    let mut registry = paths.load()?;
    let sdk = external_selection(&mut registry, &root, python, tools_path)?;
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
            let selected = inner
                .environment
                .lock()
                .map_err(|e| e.to_string())?
                .as_ref()
                .is_some_and(|env| env.root == sdk.root);
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
    target: Option<String>,
) -> Result<crate::sdk_installer::InstallPlan, String> {
    let target = crate::boards::target(target)?;
    let paths = Paths::for_app(&app)?;
    if !valid_version(&version) || !paths.load()?.available.iter().any(|v| v.version == version) {
        return Err("Версия отсутствует в каталоге".into());
    }
    if idf::busy(&state.0) {
        return Err("Дождитесь завершения операции".into());
    }
    tauri::async_runtime::spawn_blocking(move || crate::sdk_installer::plan_for(&version, &target))
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
    store_result(paths, inner, sdk_id, &Ok(env.clone()), true, &env.target)
}
#[tauri::command]
pub fn sdk_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    id: String,
    version: String,
    target: Option<String>,
    allow_prerequisites: bool,
) -> Result<(), String> {
    let target = crate::boards::target(target)?;
    let paths = Paths::for_app(&app)?;
    let inner = state.0.clone();
    crate::sdk_installer::host_asset()?;
    let sdk = {
        let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
        let registry = paths.load()?;
        if !registry.available.iter().any(|v| v.version == version) || !valid_version(&version) {
            return Err("Версия отсутствует в официальном каталоге".into());
        }
        let slot = paths.slot_for(&version, &target)?;
        let sdk = managed_sdk_for(&slot, &version, &target);
        if registry.installations.iter().any(|s| {
            s.version == version
                && s.state == "ready"
                && s.environment
                    .as_ref()
                    .is_some_and(|env| env.target == target)
                && Path::new(&s.root).is_dir()
        }) {
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
                "Установка остановлена. Повторите ее для продолжения.",
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
    fn target_slots_keep_s3_and_p4_owned_and_independent() {
        let d = tempfile::tempdir().unwrap();
        let p = paths(d.path());
        let s3 = managed_sdk(&p.slot("5.4.4").unwrap(), "5.4.4");
        let p4 = managed_sdk_for(&p.slot_for("5.4.4", "esp32p4").unwrap(), "5.4.4", "esp32p4");
        let s3_slot = claim_slot(&p, &s3).unwrap();
        let p4_slot = claim_slot(&p, &p4).unwrap();
        assert_ne!(s3_slot, p4_slot);
        fs::write(s3_slot.join("sentinel"), b"existing S3").unwrap();
        assert_eq!(assert_owned(&p, &s3).unwrap(), s3_slot);
        assert_eq!(assert_owned(&p, &p4).unwrap(), p4_slot);
        let mut wrong = p4.clone();
        wrong.target = "esp32s3".into();
        assert!(assert_owned(&p, &wrong).is_err());
        assert!(p.slot_for("5.4.4", "../../").is_err());
        fs::remove_dir_all(assert_owned(&p, &p4).unwrap()).unwrap();
        assert_eq!(fs::read(s3_slot.join("sentinel")).unwrap(), b"existing S3");
        assert!(assert_owned(&p, &s3).is_ok());
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
    fn external_fixture(root: &Path, patch: u32) {
        fs::create_dir_all(root.join("components/esp_common/include")).unwrap();
        fs::create_dir_all(root.join("tools")).unwrap();
        fs::write(root.join("components/esp_common/include/esp_idf_version.h"), format!("#define ESP_IDF_VERSION_MAJOR 5\n#define ESP_IDF_VERSION_MINOR 4\n#define ESP_IDF_VERSION_PATCH {patch}\n")).unwrap();
        for file in ["tools/idf.py", "tools/idf_tools.py"] {
            fs::write(root.join(file), "fixture").unwrap();
        }
    }
    #[test]
    fn old_installer_registry_object_keeps_python_tools_git_and_source_file_intact() {
        let d = tempfile::tempdir().unwrap();
        let base = d.path().join("Espressif - пример");
        let root = base.join("frameworks/esp-idf-v5.4.4");
        external_fixture(&root, 4);
        let python = base.join("python_env/idf5.4_py3.11_env/Scripts/python.exe");
        let git = base.join("tools/idf-git/cmd/git.exe");
        let value = serde_json::json!({"idfToolsPath":base,"gitPath":git,"idfSelectedId":"id", "idfInstalled":{"id":{"path":root,"python":python,"version":"5.4"}}});
        let config = base.join("esp_idf.json");
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend(serde_json::to_vec(&value).unwrap());
        fs::write(&config, &bytes).unwrap();
        let mut registry = Registry::default();
        detect_base(&mut registry, &base);
        assert_eq!(registry.installations.len(), 1);
        let sdk = &registry.installations[0];
        assert_eq!(sdk.version, "5.4.4");
        assert_eq!(sdk.python.as_deref(), python.to_str());
        assert_eq!(sdk.tools_path.as_deref(), base.to_str());
        assert_eq!(sdk.git_path.as_deref(), git.to_str());
        assert!(!sdk.managed);
        assert_eq!(fs::read(&config).unwrap(), bytes);
        let selected =
            external_selection(&mut registry, &base.display().to_string(), None, None).unwrap();
        let id = upsert(&mut registry, selected);
        let sdk = registry.installations.iter().find(|s| s.id == id).unwrap();
        assert_eq!(sdk.python.as_deref(), python.to_str());
        assert_eq!(sdk.tools_path.as_deref(), base.to_str());
    }
    #[test]
    fn eim_registry_array_preserves_per_installation_tools_and_never_claims_external_sdk() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("v5.4.4/esp-idf");
        external_fixture(&root, 4);
        let tools = d.path().join("tools");
        fs::create_dir_all(&tools).unwrap();
        let config = tools.join("eim_idf.json");
        fs::write(&config, serde_json::to_vec(&serde_json::json!({"idfInstalled":[{"path":root,"idfToolsPath":tools,"python":"python.exe"}]})).unwrap()).unwrap();
        let mut registry = Registry::default();
        read_registration(&mut registry, &config);
        assert_eq!(registry.installations.len(), 1);
        assert_eq!(
            registry.installations[0].tools_path.as_deref(),
            tools.to_str()
        );
        assert!(!registry.installations[0].managed);
    }
    #[test]
    fn selecting_installation_container_rejects_ambiguous_sdks_and_honors_exact_root() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("frameworks/esp-idf-v5.4.4");
        let b = d.path().join("v5.4.4/esp-idf");
        external_fixture(&a, 4);
        external_fixture(&b, 4);
        let mut registry = Registry::default();
        assert!(
            external_selection(&mut registry, &d.path().display().to_string(), None, None)
                .unwrap_err()
                .contains("несколько")
        );
        let sdk = external_selection(
            &mut registry,
            &a.display().to_string(),
            None,
            Some(" custom tools ".into()),
        )
        .unwrap();
        assert_eq!(sdk.root, a.canonicalize().unwrap().to_string_lossy());
        assert_eq!(sdk.tools_path.as_deref(), Some("custom tools"));
        assert!(external_selection(
            &mut registry,
            &d.path().join("missing").display().to_string(),
            None,
            None
        )
        .is_err());
    }
    #[test]
    fn installation_registry_can_reference_sdk_sources_on_another_drive() {
        let d = tempfile::tempdir().unwrap();
        let base = d.path().join("tools-drive/Espressif");
        fs::create_dir_all(&base).unwrap();
        let root = d.path().join("source-drive/custom-sdk");
        external_fixture(&root, 4);
        fs::write(
            base.join("esp_idf.json"),
            serde_json::to_vec(
                &serde_json::json!({"idfToolsPath":base,"idfInstalled":{"sdk":{"path":root}}}),
            )
            .unwrap(),
        )
        .unwrap();
        let mut registry = Registry::default();
        let sdk =
            external_selection(&mut registry, &base.display().to_string(), None, None).unwrap();
        assert_eq!(sdk.root, root.canonicalize().unwrap().to_string_lossy());
        let id = upsert(&mut registry, sdk);
        assert_eq!(
            registry
                .installations
                .iter()
                .find(|s| s.id == id)
                .unwrap()
                .tools_path
                .as_deref(),
            base.to_str()
        );
    }
    #[test]
    fn rediscovery_preserves_valid_manual_python_and_tools_overrides() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("esp-idf");
        external_fixture(&root, 4);
        let custom_python = d.path().join("custom-python.exe");
        fs::write(&custom_python, "fixture").unwrap();
        let custom_tools = d.path().join("custom tools");
        fs::create_dir(&custom_tools).unwrap();
        let mut registry = Registry::default();
        let mut manual = new_external(
            &root,
            Some(custom_python.display().to_string()),
            Some(custom_tools.display().to_string()),
        )
        .unwrap();
        manual.state = "ready".into();
        let id = upsert(&mut registry, manual);
        let config = d.path().join("eim_idf.json");
        fs::write(&config, serde_json::to_vec(&serde_json::json!({"idfInstalled":[{"path":root,"python":"old-python.exe","idfToolsPath":"old-tools"}]})).unwrap()).unwrap();
        read_registration(&mut registry, &config);
        let sdk = registry
            .installations
            .iter()
            .find(|sdk| sdk.id == id)
            .unwrap();
        assert_eq!(sdk.python.as_deref(), custom_python.to_str());
        assert_eq!(sdk.tools_path.as_deref(), custom_tools.to_str());
        registry
            .installations
            .iter_mut()
            .find(|sdk| sdk.id == id)
            .unwrap()
            .state = "invalid".into();
        read_registration(&mut registry, &config);
        let sdk = registry
            .installations
            .iter()
            .find(|sdk| sdk.id == id)
            .unwrap();
        assert_eq!(sdk.python.as_deref(), Some("old-python.exe"));
        assert_eq!(sdk.tools_path.as_deref(), Some("old-tools"));
    }
}
