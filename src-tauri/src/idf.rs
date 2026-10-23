use crate::idf_environment::{self, Environment, Port};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct Service(pub Arc<Inner>);
#[derive(Default)]
pub struct Inner {
    pub(crate) environment: Mutex<Option<Environment>>,
    pub(crate) sdk_gate: Mutex<()>,
    active: Mutex<Option<Active>>,
    builds: Mutex<HashMap<String, Build>>,
    events: Mutex<VecDeque<Event>>,
    sequence: AtomicU64,
}
struct Active {
    id: String,
    cancel: Arc<AtomicBool>,
    pid: u32,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Build {
    pub id: String,
    pub fingerprint: String,
    pub project_dir: String,
    pub binary: String,
    pub environment_root: String,
    pub environment_identity: String,
    pub target: String,
    hashes: Vec<(String, String)>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub job_id: String,
    pub sequence: u64,
    pub operation: String,
    pub status: String,
    pub stream: String,
    pub text: String,
    pub build: Option<Build>,
    pub downloaded: Option<u64>,
    pub total: Option<u64>,
    pub progress_key: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Specification {
    pub board_id: String,
    #[serde(default)]
    pub board_revision: Option<String>,
    #[serde(default)]
    pub feature_runtimes: Vec<String>,
    pub console_mode: String,
    pub main_c: String,
    pub fingerprint: String,
    pub graphics_runtime: Option<String>,
    pub network_runtime: Option<String>,
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn id_valid(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, byte)| {
            if [8, 13, 18, 23].contains(&i) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}
pub(crate) fn publish(
    app: &tauri::AppHandle,
    inner: &Inner,
    id: &str,
    operation: &str,
    status: &str,
    stream: &str,
    text: &str,
    build: Option<Build>,
) {
    let progress = if operation == "build" && status == "output" {
        let parsed = crate::component_progress::parse(text);
        if crate::component_progress::is_message(text) && parsed.is_none() {
            return;
        }
        parsed
    } else {
        None
    };
    let event = Event {
        job_id: id.into(),
        sequence: inner.sequence.fetch_add(1, Ordering::SeqCst),
        operation: operation.into(),
        status: if progress.is_some() {
            "progress"
        } else {
            status
        }
        .into(),
        stream: if progress.is_some() { "system" } else { stream }.into(),
        text: progress
            .as_ref()
            .map(|p| p.text.as_str())
            .unwrap_or(text)
            .chars()
            .take(8192)
            .collect(),
        build,
        downloaded: progress.as_ref().and_then(|p| p.downloaded),
        total: progress.as_ref().and_then(|p| p.total),
        progress_key: progress.map(|p| p.key),
    };
    remember_event(inner, &event);
    let _ = app.emit("idf-event", event);
}
fn remember_event(inner: &Inner, event: &Event) {
    if let Ok(mut events) = inner.events.lock() {
        if let Some(key) = &event.progress_key {
            if let Some(index) = events.iter().position(|previous| {
                previous.job_id == event.job_id
                    && previous.operation == event.operation
                    && previous.progress_key.as_ref() == Some(key)
            }) {
                events.remove(index);
            }
        }
        if events.len() >= 1500 {
            events.pop_front();
        }
        events.push_back(event.clone());
    }
}
fn command(environment: &Environment) -> Command {
    let mut command = Command::new(&environment.python);
    command.envs(&environment.variables);
    command
}
fn sdk_command(environment: &Environment) -> Command {
    let mut cmd = command(environment);
    cmd.arg(PathBuf::from(&environment.root).join("tools/idf.py"));
    cmd
}
fn write_source(path: &PathBuf, contents: &str) -> Result<(), String> {
    if fs::read_to_string(path).ok().as_deref() != Some(contents) {
        fs::write(path, contents).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn prepare(
    app: &tauri::AppHandle,
    environment: &Environment,
    spec: &Specification,
) -> Result<PathBuf, String> {
    if crate::boards::profile(&spec.board_id).is_err()
        || !["usb", "uart"].contains(&spec.console_mode.as_str())
        || spec.main_c.len() > 2 * 1024 * 1024
    {
        return Err("Некорректные параметры прошивки".into());
    }
    verify_specification(spec)?;
    let env_hash = hash(environment.root.as_bytes());
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("firmware")
        .join(format!("{}-{}", spec.fingerprint, &env_hash[..12]));
    write_project(&dir, spec)?;
    Ok(dir)
}
fn verify_specification(spec: &Specification) -> Result<(), String> {
    if spec
        .graphics_runtime
        .as_deref()
        .is_some_and(|runtime| runtime != "lvgl-9.2.2")
    {
        return Err("Неизвестная графическая библиотека".into());
    }
    if spec
        .network_runtime
        .as_deref()
        .is_some_and(|runtime| runtime != "esp-idf-network-1")
    {
        return Err("Неизвестная сетевая библиотека".into());
    }
    let board = crate::boards::profile(&spec.board_id)?;
    if !board["firmware"]["consoleModes"]
        .as_array()
        .is_some_and(|modes| modes.iter().any(|mode| mode == &spec.console_mode))
    {
        return Err("Режим консоли недоступен на этой плате".into());
    }
    if board["platform"] == "arduino-avr" {
        crate::arduino::fqbn(
            spec.board_revision
                .as_deref()
                .ok_or("Выберите загрузчик Nano")?,
        )?;
        if spec.graphics_runtime.is_some()
            || spec.network_runtime.is_some()
            || !spec.feature_runtimes.is_empty()
        {
            return Err("Драйверы ESP-IDF несовместимы с Arduino AVR".into());
        }
    } else if board["firmware"]["revisionConfigs"].is_object() {
        if !spec
            .board_revision
            .as_deref()
            .is_some_and(|revision| board["firmware"]["revisionConfigs"][revision].is_string())
        {
            return Err("Выберите ревизию микроконтроллера".into());
        }
    } else if spec.board_revision.is_some() {
        return Err("Неизвестная настройка ревизии платы".into());
    }
    let profiles: serde_json::Value =
        serde_json::from_str(include_str!("../../src/firmware/runtime-profiles.json"))
            .map_err(|e| e.to_string())?;
    let mut seen = std::collections::HashSet::new();
    for feature in &spec.feature_runtimes {
        if !seen.insert(feature) || profiles[feature]["target"] != board["target"] {
            return Err("Неизвестный или несовместимый профиль драйвера".into());
        }
    }
    let mut identity = vec![
        serde_json::json!(spec.board_id),
        serde_json::json!(spec.console_mode),
        serde_json::json!(spec.main_c),
    ];
    if let Some(runtime) = &spec.graphics_runtime {
        identity.push(serde_json::json!(runtime));
    }
    if let Some(runtime) = &spec.network_runtime {
        identity.push(serde_json::json!(runtime));
    }
    if let Some(revision) = &spec.board_revision {
        identity.push(serde_json::json!(revision));
    }
    if !spec.feature_runtimes.is_empty() {
        identity.push(serde_json::json!(spec.feature_runtimes));
    }
    let bytes = serde_json::to_vec(&identity).map_err(|e| e.to_string())?;
    if hash(&bytes) != spec.fingerprint {
        return Err("Контрольная сумма исходников не совпадает".into());
    }
    Ok(())
}
fn write_project(dir: &PathBuf, spec: &Specification) -> Result<(), String> {
    verify_specification(spec)?;
    if crate::boards::profile(&spec.board_id)?["platform"] == "arduino-avr" {
        return crate::arduino::write_project(dir, spec);
    }
    fs::create_dir_all(dir.join("main")).map_err(|e| e.to_string())?;
    let runtime_profiles: serde_json::Value =
        serde_json::from_str(include_str!("../../src/firmware/runtime-profiles.json"))
            .map_err(|e| e.to_string())?;
    let packages: serde_json::Value =
        serde_json::from_str(include_str!("../../src/firmware/component-files.json"))
            .map_err(|e| e.to_string())?;
    let mut component_names = std::collections::BTreeSet::new();
    for feature in &spec.feature_runtimes {
        if let Some(components) = runtime_profiles[feature]["components"].as_array() {
            for name in components {
                component_names.insert(name.as_str().ok_or("Некорректный компонент драйвера")?);
            }
        }
    }
    for name in component_names {
        for (relative, source) in packages[name]["files"]
            .as_object()
            .ok_or("Нет исходников компонента драйвера")?
        {
            let prefix = format!("components/{name}/");
            if !relative.starts_with(&prefix)
                || relative
                    .split('/')
                    .any(|part| part == ".." || part.is_empty())
                || relative.contains('\\')
            {
                return Err("Некорректный путь компонента драйвера".into());
            }
            let path = dir.join(relative);
            fs::create_dir_all(path.parent().ok_or("Нет каталога компонента")?)
                .map_err(|e| e.to_string())?;
            write_source(
                &path,
                source.as_str().ok_or("Некорректные исходники компонента")?,
            )?;
        }
    }
    let cmake_prelude: String = spec
        .feature_runtimes
        .iter()
        .filter_map(|feature| runtime_profiles[feature]["cmakePrelude"].as_str())
        .collect();
    write_source(&dir.join("CMakeLists.txt"),&format!("cmake_minimum_required(VERSION 3.16)\nset(COMPONENTS main)\n{cmake_prelude}include($ENV{{IDF_PATH}}/tools/cmake/project.cmake)\nproject(clex_flow_firmware)\n"))?;
    let dependencies = if spec.network_runtime.is_some() {
        if spec.graphics_runtime.is_some() {
            "esp_driver_gpio esp_timer freertos log esp_lcd esp_driver_spi lvgl__lvgl esp_eth esp_netif esp_event esp_http_client mbedtls lwip esp_hw_support"
        } else {
            "esp_driver_gpio esp_timer freertos log esp_driver_spi esp_eth esp_netif esp_event esp_http_client mbedtls lwip esp_hw_support"
        }
    } else if spec.graphics_runtime.is_some() {
        "esp_driver_gpio esp_timer freertos log esp_lcd esp_driver_spi lvgl__lvgl"
    } else {
        "esp_driver_gpio esp_timer freertos log"
    };
    let profiles: serde_json::Value =
        serde_json::from_str(include_str!("../../src/firmware/runtime-profiles.json"))
            .map_err(|e| e.to_string())?;
    let mut requirements: Vec<String> = dependencies
        .split_whitespace()
        .map(str::to_string)
        .collect();
    for feature in &spec.feature_runtimes {
        for item in profiles[feature]["requires"]
            .as_array()
            .ok_or("Нет зависимостей драйвера")?
        {
            let item = item.as_str().ok_or("Неизвестная зависимость")?.to_string();
            if !requirements.contains(&item) {
                requirements.push(item);
            }
        }
    }
    let dependencies = requirements.join(" ");
    let mut font_sources = String::new();
    if spec.graphics_runtime.is_some() {
        let fonts: serde_json::Value =
            serde_json::from_str(include_str!("../../src/displays/fonts/lvgl-fonts.json"))
                .map_err(|e| e.to_string())?;
        for font in fonts
            .as_object()
            .ok_or("Некорректный пакет шрифтов")?
            .values()
        {
            let symbol = font["symbol"].as_str().ok_or("Нет имени шрифта")?;
            let source = font["source"].as_str().ok_or("Нет исходников шрифта")?;
            write_source(&dir.join(format!("main/{symbol}.c")), source)?;
            font_sources.push_str(&format!(" \"{symbol}.c\""));
        }
    }
    write_source(
        &dir.join("main/CMakeLists.txt"),
        &format!(
            "idf_component_register(SRCS \"main.c\"{font_sources} INCLUDE_DIRS \".\" REQUIRES {dependencies})\n"
        ),
    )?;
    if spec.graphics_runtime.is_some() {
        write_source(
            &dir.join("main/idf_component.yml"),
            "dependencies:\n  lvgl/lvgl: \"=9.2.2\"\n",
        )?;
    }
    if !spec.feature_runtimes.is_empty() {
        let path = dir.join("main/idf_component.yml");
        let mut manifest = if spec.graphics_runtime.is_some() {
            "dependencies:\n  lvgl/lvgl: \"=9.2.2\"\n".to_string()
        } else {
            "dependencies:\n".to_string()
        };
        let mut managed = std::collections::HashSet::new();
        for feature in &spec.feature_runtimes {
            for (name, version) in profiles[feature]["dependencies"]
                .as_object()
                .ok_or("Нет пакетов драйвера")?
            {
                if managed.insert(name) {
                    manifest.push_str(&format!(
                        "  {name}: \"={}\"\n",
                        version.as_str().ok_or("Нет версии пакета")?
                    ));
                }
            }
        }
        if !managed.is_empty() {
            write_source(&path, &manifest)?;
        }
    }
    write_source(&dir.join("main/main.c"), &spec.main_c)?;
    let board = crate::boards::profile(&spec.board_id)?;
    let size = board["firmware"]["flashSizeMb"]
        .as_u64()
        .ok_or("Нет размера Flash")?;
    let target = board["target"].as_str().ok_or("Нет цели платы")?;
    let console = if spec.console_mode == "usb" {
        "USB_SERIAL_JTAG"
    } else {
        "UART_DEFAULT"
    };
    write_source(&dir.join("sdkconfig.defaults"),&format!("CONFIG_IDF_TARGET=\"{target}\"\nCONFIG_ESPTOOLPY_FLASHSIZE_{size}MB=y\nCONFIG_ESPTOOLPY_FLASHMODE_DIO=y\nCONFIG_FREERTOS_HZ=1000\nCONFIG_LOG_COLORS=n\nCONFIG_ESP_CONSOLE_{console}=y\nCONFIG_ESP_CONSOLE_SECONDARY_NONE=y\n"))?;
    if let Some(revision) = &spec.board_revision {
        let path = dir.join("sdkconfig.defaults");
        let mut contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        contents.push_str(
            board["firmware"]["revisionConfigs"][revision]
                .as_str()
                .ok_or("Нет настроек ревизии")?,
        );
        write_source(&path, &contents)?;
    }
    if spec.graphics_runtime.is_some() {
        let path = dir.join("sdkconfig.defaults");
        let mut contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        contents.push_str("CONFIG_LV_COLOR_DEPTH_16=y\nCONFIG_LV_FONT_MONTSERRAT_14=y\nCONFIG_LV_FONT_MONTSERRAT_20=y\nCONFIG_LV_FONT_MONTSERRAT_28=y\n");
        write_source(&path, &contents)?;
    }
    if spec.network_runtime.is_some() {
        let path = dir.join("sdkconfig.defaults");
        let mut contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        contents.push_str(
            if board["networkInterfaces"]
                .as_array()
                .is_some_and(|interfaces| {
                    interfaces
                        .iter()
                        .any(|interface| interface["interface"] == "rmii")
                })
            {
                "CONFIG_ETH_USE_ESP32_EMAC=y\n"
            } else {
                "CONFIG_ETH_USE_SPI_ETHERNET=y\nCONFIG_ETH_SPI_ETHERNET_W5500=y\n"
            },
        );
        contents.push_str("CONFIG_MBEDTLS_CERTIFICATE_BUNDLE=y\nCONFIG_MBEDTLS_CERTIFICATE_BUNDLE_DEFAULT_FULL=y\nCONFIG_ESP_NETIF_IP_LOST_TIMER_INTERVAL=1\nCONFIG_PARTITION_TABLE_CUSTOM=y\nCONFIG_PARTITION_TABLE_CUSTOM_FILENAME=\"partitions.csv\"\n");
        write_source(&path, &contents)?;
        write_source(&dir.join("partitions.csv"), "nvs,data,nvs,0x9000,0x6000\nphy_init,data,phy,0xf000,0x1000\nfactory,app,factory,0x10000,0x300000\n")?;
    }
    if spec.network_runtime.is_none()
        && spec
            .feature_runtimes
            .iter()
            .any(|feature| feature == "espnow-s3")
    {
        write_source(&dir.join("partitions.csv"),"nvs,data,nvs,0x9000,0x6000\nphy_init,data,phy,0xf000,0x1000\nfactory,app,factory,0x10000,0x300000\n")?;
    }
    if !spec.feature_runtimes.is_empty() {
        let path = dir.join("sdkconfig.defaults");
        let mut contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let mut lines = Vec::new();
        for feature in &spec.feature_runtimes {
            for line in profiles[feature]["config"]
                .as_str()
                .ok_or("Нет настроек драйвера")?
                .lines()
            {
                if !lines.contains(&line) {
                    lines.push(line);
                }
            }
        }
        contents.push_str(&lines.join("\n"));
        contents.push('\n');
        if spec
            .feature_runtimes
            .iter()
            .any(|feature| feature == "wifi-hosted-p4")
        {
            contents.push_str(
                board["wifi"]["config"]
                    .as_str()
                    .ok_or("Нет настроек Wi-Fi адаптера платы")?,
            );
        }
        write_source(&path, &contents)?;
    }
    for feature in &spec.feature_runtimes {
        if let Some(partitions) = profiles[feature]["partitions"].as_str() {
            write_source(&dir.join("partitions.csv"), partitions)?;
        }
    }
    Ok(())
}
#[cfg(unix)]
pub(crate) fn stop_group(pid: u32) {
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
    thread::sleep(Duration::from_millis(200));
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}
#[cfg(windows)]
pub(crate) fn stop_group(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}
pub fn shutdown(service: &Service) {
    if let Ok(active) = service.0.active.lock() {
        if let Some(active) = active.as_ref() {
            active.cancel.store(true, Ordering::SeqCst);
            if active.pid != 0 {
                stop_group(active.pid);
            }
        }
    }
}
// Preserve incomplete UTF-8 between reads and emit serial bytes without waiting for a newline.
pub(crate) fn serial_chunks(
    mut pipe: impl Read,
    mut emit: impl FnMut(&str),
) -> std::io::Result<()> {
    let mut pending = Vec::new();
    let mut buffer = [0u8; 2048];
    loop {
        let count = pipe.read(&mut buffer)?;
        if count == 0 {
            if !pending.is_empty() {
                emit(&String::from_utf8_lossy(&pending));
            }
            break;
        }
        pending.extend_from_slice(&buffer[..count]);
        loop {
            match std::str::from_utf8(&pending) {
                Ok(text) => {
                    emit(text);
                    pending.clear();
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    if valid > 0 {
                        emit(std::str::from_utf8(&pending[..valid]).unwrap());
                        pending.drain(..valid);
                    }
                    if let Some(len) = error.error_len() {
                        emit("�");
                        pending.drain(..len);
                    } else {
                        break;
                    }
                }
            }
        }
    }
    Ok(())
}
pub(crate) fn execute(
    app: &tauri::AppHandle,
    inner: &Arc<Inner>,
    id: &str,
    operation: &str,
    cmd: Command,
    cancel: &Arc<AtomicBool>,
) -> Result<bool, String> {
    let app = app.clone();
    let event_inner = inner.clone();
    let event_id = id.to_string();
    let op = operation.to_string();
    let emit = Arc::new(move |status: &str, stream: &str, text: &str| {
        publish(
            &app,
            &event_inner,
            &event_id,
            &op,
            status,
            stream,
            text,
            None,
        )
    });
    execute_process(inner, operation, cmd, cancel, emit)
}
type ProcessOutput = Arc<dyn Fn(&str, &str, &str) + Send + Sync>;
pub(crate) fn execute_process(
    inner: &Arc<Inner>,
    operation: &str,
    mut cmd: Command,
    cancel: &Arc<AtomicBool>,
    emit: ProcessOutput,
) -> Result<bool, String> {
    if cancel.load(Ordering::SeqCst) {
        return Ok(false);
    }
    // Arduino CLI closes its monitor on stdin EOF; keep the pipe open for the job lifetime.
    cmd.stdin(if operation == "monitor" {
        Stdio::piped()
    } else {
        Stdio::null()
    })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Не удалось запустить процесс: {e}"))?;
    let pid = child.id();
    if let Ok(mut active) = inner.active.lock() {
        if let Some(active) = active.as_mut() {
            active.pid = pid;
        }
    }
    let mut readers = Vec::new();
    for (stream, pipe) in [
        (
            "stdout",
            child
                .stdout
                .take()
                .map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
        ),
        (
            "stderr",
            child
                .stderr
                .take()
                .map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
        ),
    ] {
        if let Some(pipe) = pipe {
            let emit = emit.clone();
            let op = operation.to_string();
            readers.push(thread::spawn(move || {
                if (op == "monitor" && stream == "stdout") || op.starts_with("sdk_") {
                    let _ = serial_chunks(pipe, |text| emit("output", stream, text));
                } else {
                    let mut reader = BufReader::new(pipe);
                    let mut bytes = Vec::new();
                    loop {
                        bytes.clear();
                        match reader.read_until(b'\n', &mut bytes) {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {
                                let text = String::from_utf8_lossy(&bytes).trim_end().to_string();
                                if op == "monitor"
                                    && stream == "stderr"
                                    && text == "__CLEX_MONITOR_READY__"
                                {
                                    emit("connected", stream, "Последовательный порт открыт");
                                } else {
                                    emit("output", stream, &text);
                                }
                            }
                        }
                    }
                }
            }));
        }
    }
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if cancel.load(Ordering::SeqCst) {
            stop_group(pid);
            let _ = child.kill();
            break child.wait().map_err(|e| e.to_string())?;
        }
        thread::sleep(Duration::from_millis(40));
    };
    for reader in readers {
        let _ = reader.join();
    }
    if let Ok(mut active) = inner.active.lock() {
        if let Some(active) = active.as_mut() {
            active.pid = 0;
        }
    }
    if cancel.load(Ordering::SeqCst) {
        return Ok(false);
    }
    if !status.success() {
        return Err(format!(
            "Процесс завершился с кодом {}. Подробности в журнале.",
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "signal".into())
        ));
    }
    Ok(true)
}
pub(crate) fn reserve(inner: &Arc<Inner>, id: &str) -> Result<Arc<AtomicBool>, String> {
    if !id_valid(id) {
        return Err("Некорректный ID операции".into());
    }
    let mut active = inner.active.lock().map_err(|e| e.to_string())?;
    if active.is_some() {
        return Err("Другая операция уже выполняется".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *active = Some(Active {
        id: id.into(),
        cancel: cancel.clone(),
        pid: 0,
    });
    Ok(cancel)
}
pub(crate) fn finish(
    app: &tauri::AppHandle,
    inner: &Arc<Inner>,
    id: &str,
    operation: &str,
    result: Result<Option<Build>, String>,
    cancel: &Arc<AtomicBool>,
) {
    if let Ok(mut active) = inner.active.lock() {
        *active = None;
    }
    match result {
        Ok(build) => publish(
            app,
            inner,
            id,
            operation,
            if cancel.load(Ordering::SeqCst) {
                "cancelled"
            } else {
                "success"
            },
            "system",
            if cancel.load(Ordering::SeqCst) {
                "Операция остановлена"
            } else {
                "Операция завершена"
            },
            build,
        ),
        Err(error) => publish(app, inner, id, operation, "failed", "system", &error, None),
    }
}
fn env_from(state: &Service) -> Result<Environment, String> {
    state
        .0
        .environment
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Сначала проверьте инструменты в настройках".into())
}
#[tauri::command]
pub async fn idf_environment(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    root: Option<String>,
    python: Option<String>,
    tools_path: Option<String>,
    target: Option<String>,
) -> Result<Environment, String> {
    let inner = state.0.clone();
    if inner.active.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Нельзя менять среду во время операции".into());
    }
    let target = crate::boards::target(target)?;
    let lease = reserve(&inner, "00000000-0000-4000-8000-000000000001")?;
    let check_inner = inner.clone();
    let check_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        if target == crate::arduino::TARGET {
            crate::arduino::auto_environment(&check_app, root, tools_path)
        } else {
            crate::sdk::auto_environment(
                &check_app,
                &check_inner,
                root,
                python,
                tools_path,
                &target,
            )
        }
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|result| result);
    drop(lease);
    match &result {
        Ok(environment) => {
            *inner.environment.lock().map_err(|e| e.to_string())? = Some(environment.clone());
        }
        Err(_) => {
            *inner.environment.lock().map_err(|e| e.to_string())? = None;
        }
    }
    release(&inner, "00000000-0000-4000-8000-000000000001");
    let environment = result?;
    Ok(environment)
}
#[tauri::command]
pub async fn idf_ports(state: tauri::State<'_, Service>) -> Result<Vec<Port>, String> {
    let environment = env_from(&state)?;
    tauri::async_runtime::spawn_blocking(move || idf_environment::ports(&environment))
        .await
        .map_err(|e| e.to_string())?
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceMac {
    mac: String,
    port: String,
}
fn mac_read_command(environment: &Environment, port: &str) -> Result<Command, String> {
    if !["esp32", "esp32s3"].contains(&environment.target.as_str()) || environment.arduino.is_some()
    {
        return Err("Чтение MAC ESP-NOW доступно для ESP32 и ESP32-S3".into());
    }
    let mut cmd = command(environment);
    cmd.args([
        "-m",
        "esptool",
        "--chip",
        &environment.target,
        "--port",
        port,
        "--baud",
        "115200",
        "--no-stub",
        "--connect-attempts",
        "3",
        "read_mac",
    ]);
    Ok(cmd)
}
fn parse_device_mac(output: &str) -> Result<String, String> {
    let mut found = None;
    for line in output.lines() {
        let Some(value) = line.trim().strip_prefix("MAC:") else {
            continue;
        };
        let value = value.trim();
        let octets = value.split(':').collect::<Vec<_>>();
        if octets.len() != 6
            || octets
                .iter()
                .any(|part| part.len() != 2 || !part.bytes().all(|byte| byte.is_ascii_hexdigit()))
        {
            return Err("Плата вернула некорректный MAC-адрес".into());
        }
        let bytes = octets
            .iter()
            .map(|part| u8::from_str_radix(part, 16).unwrap())
            .collect::<Vec<_>>();
        if bytes[0] & 1 != 0 || bytes.iter().all(|byte| *byte == 0) {
            return Err("Плата вернула некорректный MAC-адрес".into());
        }
        let mac = value.to_ascii_uppercase();
        if found.as_ref().is_some_and(|previous| previous != &mac) {
            return Err("Получены разные MAC-адреса. Повторите чтение выбранной платы".into());
        }
        found = Some(mac);
    }
    found.ok_or("Не удалось прочитать MAC-адрес платы".into())
}
#[tauri::command]
pub async fn idf_read_mac(
    state: tauri::State<'_, Service>,
    port: String,
) -> Result<DeviceMac, String> {
    let inner = state.0.clone();
    let operation = "00000000-0000-4000-8000-000000000002";
    let _lease = reserve(&inner, operation)?;
    let read_inner = inner.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let environment = env_from(&Service(read_inner))?;
        let cmd = mac_read_command(&environment, &port)?;
        validated_port(&environment, &port)?;
        let (output, _) = idf_environment::capture(cmd, Duration::from_secs(20))
            .map_err(|error| format!("Не удалось прочитать MAC. Проверьте USB-подключение и закройте другие программы, использующие порт.\n{error}"))?;
        Ok(DeviceMac { mac: parse_device_mac(&output)?, port })
    })
    .await
    .map_err(|error| error.to_string())
    .and_then(|result| result);
    release(&inner, operation);
    result
}
#[tauri::command]
pub fn idf_build(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    id: String,
    spec: Specification,
) -> Result<(), String> {
    let environment = env_from(&state)?;
    let board = crate::boards::profile(&spec.board_id)?;
    let target = board["target"]
        .as_str()
        .ok_or("Нет цели платы")?
        .to_string();
    let required = if board["platform"] == "arduino-avr" {
        &board["coreVersion"]
    } else {
        &board["espIdfVersion"]
    };
    if environment.sdk_version != required.as_str().unwrap_or("") || environment.target != target {
        return Err("Выберите и проверьте SDK и компилятор для выбранной платы".into());
    }
    let inner = state.0.clone();
    let cancel = reserve(&inner, &id)?;
    thread::spawn(move || {
        publish(
            &app,
            &inner,
            &id,
            "build",
            "running",
            "system",
            "Подготовка проекта прошивки",
            None,
        );
        let result = (|| {
            let dir = prepare(&app, &environment, &spec)?;
            let mut cmd = if let Some(a) = &environment.arduino {
                crate::arduino::build_command(
                    a,
                    &dir,
                    spec.board_revision.as_deref().ok_or("Выберите загрузчик")?,
                )?
            } else {
                sdk_command(&environment)
            };
            if spec.graphics_runtime.is_some() || !spec.feature_runtimes.is_empty() {
                cmd.env("IDF_COMPONENT_MANAGER", "1")
                    .env("IDF_COMPONENT_CACHE_PATH", dir.join("component-cache"));
                if environment.arduino.is_none() {
                    if crate::component_progress::configure(&mut cmd, &dir).is_err() {
                        publish(&app,&inner,&id,"build","output","system","Не удалось включить подробный прогресс загрузки. Продолжаем сборку со штатным журналом ESP-IDF.",None);
                    }
                }
            }
            if environment.arduino.is_none() {
                cmd.current_dir(&dir)
                    .args(["-D", &format!("IDF_TARGET={target}"), "build"]);
            }
            if !execute(&app, &inner, &id, "build", cmd, &cancel)? {
                return Ok(None);
            }
            if let Some(a) = &environment.arduino {
                crate::arduino::verify_memory(a, &dir)?;
            }
            let binary = if environment.arduino.is_some() {
                "build/clex_flow.ino.hex"
            } else {
                "build/clex_flow_firmware.bin"
            };
            let mut hashes = Vec::new();
            let artifacts: &[&str] = if environment.arduino.is_some() {
                &[
                    "build/clex_flow.ino.hex",
                    "build/clex_flow.ino.elf",
                    "fqbn.txt",
                    "clex_flow/src/flow.cpp",
                ]
            } else {
                &[
                    "build/bootloader/bootloader.bin",
                    "build/partition_table/partition-table.bin",
                    "build/clex_flow_firmware.bin",
                    "build/flash_args",
                ]
            };
            for &path in artifacts {
                let file = dir.join(path);
                let bytes = fs::read(&file)
                    .map_err(|e| format!("Не найден результат сборки {path}: {e}"))?;
                hashes.push((path.into(), hash(&bytes)));
            }
            let build = Build {
                id: id.clone(),
                fingerprint: spec.fingerprint,
                project_dir: dir.to_string_lossy().to_string(),
                binary: dir.join(binary).to_string_lossy().to_string(),
                environment_root: environment.root.clone(),
                environment_identity: environment.identity.clone(),
                target: target.clone(),
                hashes,
            };
            inner
                .builds
                .lock()
                .map_err(|e| e.to_string())?
                .insert(id.clone(), build.clone());
            Ok(Some(build))
        })();
        finish(&app, &inner, &id, "build", result, &cancel);
    });
    Ok(())
}
// Reserve immediately, but keep all device discovery and file I/O off the UI thread.
fn spawn_device_job(
    inner: &Arc<Inner>,
    id: &str,
    work: impl FnOnce(Arc<AtomicBool>) + Send + 'static,
) -> Result<(), String> {
    let cancel = reserve(inner, id)?;
    thread::spawn(move || work(cancel));
    Ok(())
}
fn validated_port(environment: &Environment, path: &str) -> Result<(), String> {
    if !idf_environment::ports(environment)?
        .iter()
        .any(|port| port.path == path)
    {
        return Err("Выбранный USB/serial порт отсутствует или недоступен".into());
    }
    Ok(())
}
fn verify_build(build: &Build, fingerprint: &str, environment_root: &str) -> Result<(), String> {
    if build.fingerprint != fingerprint || build.environment_root != environment_root {
        return Err(
            "Прошивка устарела относительно схемы или среды. Выполните сборку заново.".into(),
        );
    }
    for (file, digest) in &build.hashes {
        if hash(&fs::read(PathBuf::from(&build.project_dir).join(file)).map_err(|e| e.to_string())?)
            != *digest
        {
            return Err("Файлы прошивки изменены после сборки".into());
        }
    }
    Ok(())
}
#[tauri::command]
pub fn idf_flash(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    id: String,
    build_id: String,
    fingerprint: String,
    port: String,
) -> Result<(), String> {
    let environment = env_from(&state)?;
    let build = state
        .0
        .builds
        .lock()
        .map_err(|e| e.to_string())?
        .get(&build_id)
        .cloned()
        .ok_or("Сначала выполните успешную сборку")?;
    let service = state.0.clone();
    let inner = service.clone();
    let operation_id = id.clone();
    spawn_device_job(&service, &operation_id, move |cancel| {
        publish(
            &app,
            &inner,
            &id,
            "flash",
            "running",
            "system",
            "Проверка порта и файлов прошивки",
            None,
        );
        let result = (|| {
            if cancel.load(Ordering::SeqCst) {
                return Ok(None);
            }
            validated_port(&environment, &port)?;
            if cancel.load(Ordering::SeqCst) {
                return Ok(None);
            }
            verify_build(&build, &fingerprint, &environment.root)?;
            if build.environment_identity != environment.identity {
                return Err("Окружение SDK изменилось; выполните новую сборку".into());
            }
            if cancel.load(Ordering::SeqCst) {
                return Ok(None);
            }
            publish(
                &app,
                &inner,
                &id,
                "flash",
                "running",
                "system",
                &format!("Прошивка выбранного порта {port}"),
                None,
            );
            let mut cmd = if let Some(a) = &environment.arduino {
                crate::arduino::upload_command(a, &build, &port)?
            } else {
                command(&environment)
            };
            if environment.arduino.is_none() {
                cmd.current_dir(PathBuf::from(&build.project_dir).join("build"))
                    .args([
                        "-m",
                        "esptool",
                        "--chip",
                        &build.target,
                        "--port",
                        &port,
                        "--baud",
                        "460800",
                        "write_flash",
                        "@flash_args",
                    ]);
            }
            execute(&app, &inner, &id, "flash", cmd, &cancel).map(|_| None)
        })();
        let result = if cancel.load(Ordering::SeqCst) {
            Ok(None)
        } else {
            result
        };
        finish(&app, &inner, &id, "flash", result, &cancel);
    })
}
const MONITOR: &str = r#"import sys, serial
p=serial.Serial()
p.port=sys.argv[1]
p.baudrate=115200
p.timeout=0.2
p.dtr=False
p.rts=False
p.open()
sys.stderr.write('__CLEX_MONITOR_READY__\n');sys.stderr.flush()
try:
    while True:
        data=p.read(256)
        if data: sys.stdout.buffer.write(data);sys.stdout.buffer.flush()
finally:
    p.close()
"#;
#[tauri::command]
pub fn idf_monitor(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    id: String,
    port: String,
) -> Result<(), String> {
    let environment = env_from(&state)?;
    let service = state.0.clone();
    let inner = service.clone();
    let operation_id = id.clone();
    spawn_device_job(&service, &operation_id, move |cancel| {
        publish(
            &app,
            &inner,
            &id,
            "monitor",
            "running",
            "system",
            "Проверка выбранного порта",
            None,
        );
        let result = (|| {
            if cancel.load(Ordering::SeqCst) {
                return Ok(None);
            }
            validated_port(&environment, &port)?;
            if cancel.load(Ordering::SeqCst) {
                return Ok(None);
            }
            publish(
                &app,
                &inner,
                &id,
                "monitor",
                "running",
                "system",
                &format!("Открываем монитор {port}, 115200 бод"),
                None,
            );
            if environment.arduino.is_some() {
                return crate::arduino::monitor(
                    &port,
                    &cancel,
                    || {
                        publish(
                            &app,
                            &inner,
                            &id,
                            "monitor",
                            "connected",
                            "system",
                            "Последовательный порт открыт",
                            None,
                        )
                    },
                    |text| publish(&app, &inner, &id, "monitor", "output", "stdout", text, None),
                )
                .map(|_| None);
            }
            let mut cmd = command(&environment);
            cmd.args(["-u", "-c", MONITOR, &port]);
            execute(&app, &inner, &id, "monitor", cmd, &cancel).map(|_| None)
        })();
        let result = if cancel.load(Ordering::SeqCst) {
            Ok(None)
        } else {
            result
        };
        finish(&app, &inner, &id, "monitor", result, &cancel);
    })
}
#[tauri::command]
pub fn idf_cancel(state: tauri::State<'_, Service>, id: String) -> Result<(), String> {
    let active = state.0.active.lock().map_err(|e| e.to_string())?;
    if let Some(active) = active.as_ref() {
        if active.id != id {
            return Err("ID операции не совпадает".into());
        }
        active.cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}
#[tauri::command]
pub fn idf_events(state: tauri::State<'_, Service>, id: String) -> Result<Vec<Event>, String> {
    Ok(state
        .0
        .events
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .filter(|event| event.job_id == id)
        .cloned()
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn download_backlog_coalesces_updates_and_keeps_sequence_order() {
        let inner = Inner::default();
        let mut event = Event {
            job_id: "build".into(),
            sequence: 1,
            operation: "build".into(),
            status: "output".into(),
            stream: "stdout".into(),
            text: "NOTICE".into(),
            build: None,
            downloaded: None,
            total: None,
            progress_key: None,
        };
        remember_event(&inner, &event);
        event.sequence = 2;
        event.status = "progress".into();
        event.progress_key = Some("archive".into());
        remember_event(&inner, &event);
        let mut ordinary = event.clone();
        ordinary.sequence = 3;
        ordinary.progress_key = None;
        ordinary.status = "output".into();
        remember_event(&inner, &ordinary);
        event.sequence = 4;
        event.downloaded = Some(500);
        remember_event(&inner, &event);
        let events = inner.events.lock().unwrap();
        assert_eq!(
            events.iter().map(|e| e.sequence).collect::<Vec<_>>(),
            vec![1, 3, 4]
        );
        assert_eq!(events.back().unwrap().downloaded, Some(500));
    }
    #[test]
    #[ignore = "Integration: explicit frontend specification and isolated output directory"]
    fn generated_project_matches_frontend_assets() {
        let input = std::env::var("CLEX_TEST_FIRMWARE_SPEC").unwrap();
        let dir = PathBuf::from(std::env::var("CLEX_TEST_PROJECT_DIR").unwrap());
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(input).unwrap()).unwrap();
        let spec: Specification = serde_json::from_value(value.clone()).unwrap();
        write_project(&dir, &spec).unwrap();
        for (file, expected) in value["files"].as_object().unwrap() {
            assert_eq!(
                fs::read_to_string(dir.join(file)).unwrap(),
                expected.as_str().unwrap(),
                "{file}"
            );
        }
    }
    #[test]
    fn espnow_profiles_match_the_chip_and_need_no_downloaded_component() {
        for (board, console, target, runtime, wrong_runtime) in [
            (
                "waveshare-esp32-s3-eth",
                "usb",
                "esp32s3",
                "espnow-s3",
                "espnow-esp32",
            ),
            (
                "doit-esp32-devkit-v1-30pin",
                "uart",
                "esp32",
                "espnow-esp32",
                "espnow-s3",
            ),
        ] {
            let mut spec = Specification {
                board_id: board.into(),
                board_revision: None,
                feature_runtimes: vec![runtime.into()],
                console_mode: console.into(),
                main_c: "source".into(),
                fingerprint: String::new(),
                graphics_runtime: None,
                network_runtime: None,
            };
            spec.fingerprint = hash(
                &serde_json::to_vec(&serde_json::json!([
                    spec.board_id,
                    spec.console_mode,
                    spec.main_c,
                    spec.feature_runtimes
                ]))
                .unwrap(),
            );
            assert!(verify_specification(&spec).is_ok());
            let dir = tempfile::tempdir().unwrap();
            write_project(&dir.path().to_path_buf(), &spec).unwrap();
            assert!(!dir.path().join("main/idf_component.yml").exists());
            let config = fs::read_to_string(dir.path().join("sdkconfig.defaults")).unwrap();
            assert!(config.contains(&format!("CONFIG_IDF_TARGET=\"{target}\"")));
            assert!(config.contains("CONFIG_PARTITION_TABLE_CUSTOM=y"));
            assert!(fs::read_to_string(dir.path().join("partitions.csv"))
                .unwrap()
                .contains("factory,app,factory,0x10000,0x300000"));
            assert!(fs::read_to_string(dir.path().join("main/CMakeLists.txt"))
                .unwrap()
                .contains("esp_wifi"));
            spec.feature_runtimes = vec![wrong_runtime.into()];
            assert!(verify_specification(&spec)
                .unwrap_err()
                .contains("профиль драйвера"));
            spec.feature_runtimes = vec![runtime.into()];
            spec.board_id = "waveshare-esp32-p4-nano".into();
            spec.console_mode = "uart".into();
            spec.board_revision = Some("pre-v3".into());
            assert!(verify_specification(&spec)
                .unwrap_err()
                .contains("профиль драйвера"));
        }
    }
    #[test]
    fn graphics_runtime_is_allowlisted_and_part_of_source_identity() {
        let mut spec = Specification {
            board_id: "waveshare-esp32-s3-eth".into(),
            board_revision: None,
            feature_runtimes: vec![],
            console_mode: "usb".into(),
            main_c: "source".into(),
            fingerprint: String::new(),
            graphics_runtime: None,
            network_runtime: None,
        };
        spec.fingerprint =
            hash(&serde_json::to_vec(&(&spec.board_id, &spec.console_mode, &spec.main_c)).unwrap());
        assert!(verify_specification(&spec).is_ok());
        spec.graphics_runtime = Some("lvgl-9.2.2".into());
        assert!(verify_specification(&spec).is_err());
        spec.fingerprint = hash(
            &serde_json::to_vec(&(
                &spec.board_id,
                &spec.console_mode,
                &spec.main_c,
                "lvgl-9.2.2",
            ))
            .unwrap(),
        );
        let dir = tempfile::tempdir().unwrap();
        write_project(&dir.path().to_path_buf(), &spec).unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("main/idf_component.yml")).unwrap(),
            "dependencies:\n  lvgl/lvgl: \"=9.2.2\"\n"
        );
        assert!(fs::read_to_string(dir.path().join("sdkconfig.defaults"))
            .unwrap()
            .contains("CONFIG_LV_FONT_MONTSERRAT_28=y"));
        spec.graphics_runtime = Some("arbitrary/download".into());
        assert!(verify_specification(&spec).is_err());
    }
    #[test]
    fn network_runtime_is_allowlisted_and_keeps_graphics_optional() {
        for graphics in [None, Some("lvgl-9.2.2".to_string())] {
            let mut spec = Specification {
                board_id: "waveshare-esp32-s3-eth".into(),
                board_revision: None,
                feature_runtimes: vec![],
                console_mode: "usb".into(),
                main_c: "source".into(),
                fingerprint: String::new(),
                graphics_runtime: graphics,
                network_runtime: Some("esp-idf-network-1".into()),
            };
            let mut identity = vec![
                spec.board_id.clone(),
                spec.console_mode.clone(),
                spec.main_c.clone(),
            ];
            if let Some(runtime) = &spec.graphics_runtime {
                identity.push(runtime.clone());
            }
            identity.push(spec.network_runtime.clone().unwrap());
            spec.fingerprint = hash(&serde_json::to_vec(&identity).unwrap());
            let dir = tempfile::tempdir().unwrap();
            write_project(&dir.path().to_path_buf(), &spec).unwrap();
            let cmake = fs::read_to_string(dir.path().join("main/CMakeLists.txt")).unwrap();
            assert!(cmake.contains(
                "esp_eth esp_netif esp_event esp_http_client mbedtls lwip esp_hw_support"
            ));
            assert_eq!(
                cmake.contains("lvgl__lvgl"),
                spec.graphics_runtime.is_some()
            );
            assert!(fs::read_to_string(dir.path().join("partitions.csv"))
                .unwrap()
                .contains("0x300000"));
            spec.network_runtime = None;
            assert!(verify_specification(&spec).is_err());
            spec.network_runtime = Some("arbitrary/download".into());
            identity.pop();
            identity.push("arbitrary/download".into());
            spec.fingerprint = hash(&serde_json::to_vec(&identity).unwrap());
            assert!(verify_specification(&spec).is_err());
        }
    }
    #[test]
    fn device_mac_requires_a_valid_unambiguous_unicast_address() {
        assert_eq!(parse_device_mac("esptool.py v4.11\nMAC: a0:b7:65:12:34:56\nMAC: a0:b7:65:12:34:56\nHard resetting via RTS pin..."), Ok("A0:B7:65:12:34:56".into()));
        for output in [
            "Connecting...",
            "MAC: 00:00:00:00:00:00",
            "MAC: FF:FF:FF:FF:FF:FF",
            "MAC: 01:12:34:56:78:90",
            "MAC: 02:11:22:33:44:55:66:77",
            "MAC: 02:11:22:33:44:GG",
            "MAC: 02:11:22:33:44:55 trailing",
            "MAC: 02:11:22:33:44:55\nMAC: 02:11:22:33:44:66",
        ] {
            assert!(parse_device_mac(output).is_err(), "{output}");
        }
    }
    #[test]
    fn device_mac_command_reads_rom_without_writing_flash() {
        let mut environment: Environment = serde_json::from_value(serde_json::json!({
            "target":"esp32s3", "root":"sdk", "python":"python", "toolsPath":"tools", "sdkVersion":"5.4.4", "identity":"test", "version":"test", "compilerVersion":"test", "cmakeVersion":"test", "ninjaVersion":"test", "diagnostics":""
        })).unwrap();
        for target in ["esp32", "esp32s3"] {
            environment.target = target.into();
            let cmd = mac_read_command(&environment, "COM42").unwrap();
            let args = cmd
                .get_args()
                .map(|arg| arg.to_str().unwrap())
                .collect::<Vec<_>>();
            assert_eq!(
                args,
                [
                    "-m",
                    "esptool",
                    "--chip",
                    target,
                    "--port",
                    "COM42",
                    "--baud",
                    "115200",
                    "--no-stub",
                    "--connect-attempts",
                    "3",
                    "read_mac"
                ]
            );
        }
        environment.target = "esp32p4".into();
        assert!(mac_read_command(&environment, "COM42").is_err());
        environment.target = "arduino-avr".into();
        assert!(mac_read_command(&environment, "COM42").is_err());
    }
    #[test]
    fn reservation_is_exclusive_and_uuid_is_strict() {
        let inner = Arc::new(Inner::default());
        let id = "12345678-1234-1234-1234-123456789abc";
        assert!(reserve(&inner, id).is_ok());
        assert!(reserve(&inner, id).is_err());
        assert!(!id_valid(&"-".repeat(36)));
        assert!(!id_valid("../../12345678-1234-1234-123456789abc"));
    }
    #[test]
    fn serial_stream_preserves_unicode_without_newline() {
        struct ByteReader(std::io::Cursor<Vec<u8>>);
        impl Read for ByteReader {
            fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
                self.0.read(&mut output[..1])
            }
        }
        let original = "Привет 🌡 without newline";
        let mut result = String::new();
        serial_chunks(
            ByteReader(std::io::Cursor::new(original.as_bytes().to_vec())),
            |text| result.push_str(text),
        )
        .unwrap();
        assert_eq!(result, original);
    }
    #[test]
    fn serial_stream_replaces_invalid_and_incomplete_bytes() {
        let mut result = String::new();
        serial_chunks(
            std::io::Cursor::new(vec![65, 255, 66, 0xe2, 0x82]),
            |text| result.push_str(text),
        )
        .unwrap();
        assert_eq!(result, "A�B�");
    }
    #[test]
    fn checksum_matches_frontend_json_encoding() {
        let bytes = serde_json::to_vec(&("board", "usb", "Привет\n")).unwrap();
        assert_eq!(
            hash(&bytes),
            "e24bfa3a8c79933995fb954fd954318a92557c1400697de9747cc5088b38bd95"
        );
    }
    #[test]
    fn device_preparation_returns_without_blocking_and_reserves_before_work() {
        use std::sync::mpsc;
        let inner = Arc::new(Inner::default());
        let worker_inner = inner.clone();
        let caller = thread::current().id();
        let id = "00000000-0000-4000-8000-000000000003";
        let (started_tx, started_rx) = mpsc::channel();
        let (continue_tx, continue_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let launched = Arc::new(AtomicBool::new(false));
        let worker_launched = launched.clone();
        spawn_device_job(&inner, id, move |cancel| {
            started_tx.send(thread::current().id()).unwrap();
            // Model a blocked discovery subprocess without opening a device.
            continue_rx.recv().unwrap();
            if !cancel.load(Ordering::SeqCst) {
                worker_launched.store(true, Ordering::SeqCst);
            }
            release(&worker_inner, id);
            done_tx.send(()).unwrap();
        })
        .unwrap();
        assert_ne!(
            started_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
            caller
        );
        assert!(busy(&inner));
        assert!(reserve(&inner, "00000000-0000-4000-8000-000000000004").is_err());
        // Cancellation is already available while discovery is still pending.
        inner
            .active
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .cancel
            .store(true, Ordering::SeqCst);
        continue_tx.send(()).unwrap();
        done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(!launched.load(Ordering::SeqCst));
        assert!(!busy(&inner));
    }
    #[test]
    fn flash_gate_rejects_stale_sources_environment_and_modified_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("flash_args");
        fs::write(&path, b"verified flash args").unwrap();
        let build = Build {
            id: "test".into(),
            fingerprint: "abc".into(),
            project_dir: dir.path().to_string_lossy().to_string(),
            binary: "app.bin".into(),
            environment_root: "sdk".into(),
            environment_identity: "env".into(),
            target: "esp32s3".into(),
            hashes: vec![("flash_args".into(), hash(b"verified flash args"))],
        };
        assert!(verify_build(&build, "abc", "sdk").is_ok());
        assert!(verify_build(&build, "changed source", "sdk").is_err());
        assert!(verify_build(&build, "abc", "changed sdk").is_err());
        fs::write(path, b"tampered args").unwrap();
        assert!(verify_build(&build, "abc", "sdk").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn monitor_keeps_stdin_open_until_cancelled() {
        let inner = Arc::new(Inner::default());
        let cancel = Arc::new(AtomicBool::new(false));
        let seen = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = seen.clone();
        let control = cancel.clone();
        let mut cmd = Command::new("/bin/sh");
        cmd.args([
            "-c",
            "if read line; then exit 2; else echo stdin-closed; fi",
        ]);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(120));
            control.store(true, Ordering::SeqCst);
        });
        assert!(!execute_process(
            &inner,
            "monitor",
            cmd,
            &cancel,
            Arc::new(move |_, _, _| {
                flag.store(true, Ordering::SeqCst);
            })
        )
        .unwrap());
        assert!(
            !seen.load(Ordering::SeqCst),
            "stdin EOF must not close the monitor"
        );
    }
    #[cfg(unix)]
    #[test]
    fn cancellation_stops_owned_process_group() {
        use std::os::unix::process::CommandExt;
        let mut child = Command::new("sleep")
            .arg("30")
            .process_group(0)
            .spawn()
            .unwrap();
        stop_group(child.id());
        assert!(!child.wait().unwrap().success());
    }
}

pub(crate) fn busy(inner: &Inner) -> bool {
    inner
        .active
        .lock()
        .map(|active| active.is_some())
        .unwrap_or(true)
}
pub(crate) fn release(inner: &Inner, id: &str) {
    if let Ok(mut active) = inner.active.lock() {
        if active.as_ref().is_some_and(|active| active.id == id) {
            *active = None;
        }
    }
}
pub(crate) fn publish_download(
    app: &tauri::AppHandle,
    inner: &Inner,
    id: &str,
    downloaded: u64,
    total: Option<u64>,
) {
    let event = Event {
        job_id: id.into(),
        sequence: inner.sequence.fetch_add(1, Ordering::SeqCst),
        operation: "sdk_install".into(),
        status: "progress".into(),
        stream: "system".into(),
        text: "Загрузка официального EIM".into(),
        build: None,
        downloaded: Some(downloaded),
        total,
        progress_key: None,
    };
    remember_event(inner, &event);
    let _ = app.emit("idf-event", event);
}
