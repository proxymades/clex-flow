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
    environment: Mutex<Option<Environment>>,
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
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Specification {
    pub board_id: String,
    pub console_mode: String,
    pub main_c: String,
    pub fingerprint: String,
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
fn publish(
    app: &tauri::AppHandle,
    inner: &Inner,
    id: &str,
    operation: &str,
    status: &str,
    stream: &str,
    text: &str,
    build: Option<Build>,
) {
    let event = Event {
        job_id: id.into(),
        sequence: inner.sequence.fetch_add(1, Ordering::SeqCst),
        operation: operation.into(),
        status: status.into(),
        stream: stream.into(),
        text: text.chars().take(8192).collect(),
        build,
    };
    if let Ok(mut events) = inner.events.lock() {
        if events.len() >= 1500 {
            events.pop_front();
        }
        events.push_back(event.clone());
    }
    let _ = app.emit("idf-event", event);
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
    if !["waveshare-esp32-s3-eth", "espressif-devkitc-1-v1-1-n8r8"]
        .contains(&spec.board_id.as_str())
        || !["usb", "uart"].contains(&spec.console_mode.as_str())
        || spec.main_c.len() > 2 * 1024 * 1024
    {
        return Err("Некорректные параметры прошивки".into());
    }
    let computed = hash(
        &serde_json::to_vec(&(&spec.board_id, &spec.console_mode, &spec.main_c))
            .map_err(|e| e.to_string())?,
    );
    if computed != spec.fingerprint {
        return Err("Контрольная сумма исходников не совпадает".into());
    }
    let env_hash = hash(environment.root.as_bytes());
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("firmware")
        .join(format!("{}-{}", spec.fingerprint, &env_hash[..12]));
    fs::create_dir_all(dir.join("main")).map_err(|e| e.to_string())?;
    write_source(&dir.join("CMakeLists.txt"),"cmake_minimum_required(VERSION 3.16)\nset(COMPONENTS main)\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(clex_flow_firmware)\n")?;
    write_source(&dir.join("main/CMakeLists.txt"),"idf_component_register(SRCS \"main.c\" INCLUDE_DIRS \".\" REQUIRES esp_driver_gpio esp_timer freertos log)\n")?;
    write_source(&dir.join("main/main.c"), &spec.main_c)?;
    let size = if spec.board_id == "waveshare-esp32-s3-eth" {
        16
    } else {
        8
    };
    let console = if spec.console_mode == "usb" {
        "USB_SERIAL_JTAG"
    } else {
        "UART_DEFAULT"
    };
    write_source(&dir.join("sdkconfig.defaults"),&format!("CONFIG_IDF_TARGET=\"esp32s3\"\nCONFIG_ESPTOOLPY_FLASHSIZE_{size}MB=y\nCONFIG_ESPTOOLPY_FLASHMODE_DIO=y\nCONFIG_FREERTOS_HZ=1000\nCONFIG_LOG_COLORS=n\nCONFIG_ESP_CONSOLE_{console}=y\nCONFIG_ESP_CONSOLE_SECONDARY_NONE=y\n"))?;
    Ok(dir)
}
#[cfg(unix)]
fn stop_group(pid: u32) {
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
    thread::sleep(Duration::from_millis(200));
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}
#[cfg(windows)]
fn stop_group(pid: u32) {
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
fn serial_chunks(mut pipe: impl Read, mut emit: impl FnMut(&str)) -> std::io::Result<()> {
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
fn execute(
    app: &tauri::AppHandle,
    inner: &Arc<Inner>,
    id: &str,
    operation: &str,
    mut cmd: Command,
    cancel: &Arc<AtomicBool>,
) -> Result<bool, String> {
    if cancel.load(Ordering::SeqCst) {
        return Ok(false);
    }
    cmd.stdin(Stdio::null())
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
            let app = app.clone();
            let inner = inner.clone();
            let id = id.to_string();
            let op = operation.to_string();
            readers.push(thread::spawn(move || {
                if op == "monitor" && stream == "stdout" {
                    let _ = serial_chunks(pipe, |text| {
                        publish(&app, &inner, &id, &op, "output", stream, text, None)
                    });
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
                                    publish(
                                        &app,
                                        &inner,
                                        &id,
                                        &op,
                                        "connected",
                                        stream,
                                        "Последовательный порт открыт",
                                        None,
                                    );
                                } else {
                                    publish(&app, &inner, &id, &op, "output", stream, &text, None);
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
fn reserve(inner: &Arc<Inner>, id: &str) -> Result<Arc<AtomicBool>, String> {
    if !id_valid(id) {
        return Err("Некорректный ID операции".into());
    }
    let mut active = inner.active.lock().map_err(|e| e.to_string())?;
    if active.is_some() {
        return Err("Другая операция ESP-IDF уже выполняется".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *active = Some(Active {
        id: id.into(),
        cancel: cancel.clone(),
        pid: 0,
    });
    Ok(cancel)
}
fn finish(
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
        .ok_or("Сначала проверьте ESP-IDF в настройках".into())
}
#[tauri::command]
pub async fn idf_environment(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    root: Option<String>,
    python: Option<String>,
) -> Result<Environment, String> {
    let inner = state.0.clone();
    if inner.active.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("Нельзя менять среду во время операции".into());
    }
    let config = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("idf-settings.json");
    let (mut root, mut python) = (root, python);
    if root.is_none() && python.is_none() {
        if let Ok(text) = fs::read_to_string(&config) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                root = value["root"].as_str().map(str::to_owned);
                python = value["python"].as_str().map(str::to_owned);
            }
        }
    }
    let environment =
        tauri::async_runtime::spawn_blocking(move || idf_environment::discover(root, python))
            .await
            .map_err(|e| e.to_string())??;
    fs::create_dir_all(config.parent().ok_or("Нет каталога настроек")?)
        .map_err(|e| e.to_string())?;
    fs::write(
        config,
        serde_json::to_vec_pretty(
            &serde_json::json!({"root":environment.root,"python":environment.python}),
        )
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    *inner.environment.lock().map_err(|e| e.to_string())? = Some(environment.clone());
    Ok(environment)
}
#[tauri::command]
pub async fn idf_ports(state: tauri::State<'_, Service>) -> Result<Vec<Port>, String> {
    let environment = env_from(&state)?;
    tauri::async_runtime::spawn_blocking(move || idf_environment::ports(&environment))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn idf_build(
    app: tauri::AppHandle,
    state: tauri::State<'_, Service>,
    id: String,
    spec: Specification,
) -> Result<(), String> {
    let environment = env_from(&state)?;
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
            "Генерация отдельного ESP-IDF проекта",
            None,
        );
        let result = (|| {
            let dir = prepare(&app, &environment, &spec)?;
            let mut cmd = sdk_command(&environment);
            cmd.current_dir(&dir)
                .args(["-D", "IDF_TARGET=esp32s3", "build"]);
            if !execute(&app, &inner, &id, "build", cmd, &cancel)? {
                return Ok(None);
            }
            let mut hashes = Vec::new();
            for path in [
                "build/bootloader/bootloader.bin",
                "build/partition_table/partition-table.bin",
                "build/clex_flow_firmware.bin",
                "build/flash_args",
            ] {
                let file = dir.join(path);
                let bytes = fs::read(&file)
                    .map_err(|e| format!("Не найден результат сборки {path}: {e}"))?;
                hashes.push((path.into(), hash(&bytes)));
            }
            let build = Build {
                id: id.clone(),
                fingerprint: spec.fingerprint,
                project_dir: dir.to_string_lossy().to_string(),
                binary: dir
                    .join("build/clex_flow_firmware.bin")
                    .to_string_lossy()
                    .to_string(),
                environment_root: environment.root.clone(),
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
    validated_port(&environment, &port)?;
    let build = state
        .0
        .builds
        .lock()
        .map_err(|e| e.to_string())?
        .get(&build_id)
        .cloned()
        .ok_or("Сначала выполните успешную сборку")?;
    verify_build(&build, &fingerprint, &environment.root)?;
    let inner = state.0.clone();
    let cancel = reserve(&inner, &id)?;
    thread::spawn(move || {
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
        let mut cmd = command(&environment);
        cmd.current_dir(PathBuf::from(&build.project_dir).join("build"))
            .args([
                "-m",
                "esptool",
                "--chip",
                "esp32s3",
                "--port",
                &port,
                "--baud",
                "460800",
                "write_flash",
                "@flash_args",
            ]);
        let result = execute(&app, &inner, &id, "flash", cmd, &cancel).map(|_| None);
        finish(&app, &inner, &id, "flash", result, &cancel);
    });
    Ok(())
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
    validated_port(&environment, &port)?;
    let inner = state.0.clone();
    let cancel = reserve(&inner, &id)?;
    thread::spawn(move || {
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
        let mut cmd = command(&environment);
        cmd.args(["-u", "-c", MONITOR, &port]);
        let result = execute(&app, &inner, &id, "monitor", cmd, &cancel).map(|_| None);
        finish(&app, &inner, &id, "monitor", result, &cancel);
    });
    Ok(())
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
