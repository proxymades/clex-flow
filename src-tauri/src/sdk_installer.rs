use crate::{
    idf, idf_environment,
    sdk::{self, AvailableVersion, Paths, Sdk},
};
use reqwest::blocking::Client;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

const EIM_VERSION: &str = "0.20.0";
pub struct Asset {
    pub name: &'static str,
    pub sha256: &'static str,
    pub archive: bool,
}
pub fn asset_for(os: &str, arch: &str) -> Result<Asset, String> {
    match (os, arch) {
        ("macos", "aarch64") => Ok(Asset {
            name: "eim-cli-macos-aarch64.zip",
            sha256: "a605c15163498875ef6a9efef5b82a9294df90a71f1a411e17f262abd55d6f2c",
            archive: true,
        }),
        ("macos", "x86_64") => Ok(Asset {
            name: "eim-cli-macos-x64.zip",
            sha256: "a006fb8a916aff4d6ae08f98120b4fc55bb72241071601b61f271a6d28723332",
            archive: true,
        }),
        ("windows", "x86_64") => Ok(Asset {
            name: "eim-cli-windows-x64.exe",
            sha256: "39ba2064bc7690509007ad532f6a669790610bec4290f8ceae4e4f5a993df197",
            archive: false,
        }),
        _ => Err("Автоматическая установка поддерживает macOS ARM64/x64 и Windows x64".into()),
    }
}
pub fn host_asset() -> Result<Asset, String> {
    asset_for(std::env::consts::OS, std::env::consts::ARCH)
}
fn official_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url
            .host_str()
            .map(|host| {
                [
                    "api.github.com",
                    "raw.githubusercontent.com",
                    "github.com",
                    "release-assets.githubusercontent.com",
                    "objects.githubusercontent.com",
                    "github-releases.githubusercontent.com",
                ]
                .contains(&host)
            })
            .unwrap_or(false)
}
fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("CLEX-Flow-SDK-Manager/0.1.0")
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if official_url(attempt.url()) && attempt.previous().len() < 5 {
                attempt.follow()
            } else {
                attempt.error("Неожиданный источник или цепочка перенаправлений")
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}
pub fn versions() -> Result<Vec<AvailableVersion>, String> {
    let response = client()?
        .get("https://api.github.com/repos/espressif/esp-idf/releases?per_page=30")
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Не удалось обновить каталог ESP-IDF: {e}"))?;
    let mut bytes = Vec::new();
    response
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Ответ каталога ESP-IDF превышает допустимый размер".into());
    }
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Не удалось прочитать официальный каталог ESP-IDF: {e}"))?;
    let mut result: Vec<_> = entries
        .iter()
        .filter(|e| e["prerelease"] == false && e["draft"] == false)
        .filter_map(|e| e["tag_name"].as_str()?.strip_prefix('v'))
        .filter(|v| {
            sdk::valid_version(v)
                && v.split('.')
                    .filter_map(|part| part.parse::<u32>().ok())
                    .collect::<Vec<_>>()
                    >= vec![5, 4, 0]
        })
        .map(|v| AvailableVersion {
            version: v.into(),
            supported: v == sdk::REQUIRED_VERSION,
        })
        .collect();
    if !result.iter().any(|v| v.version == sdk::REQUIRED_VERSION) {
        result.push(AvailableVersion {
            version: sdk::REQUIRED_VERSION.into(),
            supported: true,
        });
    }
    result.sort_by(|a, b| {
        b.version
            .split('.')
            .filter_map(|v| v.parse::<u32>().ok())
            .collect::<Vec<_>>()
            .cmp(
                &a.version
                    .split('.')
                    .filter_map(|v| v.parse::<u32>().ok())
                    .collect::<Vec<_>>(),
            )
    });
    result.dedup_by(|a, b| a.version == b.version);
    Ok(result)
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    pub tool_bytes: u64,
    pub estimated_min: u64,
    pub estimated_max: u64,
}
pub fn estimate_tools(value: &serde_json::Value, platform: &str) -> Result<u64, String> {
    let tools = value["tools"]
        .as_array()
        .ok_or("Некорректный официальный манифест инструментов")?;
    let mut total = 0;
    for tool in tools {
        if tool["install"].as_str() != Some("always") {
            continue;
        }
        if !tool["supported_targets"].as_array().is_some_and(|targets| {
            targets
                .iter()
                .any(|target| target == "esp32s3" || target == "all")
        }) {
            continue;
        }
        if let Some(version) = tool["versions"].as_array().and_then(|versions| {
            versions
                .iter()
                .find(|version| version["status"] == "recommended")
        }) {
            let download = if version[platform].is_object() {
                &version[platform]
            } else if platform == "macos-arm64" {
                &version["macos"]
            } else {
                continue;
            };
            total += download["size"].as_u64().unwrap_or(0);
        }
    }
    if total == 0 {
        return Err("Официальный манифест не содержит размеров для этой ОС".into());
    }
    Ok(total)
}
pub fn plan(version: &str) -> Result<InstallPlan, String> {
    let platform = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "macos-arm64",
        ("macos", "x86_64") => "macos",
        ("windows", "x86_64") => "win64",
        _ => return Err("Установка для этой ОС не поддерживается".into()),
    };
    let response = client()?
        .get(format!(
            "https://raw.githubusercontent.com/espressif/esp-idf/v{version}/tools/tools.json"
        ))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Не удалось получить объём загрузки: {e}"))?;
    let mut bytes = Vec::new();
    response
        .take(2 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let tool_bytes = estimate_tools(&value, platform)?;
    // Tool archives have exact published sizes; Git/submodules and Python vary.
    Ok(InstallPlan {
        tool_bytes,
        estimated_min: tool_bytes + 200 * 1024 * 1024,
        estimated_max: tool_bytes + 1024 * 1024 * 1024,
    })
}
pub fn copy_verified(
    mut reader: impl Read,
    mut writer: impl Write,
    digest: &str,
    total: Option<u64>,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, Option<u64>),
) -> Result<u64, String> {
    let mut sha = Sha256::new();
    let mut buffer = [0u8; 65536];
    let mut downloaded = 0u64;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("Загрузка остановлена".into());
        }
        let count = reader
            .read(&mut buffer)
            .map_err(|e| format!("Загрузка прервана: {e}"))?;
        if count == 0 {
            break;
        }
        downloaded += count as u64;
        if downloaded > 64 * 1024 * 1024 {
            return Err("Размер установщика превышает допустимый".into());
        }
        sha.update(&buffer[..count]);
        writer
            .write_all(&buffer[..count])
            .map_err(|e| format!("Ошибка записи; проверьте свободное место: {e}"))?;
        progress(downloaded, total);
    }
    if total.is_some_and(|total| total != downloaded) {
        return Err("Загрузка неполная".into());
    }
    if format!("{:x}", sha.finalize()) != digest {
        return Err("Контрольная сумма установщика не совпадает; запуск запрещён".into());
    }
    Ok(downloaded)
}
fn digest(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut sha = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        sha.update(&buffer[..count]);
    }
    Ok(format!("{:x}", sha.finalize()))
}
#[cfg(unix)]
pub fn free_bytes(path: &Path) -> Result<u64, String> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let path = CString::new(path.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    let result = unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) };
    if result != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let stat = unsafe { stat.assume_init() };
    Ok(stat.f_bavail as u64 * stat.f_frsize as u64)
}
#[cfg(windows)]
pub fn free_bytes(path: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            path: *const u16,
            available: *mut u64,
            total: *mut u64,
            free: *mut u64,
        ) -> i32;
    }
    let path: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0;
    let result = unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(available)
    }
}
fn existing_eim() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(home) = idf_environment::home() {
        for file in sdk::eim_config_paths(&home) {
            if let Ok(bytes) = fs::read(file) {
                if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    if let Some(path) = value["eimPath"].as_str() {
                        candidates.push(PathBuf::from(path));
                    }
                }
            }
        }
    }
    candidates.push(PathBuf::from("/Applications/eim.app/Contents/MacOS/eim"));
    if let Some(path) = idf_environment::find_tool("eim", &idf_environment::base_path()) {
        candidates.push(path);
    }
    candidates.into_iter().find(|path| {
        if !path.is_file() {
            return false;
        }
        let mut cmd = Command::new(path);
        cmd.args(["--do-not-track", "true", "install", "--help"]);
        idf_environment::capture(cmd, Duration::from_secs(10))
            .map(|(text, _)| {
                [
                    "--esp-idf-json-path",
                    "--idf-versions",
                    "--tool-install-folder-name",
                    "--activation-script-path-override",
                ]
                .iter()
                .all(|flag| text.contains(flag))
            })
            .unwrap_or(false)
    })
}
fn stage(app: &tauri::AppHandle, inner: &idf::Inner, id: &str, text: &str) {
    idf::publish(
        app,
        inner,
        id,
        "sdk_install",
        "running",
        "system",
        text,
        None,
    );
}
fn bootstrap(
    app: &tauri::AppHandle,
    inner: &Arc<idf::Inner>,
    id: &str,
    paths: &Paths,
    cancel: &Arc<AtomicBool>,
) -> Result<Option<PathBuf>, String> {
    if let Some(path) = existing_eim() {
        stage(app, inner, id, "Используем существующий официальный EIM");
        return Ok(Some(path));
    }
    let asset = host_asset()?;
    let folder = paths.cache.join(format!("eim-v{EIM_VERSION}"));
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let archive = folder.join(asset.name);
    let partial = folder.join(format!("{}.part", asset.name));
    if !archive.is_file() || digest(&archive)? != asset.sha256 {
        stage(
            app,
            inner,
            id,
            "Загрузка официального ESP-IDF Installation Manager",
        );
        let url = format!(
            "https://github.com/espressif/idf-im-ui/releases/download/v{EIM_VERSION}/{}",
            asset.name
        );
        let response = client()?
            .get(url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("Ошибка сети при загрузке EIM: {e}"))?;
        let total = response.content_length();
        let file = fs::File::create(&partial).map_err(|e| e.to_string())?;
        copy_verified(
            response,
            file,
            asset.sha256,
            total,
            cancel,
            |bytes, total| idf::publish_download(app, inner, id, bytes, total),
        )?;
        fs::rename(&partial, &archive).map_err(|e| e.to_string())?;
    }
    if cancel.load(Ordering::SeqCst) {
        return Ok(None);
    }
    stage(
        app,
        inner,
        id,
        "Целостность EIM подтверждена официальной SHA-256",
    );
    if !asset.archive {
        return Ok(Some(archive));
    }
    let unpack = folder.join("unpacked");
    fs::create_dir_all(&unpack).map_err(|e| e.to_string())?;
    let mut cmd = Command::new("/usr/bin/ditto");
    cmd.args(["-x", "-k"]).arg(&archive).arg(&unpack);
    if !idf::execute(app, inner, id, "sdk_install", cmd, cancel)? {
        return Ok(None);
    }
    let binary = unpack.join("eim");
    let metadata = fs::symlink_metadata(&binary)
        .map_err(|_| "Архив EIM не содержит ожидаемый исполняемый файл")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Неправильный исполняемый файл EIM".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    Ok(Some(binary))
}
pub fn eim_config(slot: &Path, version: &str, allow_prerequisites: bool) -> String {
    let q = |path: PathBuf| serde_json::to_string(&path.to_string_lossy()).unwrap();
    format!("path = {}\nesp_idf_json_path = {}\ntool_install_folder_name = {}\ntool_download_folder_name = {}\nactivation_script_path_override = {}\nconfig_file_save_path = {}\npython_env_folder_name = \"python\"\nidf_versions = [\"v{version}\"]\ntarget = [\"esp32s3\"]\nnon_interactive = true\ninstall_all_prerequisites = {allow_prerequisites}\nskip_prerequisites_check = false\nrecurse_submodules = true\ndo_not_track = true\ncleanup = true\nmirror = \"https://github.com\"\nidf_mirror = \"https://github.com\"\npypi_mirror = \"https://pypi.org/simple\"\n",q(slot.to_path_buf()),q(slot.join("registry")),q(slot.join("tools")),q(slot.join("downloads")),q(slot.join("activation")),q(slot.join("eim-settings.toml")))
}
pub fn eim_args(slot: &Path, allow_prerequisites: bool) -> Vec<String> {
    vec![
        "--do-not-track".into(),
        "true".into(),
        "--log-file".into(),
        slot.join("installation.log").to_string_lossy().into(),
        "--esp-idf-json-path".into(),
        slot.join("registry").to_string_lossy().into(),
        "install".into(),
        "--config".into(),
        slot.join("install.toml").to_string_lossy().into(),
        "--non-interactive".into(),
        "true".into(),
        "--install-all-prerequisites".into(),
        allow_prerequisites.to_string(),
    ]
}
fn refresh_eim_paths(slot: &Path, sdk: &mut Sdk) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_slice(
        &fs::read(slot.join("registry/eim_idf.json"))
            .map_err(|e| format!("EIM не создал реестр установки: {e}"))?,
    )
    .map_err(|e| e.to_string())?;
    let record = value["idfInstalled"]
        .as_array()
        .and_then(|entries| {
            entries
                .iter()
                .find(|e| e["name"].as_str() == Some(&format!("v{}", sdk.version)))
        })
        .ok_or("EIM не зарегистрировал требуемую версию")?;
    if record["status"].as_str() != Some("finished")
        || !record["path"].is_string()
        || !record["python"].is_string()
        || !record["idfToolsPath"].is_string()
    {
        return Err("EIM не завершил установку SDK и инструментов".into());
    }
    if let Some(path) = record["path"].as_str() {
        let canonical = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
        if !canonical.starts_with(slot.canonicalize().map_err(|e| e.to_string())?) {
            return Err("EIM создал SDK вне разрешённого каталога".into());
        }
        sdk.root = canonical.to_string_lossy().into();
    }
    sdk.python = record["python"].as_str().map(str::to_owned);
    sdk.git_path = value["gitPath"].as_str().map(str::to_owned);
    sdk.tools_path = record["idfToolsPath"].as_str().map(str::to_owned);
    let owner_root = slot.canonicalize().map_err(|e| e.to_string())?;
    // A venv's Python may legitimately be a symlink to the system interpreter.
    // Its enclosing venv and all tools must still belong to this managed slot.
    if let Some(python) = sdk.python.as_deref() {
        let parent = Path::new(python)
            .parent()
            .ok_or("Некорректный Python-путь")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !parent.starts_with(&owner_root) {
            return Err("Python окружение находится вне управляемого каталога".into());
        }
    }
    if let Some(tools) = sdk.tools_path.as_deref() {
        if !Path::new(tools)
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(&owner_root)
        {
            return Err("Инструменты находятся вне управляемого каталога".into());
        }
    }
    Ok(())
}
fn smoke(
    app: &tauri::AppHandle,
    inner: &Arc<idf::Inner>,
    id: &str,
    paths: &Paths,
    sdk: &Sdk,
    environment: &idf_environment::Environment,
    cancel: &Arc<AtomicBool>,
) -> Result<bool, String> {
    let dir = paths
        .cache
        .join("verification")
        .join(format!("{}-{id}", sdk.id));
    fs::create_dir_all(dir.join("main")).map_err(|e| e.to_string())?;
    fs::write(dir.join("CMakeLists.txt"),"cmake_minimum_required(VERSION 3.16)\nset(COMPONENTS main)\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(clex_sdk_check)\n").map_err(|e|e.to_string())?;
    fs::write(dir.join("main/CMakeLists.txt"),"idf_component_register(SRCS \"main.c\" INCLUDE_DIRS \".\" REQUIRES esp_driver_gpio esp_timer freertos log)\n").map_err(|e|e.to_string())?;
    fs::write(dir.join("main/main.c"),"#include \"driver/gpio.h\"\n#include \"esp_timer.h\"\n#include \"esp_log.h\"\nvoid app_main(void) { ESP_LOGI(\"CLEX\", \"SDK check: %lld\", esp_timer_get_time()); }\n").map_err(|e|e.to_string())?;
    let mut cmd = Command::new(&environment.python);
    cmd.arg(Path::new(&environment.root).join("tools/idf.py"))
        .args(["-D", "IDF_TARGET=esp32s3", "build"])
        .envs(&environment.variables)
        .current_dir(&dir);
    let result = idf::execute(app, inner, id, "sdk_install", cmd, cancel)?;
    if result && !dir.join("build/clex_sdk_check.bin").is_file() {
        return Err("Проверочная компиляция не создала прошивку".into());
    }
    Ok(result)
}
pub fn install(
    app: &tauri::AppHandle,
    inner: &Arc<idf::Inner>,
    id: &str,
    paths: &Paths,
    sdk: &Sdk,
    allow_prerequisites: bool,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    stage(
        app,
        inner,
        id,
        "Подготовка отдельного каталога SDK CLEX Flow",
    );
    let slot = sdk::claim_slot(paths, sdk)?;
    if free_bytes(&slot)? < 8 * 1024 * 1024 * 1024 {
        return Err("Для установки SDK требуется не менее 8 ГиБ свободного места".into());
    }
    sdk::installation_state(paths, inner, &sdk.id, "installing", "Подготовка и загрузка")?;
    let Some(eim) = bootstrap(app, inner, id, paths, cancel)? else {
        return Ok(());
    };
    if cancel.load(Ordering::SeqCst) {
        return Ok(());
    }
    fs::write(
        slot.join("install.toml"),
        eim_config(&slot, &sdk.version, allow_prerequisites),
    )
    .map_err(|e| e.to_string())?;
    stage(
        app,
        inner,
        id,
        "EIM: проверка зависимостей, загрузка SDK, компиляторов и Python",
    );
    let mut command = Command::new(eim);
    command
        .args(eim_args(&slot, allow_prerequisites))
        .current_dir(&slot);
    // Overrides apply only to the child; existing shells, SDKs and global profiles are untouched.
    for (key, _) in std::env::vars() {
        if key.starts_with("ESP_")
            || ["IDF_PATH", "IDF_TOOLS_PATH", "IDF_PYTHON_ENV_PATH"].contains(&key.as_str())
        {
            command.env_remove(key);
        }
    }
    command
        .env("PATH", idf_environment::base_path())
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PIP_CACHE_DIR", slot.join("pip-cache"));
    #[cfg(windows)]
    {
        command
            .env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "core.longpaths")
            .env("GIT_CONFIG_VALUE_0", "true");
    }
    if !idf::execute(app, inner, id, "sdk_install", command, cancel)? {
        return Ok(());
    }
    if cancel.load(Ordering::SeqCst) {
        return Ok(());
    }
    let mut installed = sdk.clone();
    refresh_eim_paths(&slot, &mut installed)?;
    {
        let _guard = inner.sdk_gate.lock().map_err(|e| e.to_string())?;
        let mut registry = paths.load()?;
        if let Some(entry) = registry.installations.iter_mut().find(|s| s.id == sdk.id) {
            entry.root = installed.root.clone();
            entry.python = installed.python.clone();
            entry.tools_path = installed.tools_path.clone();
            entry.git_path = installed.git_path.clone();
        }
        paths.save(&registry)?;
    }
    stage(
        app,
        inner,
        id,
        "Проверяем установленный Python, GCC, CMake и Ninja",
    );
    let environment = sdk::validate(paths, &installed)?;
    if environment.sdk_version != installed.version {
        return Err("Установлена другая версия SDK".into());
    }
    if cancel.load(Ordering::SeqCst) {
        return Ok(());
    }
    stage(
        app,
        inner,
        id,
        "Проверочная компиляция ESP32-S3 без прошивки устройства",
    );
    if !smoke(app, inner, id, paths, &installed, &environment, cancel)? {
        return Ok(());
    }
    if cancel.load(Ordering::SeqCst) {
        return Ok(());
    }
    sdk::completed_install(paths, inner, &installed.id, &environment)?;
    cancel.store(false, Ordering::SeqCst);
    stage(
        app,
        inner,
        id,
        "SDK установлен, проверен компиляцией и выбран для ESP32-S3",
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn assets_cover_supported_architectures() {
        for (os, arch) in [
            ("macos", "aarch64"),
            ("macos", "x86_64"),
            ("windows", "x86_64"),
        ] {
            assert_eq!(asset_for(os, arch).unwrap().sha256.len(), 64);
        }
        assert!(asset_for("windows", "aarch64").is_err());
    }
    #[test]
    fn download_rejects_corruption_and_truncation() {
        let input = b"small fixture";
        let hash = format!("{:x}", Sha256::digest(input));
        let cancel = AtomicBool::new(false);
        let mut result = Vec::new();
        assert!(copy_verified(
            &input[..],
            &mut result,
            &hash,
            Some(input.len() as u64),
            &cancel,
            |_, _| {}
        )
        .is_ok());
        assert_eq!(result, input);
        assert!(copy_verified(
            &input[..],
            Vec::new(),
            &"0".repeat(64),
            None,
            &cancel,
            |_, _| {}
        )
        .is_err());
        assert!(
            copy_verified(&input[..], Vec::new(), &hash, Some(999), &cancel, |_, _| {}).is_err()
        );
    }
    #[test]
    fn download_cancellation_never_reports_success() {
        let cancel = AtomicBool::new(true);
        assert!(copy_verified(
            &b"x"[..],
            Vec::new(),
            &"0".repeat(64),
            None,
            &cancel,
            |_, _| {}
        )
        .unwrap_err()
        .contains("остановлена"));
    }
    fn assert_owned_eim_configuration(slot: &Path, allow_prerequisites: bool) {
        let text = eim_config(slot, "5.4.4", allow_prerequisites);
        let config: toml::Value =
            toml::from_str(&text).expect("EIM configuration must be valid TOML");
        // Compare decoded paths, not serialized slashes: Windows joins with
        // backslashes, which TOML basic strings escape before writing.
        for (key, expected) in [
            ("path", slot.to_path_buf()),
            ("esp_idf_json_path", slot.join("registry")),
            ("tool_install_folder_name", slot.join("tools")),
            ("tool_download_folder_name", slot.join("downloads")),
            ("activation_script_path_override", slot.join("activation")),
            ("config_file_save_path", slot.join("eim-settings.toml")),
        ] {
            assert_eq!(
                config[key].as_str(),
                Some(expected.to_string_lossy().as_ref()),
                "{key}"
            );
        }
        for (key, expected) in [
            ("install_all_prerequisites", allow_prerequisites),
            ("non_interactive", true),
            ("skip_prerequisites_check", false),
            ("recurse_submodules", true),
            ("do_not_track", true),
            ("cleanup", true),
        ] {
            assert_eq!(config[key].as_bool(), Some(expected), "{key}");
        }
        assert_eq!(
            config["idf_versions"],
            toml::Value::Array(vec![toml::Value::String("v5.4.4".into())])
        );
        assert_eq!(
            config["target"],
            toml::Value::Array(vec![toml::Value::String("esp32s3".into())])
        );
        assert_eq!(config["python_env_folder_name"].as_str(), Some("python"));
        let args = eim_args(slot, allow_prerequisites);
        assert_eq!(
            args,
            vec![
                "--do-not-track".to_string(),
                "true".into(),
                "--log-file".into(),
                slot.join("installation.log").to_string_lossy().into(),
                "--esp-idf-json-path".into(),
                slot.join("registry").to_string_lossy().into(),
                "install".into(),
                "--config".into(),
                slot.join("install.toml").to_string_lossy().into(),
                "--non-interactive".into(),
                "true".into(),
                "--install-all-prerequisites".into(),
                allow_prerequisites.to_string(),
            ]
        );
    }
    #[test]
    fn eim_configuration_uses_only_the_owned_slot() {
        let directory = tempfile::tempdir().unwrap();
        let slot = directory.path().join("CLEX SDK – тест");
        assert_owned_eim_configuration(&slot, false);
        assert_owned_eim_configuration(&slot, true);
    }
    #[test]
    fn mirrors_and_redirects_are_restricted() {
        assert!(official_url(
            &reqwest::Url::parse("https://github.com/espressif/idf-im-ui").unwrap()
        ));
        for bad in [
            "http://github.com",
            "https://github.com.evil.test",
            "https://example.com",
        ] {
            assert!(!official_url(&reqwest::Url::parse(bad).unwrap()));
        }
    }
    #[test]
    fn interrupted_network_can_retry_without_accepting_partial_bytes() {
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::new(
                    std::io::ErrorKind::ConnectionReset,
                    "fixture interruption",
                ))
            }
        }
        let cancel = AtomicBool::new(false);
        let input = b"complete fixture";
        let checksum = format!("{:x}", Sha256::digest(input));
        assert!(
            copy_verified(Broken, Vec::new(), &checksum, None, &cancel, |_, _| {})
                .unwrap_err()
                .contains("прервана")
        );
        assert!(copy_verified(&input[..], Vec::new(), &checksum, None, &cancel, |_, _| {}).is_ok());
    }
    #[test]
    fn installer_success_text_does_not_replace_sdk_verification() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("registry")).unwrap();
        fs::write(
            d.path().join("registry/eim_idf.json"),
            br#"{"idfInstalled":[{"name":"v5.4.4","status":"finished"}]}"#,
        )
        .unwrap();
        let mut sdk = sdk::managed_sdk(d.path(), "5.4.4");
        assert!(refresh_eim_paths(d.path(), &mut sdk).is_err());
        assert_ne!(sdk.state, "ready");
    }
    #[test]
    fn manifest_estimates_use_official_sizes_and_target() {
        let value = serde_json::json!({"tools":[{"install":"always","supported_targets":["esp32s3"],"versions":[{"status":"recommended","macos":{"size":1234},"win64":{"size":2345}}]},{"install":"always","supported_targets":["esp32c6"],"versions":[{"status":"recommended","macos":{"size":9000}}]}]});
        assert_eq!(estimate_tools(&value, "macos-arm64").unwrap(), 1234);
        assert_eq!(estimate_tools(&value, "win64").unwrap(), 2345);
    }
    #[test]
    fn windows_paths_are_encoded_as_toml_basic_strings() {
        let slot = Path::new(r"C:\Users\SDK Test\CLEX");
        let text = eim_config(slot, "5.4.4", false);
        assert!(text.contains(r"C:\\Users"));
        assert!(!text.contains("powershell -Command"));
        assert_owned_eim_configuration(slot, false);
    }
    #[test]
    fn eim_paths_round_trip_spaces_unicode_quotes_and_backslashes() {
        // No directory creation or installer execution: test serialization only.
        for slot in [
            r#"/tmp/SDK тест/quoted "slot""#,
            r#"C:\Users\Иван\SDK Test"#,
            r"\\server\SDK share\CLEX",
        ] {
            assert_owned_eim_configuration(Path::new(slot), false);
        }
    }
    #[cfg(unix)]
    #[test]
    fn real_process_runner_handles_small_installer_error_response() {
        let inner = Arc::new(idf::Inner::default());
        let id = "00000000-0000-4000-8000-000000000042";
        let cancel = idf::reserve(&inner, id).unwrap();
        let output = Arc::new(std::sync::Mutex::new(String::new()));
        let captured = output.clone();
        let emit =
            Arc::new(move |_: &str, _: &str, text: &str| captured.lock().unwrap().push_str(text));
        let mut command = Command::new("/bin/sh");
        command.args([
            "-c",
            "printf 'EIM fixture: downloading compiler'; printf 'installer error' >&2; exit 7",
        ]);
        let result = idf::execute_process(&inner, "sdk_install", command, &cancel, emit);
        assert!(result.unwrap_err().contains('7'));
        let text = output.lock().unwrap();
        assert!(text.contains("downloading compiler"));
        assert!(text.contains("installer error"));
        idf::release(&inner, id);
    }
    #[cfg(unix)]
    #[test]
    fn real_process_runner_can_cancel_small_fixture_installer() {
        let inner = Arc::new(idf::Inner::default());
        let id = "00000000-0000-4000-8000-000000000043";
        let cancel = idf::reserve(&inner, id).unwrap();
        let stop = cancel.clone();
        let emit = Arc::new(move |_: &str, _: &str, text: &str| {
            if text.contains("fixture ready") {
                stop.store(true, Ordering::SeqCst);
            }
        });
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "printf 'fixture ready'; sleep 20"]);
        assert!(!idf::execute_process(&inner, "sdk_install", command, &cancel, emit).unwrap());
        idf::release(&inner, id);
    }
    #[test]
    #[ignore = "Read-only integration check with an explicitly provided existing SDK"]
    fn inspect_existing_sdk_read_only() {
        let root =
            std::env::var("CLEX_TEST_SDK_ROOT").expect("explicit existing SDK path required");
        let python = std::env::var("CLEX_TEST_SDK_PYTHON").unwrap();
        let tools = std::env::var("CLEX_TEST_SDK_TOOLS").unwrap();
        let cache = tempfile::tempdir().unwrap();
        let environment = idf_environment::inspect(
            Path::new(&root),
            Some(Path::new(&python)),
            Some(Path::new(&tools)),
            None,
            cache.path(),
        )
        .unwrap();
        assert_eq!(environment.sdk_version, "5.4.4");
        assert!(environment.compiler_version.contains("gcc"));
        println!(
            "SDK={} / {} / {} / Ninja {}",
            environment.version,
            environment.compiler_version,
            environment.cmake_version,
            environment.ninja_version
        );
        assert!(environment
            .variables
            .get("IDF_DEACTIVATE_FILE_PATH")
            .unwrap()
            .starts_with(cache.path().to_str().unwrap()));
        if let Ok(project) = std::env::var("CLEX_TEST_PROJECT_DIR") {
            let inner = Arc::new(idf::Inner::default());
            let id = "00000000-0000-4000-8000-000000000044";
            let cancel = idf::reserve(&inner, id).unwrap();
            let log =
                std::fs::File::create(Path::new(&project).join("sdk-manager-build.log")).unwrap();
            let log = Arc::new(std::sync::Mutex::new(log));
            let emit = Arc::new(move |_: &str, _: &str, text: &str| {
                let mut log = log.lock().unwrap();
                writeln!(log, "{text}").unwrap();
            });
            let mut command = Command::new(&environment.python);
            command
                .arg(Path::new(&environment.root).join("tools/idf.py"))
                .args(["-D", "IDF_TARGET=esp32s3", "build"])
                .envs(&environment.variables)
                .current_dir(&project);
            if std::env::var("CLEX_TEST_GRAPHICS_RUNTIME").ok().as_deref() == Some("lvgl-9.2.2") {
                command.env("IDF_COMPONENT_MANAGER", "1").env(
                    "IDF_COMPONENT_CACHE_PATH",
                    Path::new(&project).join("component-cache"),
                );
            }
            assert!(idf::execute_process(&inner, "build", command, &cancel, emit).unwrap());
            assert!(Path::new(&project)
                .join("build/clex_flow_firmware.bin")
                .is_file());
            println!("Real SDK Manager environment built the test firmware successfully");
            idf::release(&inner, id);
        }
    }
    #[test]
    #[ignore = "Network integration: official metadata only, no SDK download"]
    fn official_catalog_and_size_plan() {
        let catalogue = versions().unwrap();
        assert!(catalogue.iter().any(|v| v.version == "5.4.4"));
        assert!(catalogue.len() > 1);
        let plan = plan("5.4.4").unwrap();
        assert!(plan.tool_bytes > 1024 * 1024);
        println!("Official catalogue: {} versions; tool archives: {} bytes; estimated total: {}-{} bytes",catalogue.len(),plan.tool_bytes,plan.estimated_min,plan.estimated_max);
    }
    #[test]
    fn free_space_probe_is_real() {
        let d = tempfile::tempdir().unwrap();
        assert!(free_bytes(d.path()).unwrap() > 0);
    }
}
