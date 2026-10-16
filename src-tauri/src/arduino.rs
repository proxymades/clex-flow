use crate::{
    idf,
    idf_environment::{self, Environment, Port},
    sdk::{AvailableVersion, Sdk, Snapshot},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};
use tauri::Manager;
pub const VERSION: &str = "1.8.6";
pub const TARGET: &str = "atmega328p";
const GCC: &str = "7.3.0-atmel3.6.1-arduino7";
const AVRDUDE: &str = "6.3.0-arduino17";
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArduinoEnvironment {
    pub cli: String,
    pub data: String,
    pub config: String,
    pub compiler: String,
    pub avrdude: String,
    pub managed: bool,
}
fn exe(name: &str) -> String {
    format!("{name}{}", if cfg!(windows) { ".exe" } else { "" })
}
fn text(path: &Path) -> String {
    idf_environment::tool_path(path).to_string_lossy().into()
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn managed_slot(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::tooling::tools_root(app)?.join("arduino-avr/v1.8.6"))
}
fn settings(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("arduino-tools.json"))
}
fn cache(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("arduino"))
}
pub fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("Нет каталога настроек")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn config(cli: &Path, data: &Path, workspace: &Path) -> Result<ArduinoEnvironment, String> {
    fs::create_dir_all(workspace).map_err(|e| e.to_string())?;
    let file = workspace.join(format!(
        "{}-config.json",
        hash(data.as_os_str().as_encoded_bytes())
    ));
    write_json(
        &file,
        &serde_json::json!({"directories":{"data":text(data),"downloads":text(&workspace.join("downloads")),"user":text(&workspace.join("sketchbook"))},"board_manager":{"additional_urls":[],"enable_unsafe_install":false},"library":{"enable_unsafe_install":false},"metrics":{"enabled":false},"locale":"en","build_cache":{"path":text(&workspace.join("build-cache"))},"network":{"cloud_api":{"skip_board_detection_calls":true}},"updater":{"enable_notification":false}}),
    )?;
    Ok(ArduinoEnvironment {
        cli: text(cli),
        data: text(data),
        config: text(&file),
        compiler: text(&data.join(format!(
            "packages/arduino/tools/avr-gcc/{GCC}/bin/{}",
            exe("avr-gcc")
        ))),
        avrdude: text(&data.join(format!(
            "packages/arduino/tools/avrdude/{AVRDUDE}/bin/{}",
            exe("avrdude")
        ))),
        managed: false,
    })
}
pub fn command(env: &ArduinoEnvironment) -> Command {
    let mut c = Command::new(&env.cli);
    c.args(["--config-file", &env.config, "--no-color"]);
    // Never let an IDE/shell redirect this command to another installation.
    for (key, _) in std::env::vars() {
        if key.starts_with("ARDUINO_") {
            c.env_remove(key);
        }
    }
    c
}
pub fn inspect(
    cli: &Path,
    data: &Path,
    workspace: &Path,
    managed: bool,
) -> Result<Environment, String> {
    let core = data.join(format!("packages/arduino/hardware/avr/{VERSION}"));
    let platform = fs::read_to_string(core.join("platform.txt"))
        .map_err(|_| "В выбранном каталоге нет Arduino AVR Boards 1.8.6")?;
    if !platform
        .lines()
        .any(|s| s.trim() == format!("version={VERSION}"))
        || !core.join("boards.txt").is_file()
    {
        return Err("Неполная установка Arduino AVR Boards 1.8.6".into());
    }
    let mut a = config(cli, data, workspace)?;
    a.managed = managed;
    if !Path::new(&a.avrdude).is_file() {
        return Err("Не найден AVRDUDE для загрузки прошивки Nano".into());
    }
    let mut version = command(&a);
    version.args(["version", "--json"]);
    let (cli_version, _) = idf_environment::capture(version, Duration::from_secs(15))?;
    let version: serde_json::Value =
        serde_json::from_str(&cli_version).map_err(|e| format!("Arduino CLI: {e}"))?;
    let mut compiler = Command::new(&a.compiler);
    compiler.arg("--version");
    let (compiler_version,_)=idf_environment::capture(compiler,Duration::from_secs(15)).map_err(|e|format!("AVR GCC не запускается. На macOS Apple Silicon для официального AVR GCC может требоваться Rosetta 2. {e}"))?;
    if !compiler_version.contains("7.3.0") {
        return Err("Требуется AVR GCC 7.3.0 из Arduino AVR Boards 1.8.6".into());
    }
    let identity =
        hash(&serde_json::to_vec(&(&a, VERSION, &compiler_version)).map_err(|e| e.to_string())?);
    Ok(Environment {
        target: TARGET.into(),
        root: text(data),
        python: String::new(),
        tools_path: text(data),
        sdk_version: VERSION.into(),
        identity,
        version: format!(
            "Arduino AVR {VERSION} · CLI {}",
            version["VersionString"]
                .as_str()
                .ok_or("Неизвестная версия Arduino CLI")?
        ),
        compiler_version: compiler_version.lines().next().unwrap_or_default().into(),
        cmake_version: String::new(),
        ninja_version: String::new(),
        diagnostics: String::new(),
        variables: BTreeMap::new(),
        arduino: Some(a),
    })
}
fn candidates(app: &tauri::AppHandle) -> Result<Vec<(PathBuf, PathBuf, bool)>, String> {
    let mut result = Vec::new();
    let slot = managed_slot(app)?;
    result.push((slot.join(exe("arduino-cli")), slot.join("data"), true));
    for root in crate::tooling::tool_roots(app)? {
        let slot = root.join("arduino-avr/v1.8.6");
        result.push((slot.join(exe("arduino-cli")), slot.join("data"), true));
    }
    if let Ok(bytes) = fs::read(settings(app)?) {
        if let Ok(a) = serde_json::from_slice::<ArduinoEnvironment>(&bytes) {
            result.push((a.cli.into(), a.data.into(), a.managed));
        }
    }
    let home = idf_environment::home()?;
    let mut clis = Vec::new();
    if let Some(cli) = idf_environment::find_tool("arduino-cli", &idf_environment::base_path()) {
        clis.push(cli);
    }
    #[cfg(target_os = "macos")]
    clis.push(PathBuf::from(
        "/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli",
    ));
    #[cfg(windows)]
    for var in ["LOCALAPPDATA", "ProgramFiles"] {
        if let Some(base) = std::env::var_os(var) {
            clis.push(
                PathBuf::from(base).join(
                    "Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe",
                ),
            );
            clis.push(
                PathBuf::from(std::env::var_os(var).unwrap())
                    .join("Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"),
            );
        }
    }
    let data = if cfg!(target_os = "macos") {
        home.join("Library/Arduino15")
    } else if cfg!(windows) {
        home.join("AppData/Local/Arduino15")
    } else {
        home.join(".arduino15")
    };
    result.extend(
        clis.into_iter()
            .filter(|p| p.is_file())
            .map(|cli| (cli, data.clone(), false)),
    );
    Ok(result)
}
pub fn auto_environment(
    app: &tauri::AppHandle,
    cli: Option<String>,
    data: Option<String>,
) -> Result<Environment, String> {
    let workspace = cache(app)?;
    let list = candidates(app)?;
    let mut last = String::new();
    let list = if let Some(cli) = cli.filter(|s| !s.trim().is_empty()) {
        let cli = PathBuf::from(cli.trim().trim_matches('"'));
        let default = list
            .iter()
            .find(|(_, d, _)| {
                d.join(format!("packages/arduino/hardware/avr/{VERSION}"))
                    .is_dir()
            })
            .map(|(_, d, _)| d.clone());
        vec![(
            cli,
            data.filter(|s| !s.trim().is_empty())
                .map(PathBuf::from)
                .or(default)
                .ok_or("Укажите каталог данных Arduino с папкой packages")?,
            false,
        )]
    } else {
        list
    };
    for (cli, data, managed) in list {
        if !cli.is_file()
            || !data
                .join(format!("packages/arduino/hardware/avr/{VERSION}"))
                .is_dir()
        {
            continue;
        }
        match inspect(&cli, &data, &workspace, managed) {
            Ok(env) => {
                write_json(&settings(app)?, env.arduino.as_ref().unwrap())?;
                return Ok(env);
            }
            Err(e) => last = e,
        }
    }
    Err(if last.is_empty() {
        "Инструменты Arduino AVR не найдены. Откройте первоначальную настройку и подготовьте инструменты поддерживаемых плат.".into()
    } else {
        last
    })
}
pub fn snapshot(app: &tauri::AppHandle, inner: &idf::Inner) -> Result<Snapshot, String> {
    let saved = fs::read(settings(app)?)
        .ok()
        .and_then(|b| serde_json::from_slice::<ArduinoEnvironment>(&b).ok());
    let environment = inner
        .environment
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .filter(|e| e.target == TARGET);
    let installations = saved
        .map(|a| Sdk {
            target: TARGET.into(),
            id: "arduino-avr".into(),
            family: "arduino-avr".into(),
            version: VERSION.into(),
            root: a.data.clone(),
            python: None,
            tools_path: Some(a.data),
            git_path: None,
            managed: a.managed,
            slot: None,
            state: if environment.is_some() {
                "ready"
            } else {
                "detected"
            }
            .into(),
            diagnostic: String::new(),
            checked_at: None,
            environment: environment.clone(),
        })
        .into_iter()
        .collect();
    Ok(Snapshot {
        installations,
        active: BTreeMap::from([(TARGET.into(), "arduino-avr".into())]),
        available: vec![AvailableVersion {
            version: VERSION.into(),
            supported: true,
        }],
        catalog_error: String::new(),
        managed_path: text(&managed_slot(app)?),
        host: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        environment,
    })
}
pub fn ports(env: &ArduinoEnvironment) -> Result<Vec<Port>, String> {
    let mut c = command(env);
    c.args(["board", "list", "--json"]);
    let (out, _) = idf_environment::capture(c, Duration::from_secs(15))?;
    let value: serde_json::Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    let entries = value["detected_ports"]
        .as_array()
        .or_else(|| value.as_array())
        .ok_or("Arduino CLI вернул неизвестный список портов")?;
    Ok(entries
        .iter()
        .filter_map(|v| {
            let p = &v["port"];
            let path = p["address"].as_str()?;
            if p["protocol"] != "serial" || !idf_environment::allowed_port(path) {
                return None;
            }
            Some(Port {
                path: path.into(),
                description: p["label"].as_str().unwrap_or("USB-UART").into(),
                usb: p["properties"]["vid"].is_string(),
            })
        })
        .collect())
}
pub fn fqbn(revision: &str) -> Result<&'static str, String> {
    match revision {
        "standard" => Ok("arduino:avr:nano:cpu=atmega328"),
        "old" => Ok("arduino:avr:nano:cpu=atmega328old"),
        _ => Err("Неизвестный загрузчик Nano".into()),
    }
}
pub fn write_project(dir: &Path, spec: &idf::Specification) -> Result<(), String> {
    fqbn(
        spec.board_revision
            .as_deref()
            .ok_or("Выберите загрузчик Nano")?,
    )?;
    if spec.graphics_runtime.is_some()
        || spec.network_runtime.is_some()
        || !spec.feature_runtimes.is_empty()
    {
        return Err("Драйвер ESP-IDF нельзя использовать в прошивке Arduino AVR".into());
    }
    fs::create_dir_all(dir.join("clex_flow/src")).map_err(|e| e.to_string())?;
    fs::write(
        dir.join("clex_flow/clex_flow.ino"),
        "// The generated runtime is in src/flow.cpp.\n",
    )
    .map_err(|e| e.to_string())?;
    fs::write(dir.join("clex_flow/src/flow.cpp"), &spec.main_c).map_err(|e| e.to_string())?;
    fs::write(
        dir.join("fqbn.txt"),
        fqbn(spec.board_revision.as_deref().unwrap())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn build_command(
    a: &ArduinoEnvironment,
    dir: &Path,
    revision: &str,
) -> Result<Command, String> {
    let mut cmd = command(a);
    cmd.args([
        "compile",
        "--fqbn",
        fqbn(revision)?,
        "--warnings",
        "all",
        "--build-path",
    ])
    .arg(dir.join("build"))
    .arg("--output-dir")
    .arg(dir.join("build"))
    .arg(dir.join("clex_flow"));
    Ok(cmd)
}
pub fn verify_memory(a: &ArduinoEnvironment, dir: &Path) -> Result<(), String> {
    let size = Path::new(&a.compiler).with_file_name(exe("avr-size"));
    let mut cmd = Command::new(size);
    cmd.arg("-A").arg(dir.join("build/clex_flow.ino.elf"));
    let (out, _) = idf_environment::capture(cmd, Duration::from_secs(10))?;
    let mut ram = 0;
    let mut flash = 0;
    for line in out.lines() {
        let columns: Vec<_> = line.split_whitespace().collect();
        if columns.len() < 2 {
            continue;
        }
        let n = columns[1].parse::<u64>().unwrap_or(0);
        if [".data", ".bss", ".noinit"].contains(&columns[0]) {
            ram += n;
        }
        if [".text", ".data"].contains(&columns[0]) {
            flash += n;
        }
    }
    if flash == 0 || flash > 30720 {
        return Err("Сборка не помещается во Flash Nano".into());
    }
    if ram > 1536 {
        return Err(format!("Статические данные требуют {ram} из 2048 байт RAM Nano. Уменьшите схему: 512 байт оставляются для стека."));
    }
    Ok(())
}
pub fn upload_command(
    a: &ArduinoEnvironment,
    build: &idf::Build,
    port: &str,
) -> Result<Command, String> {
    let revision = fs::read_to_string(Path::new(&build.project_dir).join("fqbn.txt"))
        .map_err(|e| e.to_string())?;
    if ![fqbn("standard")?, fqbn("old")?].contains(&revision.as_str()) {
        return Err("Параметры загрузчика изменены после сборки".into());
    }
    let mut cmd = command(a);
    cmd.args([
        "upload",
        "--verify",
        "--fqbn",
        &revision,
        "--port",
        port,
        "--input-file",
        &build.binary,
    ]);
    Ok(cmd)
}
pub fn monitor_command(a: &ArduinoEnvironment, port: &str) -> Command {
    let mut cmd = command(a);
    cmd.args([
        "monitor",
        "--port",
        port,
        "--config",
        "baudrate=115200",
        "--raw",
        "--quiet",
    ]);
    cmd
}

// Official Arduino CLI 1.5.1 release archives. Core/tools are verified by CLI
// against the signed Arduino index; unsafe installs and post-install scripts stay off.
fn asset(os: &str, arch: &str) -> Result<(&'static str, &'static str, u64), String> {
    match (os, arch) {
        ("macos", "aarch64") => Ok((
            "arduino-cli_1.5.1_macOS_ARM64.tar.gz",
            "cb952e8c1621c95ef5f1d17831c945e3d0ec5973f89c557a7ec8feb9c4f7d4c9",
            17_370_016,
        )),
        ("macos", "x86_64") => Ok((
            "arduino-cli_1.5.1_macOS_64bit.tar.gz",
            "c982e940027996bea9901050e95fae99c59c1dcfee54beedecaf28141e7bf2e7",
            19_355_892,
        )),
        ("windows", "x86_64") => Ok((
            "arduino-cli_1.5.1_Windows_64bit.zip",
            "fabe42e0eb04d00e776a66178299ff95a46c623dbc260f997e58fd514853dd40",
            17_965_819,
        )),
        _ => Err("Автоматическая установка Arduino пока доступна для macOS и Windows x64".into()),
    }
}
pub fn install_plan() -> Result<crate::sdk_installer::InstallPlan, String> {
    let (_, _, cli) = asset(std::env::consts::OS, std::env::consts::ARCH)?;
    let tools = if cfg!(windows) {
        52_519_412 + 2_768_948 + 328_460
    } else {
        36_684_546 + 2_766_116 + 279_045
    };
    let total = cli + 7_127_080 + tools;
    Ok(crate::sdk_installer::InstallPlan {
        tool_bytes: total,
        estimated_min: total,
        estimated_max: total + 20 * 1024 * 1024,
    })
}
fn no_link(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err("Папка инструментов является ссылкой".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("Папка инструментов является reparse point".into());
        }
    }
    Ok(())
}
fn claim(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root.parent().ok_or("Нет родительской папки")?)
        .map_err(|e| e.to_string())?;
    no_link(root.parent().unwrap())?;
    let marker = serde_json::json!({"family":"arduino-avr","version":VERSION,"format":1});
    if root.exists() {
        no_link(root)?;
        let old: serde_json::Value = serde_json::from_slice(
            &fs::read(root.join(".clex-sdk.json"))
                .map_err(|_| "Папка уже существует и не принадлежит CLEX Flow")?,
        )
        .map_err(|e| e.to_string())?;
        if old != marker {
            return Err("Папка Arduino принадлежит другой установке".into());
        }
    } else {
        fs::create_dir(root).map_err(|e| e.to_string())?;
        write_json(&root.join(".clex-sdk.json"), &marker)?;
    }
    Ok(())
}
pub fn install(
    app: &tauri::AppHandle,
    inner: &Arc<idf::Inner>,
    id: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    if let Some(env) = install_at(
        &managed_slot(app)?,
        cancel,
        |message| crate::tooling::stage(app, inner, id, message),
        |cmd| idf::execute(app, inner, id, "sdk_install", cmd, cancel),
        |done, total| idf::publish_download(app, inner, id, done, total),
    )? {
        write_json(&settings(app)?, env.arduino.as_ref().unwrap())?;
    }
    Ok(())
}
fn install_at(
    slot: &Path,
    cancel: &Arc<AtomicBool>,
    mut stage: impl FnMut(&str),
    mut run: impl FnMut(Command) -> Result<bool, String>,
    progress: impl FnMut(u64, Option<u64>),
) -> Result<Option<Environment>, String> {
    use std::sync::atomic::Ordering;
    claim(&slot)?;
    if crate::sdk_installer::free_bytes(&slot)? < 1024 * 1024 * 1024 {
        return Err("Для Arduino AVR требуется минимум 1 ГиБ свободного места".into());
    }
    let (name, checksum, size) = asset(std::env::consts::OS, std::env::consts::ARCH)?;
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() > 5
                || a.url().scheme() != "https"
                || !matches!(
                    a.url().host_str(),
                    Some(
                        "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
            {
                a.error("Недопустимое перенаправление Arduino CLI")
            } else {
                a.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    stage("Загрузка Arduino CLI 1.5.1");
    let response = client
        .get(format!(
            "https://github.com/arduino/arduino-cli/releases/download/v1.5.1/{name}"
        ))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    let archive = slot.join(name);
    let mut temp = tempfile::NamedTempFile::new_in(&slot).map_err(|e| e.to_string())?;
    crate::sdk_installer::copy_verified(
        response,
        temp.as_file_mut(),
        checksum,
        Some(size),
        cancel,
        progress,
    )?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(&archive).map_err(|e| e.to_string())?;
    if cancel.load(Ordering::SeqCst) {
        return Ok(None);
    }
    let tar = if cfg!(windows) {
        PathBuf::from(std::env::var_os("SystemRoot").ok_or("Не найден SystemRoot")?)
            .join("System32/tar.exe")
    } else {
        PathBuf::from("/usr/bin/tar")
    };
    let mut extract = Command::new(tar);
    extract
        .arg("-xf")
        .arg(&archive)
        .arg("-C")
        .arg(&slot)
        .arg(exe("arduino-cli"))
        .arg("LICENSE.txt");
    if !run(extract)? {
        return Ok(None);
    }
    no_link(&slot.join(exe("arduino-cli")))?;
    let a = config(
        &slot.join(exe("arduino-cli")),
        &slot.join("data"),
        &slot.join("workspace"),
    )?;
    for args in [
        vec!["core", "update-index"],
        vec![
            "core",
            "install",
            "arduino:avr@1.8.6",
            "--skip-post-install",
            "--skip-pre-uninstall",
            "--no-overwrite",
        ],
    ] {
        stage("Подготовка Arduino AVR Boards 1.8.6 и AVRDUDE");
        let mut cmd = command(&a);
        cmd.args(args);
        if !run(cmd)? {
            return Ok(None);
        }
    }
    if cancel.load(Ordering::SeqCst) {
        return Ok(None);
    }
    let env = inspect(
        Path::new(&a.cli),
        Path::new(&a.data),
        &slot.join("workspace"),
        true,
    )?;
    let check = slot.join("smoke");
    fs::create_dir_all(check.join("clex_flow/src")).map_err(|e| e.to_string())?;
    fs::write(
        check.join("clex_flow/clex_flow.ino"),
        "// CLEX Flow toolchain check\n",
    )
    .map_err(|e| e.to_string())?;
    fs::write(check.join("clex_flow/src/flow.cpp"),"#include <Arduino.h>\nvoid setup(){Serial.begin(115200);pinMode(13,OUTPUT);}\nvoid loop(){digitalWrite(13,!digitalRead(13));delay(1000);}\n").map_err(|e|e.to_string())?;
    stage("Проверочная компиляция Nano");
    if !run(build_command(
        env.arduino.as_ref().unwrap(),
        &check,
        "standard",
    )?)? {
        return Ok(None);
    }
    verify_memory(env.arduino.as_ref().unwrap(), &check)?;
    Ok(if cancel.load(Ordering::SeqCst) {
        None
    } else {
        Some(env)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn official_assets_are_pinned_for_supported_hosts() {
        for (os, arch) in [
            ("windows", "x86_64"),
            ("macos", "aarch64"),
            ("macos", "x86_64"),
        ] {
            let (name, sha, size) = asset(os, arch).unwrap();
            assert!(name.contains("1.5.1"));
            assert_eq!(sha.len(), 64);
            assert!(sha.bytes().all(|b| b.is_ascii_hexdigit()));
            assert!(size > 10_000_000);
        }
        assert!(asset("linux", "arm").is_err());
    }
    #[test]
    fn fqbn_is_fixed_and_owned_slot_never_claims_existing_tools() {
        assert!(fqbn("standard").unwrap().ends_with("=atmega328"));
        assert!(fqbn("old").unwrap().ends_with("=atmega328old"));
        assert!(fqbn("../../").is_err());
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("Arduino15");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("keep"), b"external").unwrap();
        assert!(claim(&root).is_err());
        assert_eq!(fs::read(root.join("keep")).unwrap(), b"external");
        let own = t.path().join("avr/v1.8.6");
        claim(&own).unwrap();
        claim(&own).unwrap();
    }
    #[test]
    fn cli_commands_keep_paths_as_arguments_and_verify_uploads() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("Arduino данные");
        let env = config(
            Path::new("X:\\Tools with spaces\\arduino-cli.exe"),
            &data,
            &dir.path().join("workspace"),
        )
        .unwrap();
        let cmd = build_command(&env, dir.path(), "old").unwrap();
        let args: Vec<_> = cmd
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert!(args.contains(&"arduino:avr:nano:cpu=atmega328old".into()));
        assert!(args.contains(&dir.path().join("clex_flow").to_string_lossy().into_owned()));
        let contents: serde_json::Value =
            serde_json::from_slice(&fs::read(&env.config).unwrap()).unwrap();
        assert_eq!(contents["directories"]["data"], text(&data));
        assert_eq!(contents["board_manager"]["enable_unsafe_install"], false);
    }
    #[test]
    #[ignore = "Uses explicitly supplied existing Arduino tools without downloading or flashing"]
    fn compile_generated_nano_projects() {
        let cli = PathBuf::from(std::env::var("CLEX_TEST_ARDUINO_CLI").unwrap());
        let data = PathBuf::from(std::env::var("CLEX_TEST_ARDUINO_DATA").unwrap());
        let root = PathBuf::from(std::env::var("CLEX_TEST_ARDUINO_PROJECTS").unwrap());
        let env = inspect(&cli, &data, &root.join("native-workspace"), false).unwrap();
        let a = env.arduino.as_ref().unwrap();
        let inner = Arc::new(idf::Inner::default());
        let cancel = Arc::new(AtomicBool::new(false));
        for name in ["counter", "blink", "watch", "old"] {
            let value = fs::read_to_string(root.join(name).join("spec.json")).unwrap();
            let spec: idf::Specification = serde_json::from_str(&value).unwrap();
            let dir = root.join("native").join(name);
            write_project(&dir, &spec).unwrap();
            let cmd = build_command(a, &dir, spec.board_revision.as_deref().unwrap()).unwrap();
            assert!(idf::execute_process(
                &inner,
                "build",
                cmd,
                &cancel,
                Arc::new(|_, _, text| println!("{text}"))
            )
            .unwrap());
            verify_memory(a, &dir).unwrap();
            println!("Native Nano compilation passed: {name}");
        }
    }
    #[test]
    #[ignore = "Explicitly authorized network download into an isolated test directory"]
    fn install_fresh_arduino_toolchain() {
        assert_eq!(
            std::env::var("CLEX_TEST_ARDUINO_DOWNLOAD").as_deref(),
            Ok("1")
        );
        let root = PathBuf::from(std::env::var("CLEX_TEST_ARDUINO_SLOT").unwrap());
        assert!(root.is_absolute());
        assert!(!root.exists(), "Test must start in a new folder");
        let inner = Arc::new(idf::Inner::default());
        let cancel = Arc::new(AtomicBool::new(false));
        let worker = inner.clone();
        let control = cancel.clone();
        let env = install_at(
            &root,
            &cancel,
            |s| println!("{s}"),
            move |cmd| {
                idf::execute_process(
                    &worker,
                    "sdk_install",
                    cmd,
                    &control,
                    Arc::new(|_, _, text| print!("{text}")),
                )
            },
            |_, _| {},
        )
        .unwrap()
        .unwrap();
        assert_eq!(env.target, TARGET);
        assert_eq!(env.sdk_version, VERSION);
        assert!(env.arduino.as_ref().unwrap().managed);
        verify_memory(env.arduino.as_ref().unwrap(), &root.join("smoke")).unwrap();
        write_json(&root.join("test-environment.json"), &env).unwrap();
        println!("Fresh install verified: {}", env.version);
    }
}
