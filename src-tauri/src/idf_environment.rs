use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub root: String,
    pub python: String,
    pub tools_path: String,
    pub version: String,
    pub compiler_version: String,
    pub cmake_version: String,
    pub ninja_version: String,
    pub diagnostics: String,
    #[serde(skip)]
    pub variables: BTreeMap<String, String>,
}

pub fn capture(mut command: Command, timeout: Duration) -> Result<(String, String), String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("Не удалось запустить инструмент: {e}"))?;
    let stdout = child.stdout.take().ok_or("Нет stdout")?;
    let stderr = child.stderr.take().ok_or("Нет stderr")?;
    let read = |pipe: Box<dyn Read + Send>| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = pipe.take(1024 * 1024).read_to_end(&mut bytes);
            String::from_utf8_lossy(&bytes).to_string()
        })
    };
    let out = read(Box::new(stdout));
    let err = read(Box::new(stderr));
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Истекло время проверки инструмента (30 секунд)".into());
        }
        thread::sleep(Duration::from_millis(30));
    };
    let out = out.join().unwrap_or_default();
    let err = err.join().unwrap_or_default();
    if !status.success() {
        return Err(format!("Инструмент завершился с ошибкой:\n{out}\n{err}"));
    }
    Ok((out, err))
}

fn version(root: &Path) -> Result<(), String> {
    let text = fs::read_to_string(root.join("components/esp_common/include/esp_idf_version.h"))
        .map_err(|_| "В каталоге нет ESP-IDF")?;
    for (name, expected) in [("MAJOR", "5"), ("MINOR", "4"), ("PATCH", "4")] {
        if !text.lines().any(|line| {
            let parts = line.split_whitespace().collect::<Vec<_>>();
            parts.len() >= 3
                && parts[1] == format!("ESP_IDF_VERSION_{name}")
                && parts[2] == expected
        }) {
            return Err(
                "Требуется установленная ESP-IDF 5.4.4. Переустановка не выполнялась.".into(),
            );
        }
    }
    if !root.join("tools/idf.py").is_file() || !root.join("tools/idf_tools.py").is_file() {
        return Err("Не найдены инструменты ESP-IDF".into());
    }
    Ok(())
}
fn executable(venv: &Path) -> PathBuf {
    venv.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    })
}

pub fn discover(root: Option<String>, python: Option<String>) -> Result<Environment, String> {
    let home = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .ok_or("Не определён домашний каталог")?;
    let eim_file = home.join(".espressif/tools/eim_idf.json");
    let eim = fs::read_to_string(eim_file)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
    let eim_record = eim
        .as_ref()
        .and_then(|value| value["idfInstalled"].as_array())
        .and_then(|records| {
            records
                .iter()
                .find(|record| record["name"].as_str() == Some("v5.4.4"))
        });
    let mut roots = Vec::new();
    if let Some(root) = root.filter(|v| !v.trim().is_empty()) {
        roots.push(PathBuf::from(root));
    } else {
        if let Some(path) = eim_record.and_then(|record| record["path"].as_str()) {
            roots.push(PathBuf::from(path));
        }
        if let Some(root) = env::var_os("IDF_PATH") {
            roots.push(PathBuf::from(root));
        }
        for candidate in [
            ".espressif/v5.4.4/esp-idf",
            ".espressif-s3/v5.4.4/esp-idf",
            "esp/esp-idf",
        ] {
            roots.push(home.join(candidate));
        }
    }
    let root = roots
        .into_iter()
        .find(|root| version(root).is_ok())
        .ok_or("ESP-IDF 5.4.4 не найдена. Укажите путь к существующей установке в настройках.")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let base = home.join(".espressif");
    let mut pythons = Vec::new();
    if let Some(py) = python.filter(|v| !v.trim().is_empty()) {
        pythons.push(PathBuf::from(py));
    } else {
        if let Some(path) = eim_record.and_then(|record| record["python"].as_str()) {
            pythons.push(PathBuf::from(path));
        }
        if let Some(venv) = env::var_os("IDF_PYTHON_ENV_PATH") {
            pythons.push(executable(&PathBuf::from(venv)));
        }
        pythons.push(executable(&base.join("tools/python/v5.4.4/venv")));
        if let Ok(entries) = fs::read_dir(base.join("python_env")) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("idf5.4_") {
                    pythons.push(executable(&entry.path()));
                }
            }
        }
    }
    let python = pythons
        .into_iter()
        .find(|path| path.is_file())
        .ok_or("Python-окружение ESP-IDF 5.4 не найдено. Укажите существующий Python вручную.")?;
    let venv = python
        .parent()
        .and_then(Path::parent)
        .ok_or("Некорректный Python-путь")?;
    let mut variables = BTreeMap::new();
    variables.insert("IDF_PATH".into(), root.to_string_lossy().to_string());
    variables.insert(
        "IDF_PYTHON_ENV_PATH".into(),
        venv.to_string_lossy().to_string(),
    );
    variables.insert("PYTHONDONTWRITEBYTECODE".into(), "1".into());
    variables.insert("IDF_COMPONENT_MANAGER".into(), "0".into());
    variables.insert("IDF_SKIP_CHECK_SUBMODULES".into(), "1".into());
    let base_path = env::var("PATH").unwrap_or_default();
    let base_path = if cfg!(windows) {
        base_path
    } else {
        format!("/opt/homebrew/bin:/usr/local/bin:{base_path}")
    };
    variables.insert("PATH".into(), base_path.clone());
    let mut export = Command::new(&python);
    export
        .arg(root.join("tools/idf_tools.py"))
        .args(["export", "--format", "key-value"])
        .envs(&variables)
        .env("IDF_TOOLS_PATH", &base);
    let (out, diagnostics) = capture(export, Duration::from_secs(30))?;
    for line in out.lines() {
        if let Some((key, value)) = line.split_once('=') {
            if [
                "PATH",
                "ESP_ROM_ELF_DIR",
                "OPENOCD_SCRIPTS",
                "ESP_IDF_VERSION",
            ]
            .contains(&key)
            {
                variables.insert(
                    key.into(),
                    value
                        .replace("$PATH", &base_path)
                        .replace("%PATH%", &base_path),
                );
            }
        }
    }
    // EIM располагает constraints непосредственно в .espressif/tools.
    let tools = if base.join("espidf.constraints.v5.4.txt").is_file() {
        base.clone()
    } else if base.join("tools/espidf.constraints.v5.4.txt").is_file() {
        base.join("tools")
    } else {
        return Err("Не найден существующий файл constraints ESP-IDF 5.4. Установка инструментов не выполнялась.".into());
    };
    variables.insert("IDF_TOOLS_PATH".into(), tools.to_string_lossy().to_string());
    let mut command = Command::new(&python);
    command
        .arg(root.join("tools/idf.py"))
        .arg("--version")
        .envs(&variables);
    let (idf_version, warnings) = capture(command, Duration::from_secs(30))?;
    if !idf_version.contains("v5.4.4") {
        return Err(format!(
            "Неожиданная версия ESP-IDF: {}",
            idf_version.trim()
        ));
    }
    fn tool(name: &str, variables: &BTreeMap<String, String>) -> Result<String, String> {
        let path = env::split_paths(variables.get("PATH").ok_or("Нет PATH")?)
            .map(|dir| {
                dir.join(if cfg!(windows) {
                    format!("{name}.exe")
                } else {
                    name.into()
                })
            })
            .find(|path| path.is_file())
            .ok_or_else(|| format!("Не найден {name}"))?;
        let mut command = Command::new(path);
        command.arg("--version").envs(variables);
        Ok(capture(command, Duration::from_secs(30))?
            .0
            .lines()
            .next()
            .unwrap_or_default()
            .to_string())
    }
    let compiler_version = tool("xtensa-esp32s3-elf-gcc", &variables)?;
    let cmake_version = tool("cmake", &variables)?;
    let ninja_version = tool("ninja", &variables)?;
    Ok(Environment {
        root: root.to_string_lossy().to_string(),
        python: python.to_string_lossy().to_string(),
        tools_path: tools.to_string_lossy().to_string(),
        version: idf_version.trim().into(),
        compiler_version,
        cmake_version,
        ninja_version,
        diagnostics: format!("{diagnostics}{warnings}"),
        variables,
    })
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Port {
    pub path: String,
    pub description: String,
    pub usb: bool,
}
pub fn ports(environment: &Environment) -> Result<Vec<Port>, String> {
    let code="import json; from serial.tools import list_ports; print(json.dumps([{'path':p.device,'description':p.description,'usb':p.vid is not None} for p in list_ports.comports()]))";
    let mut command = Command::new(&environment.python);
    command.args(["-c", code]).envs(&environment.variables);
    let data: Vec<Port> = serde_json::from_str(&capture(command, Duration::from_secs(30))?.0)
        .map_err(|e| e.to_string())?;
    Ok(data
        .into_iter()
        .filter(|port| allowed_port(&port.path))
        .collect())
}
pub fn allowed_port(path: &str) -> bool {
    if cfg!(target_os = "macos") {
        path.starts_with("/dev/cu.")
            && !path.contains("Bluetooth")
            && !path.contains("debug-console")
    } else if cfg!(windows) {
        path.starts_with("COM") && path[3..].parse::<u32>().is_ok()
    } else {
        path.starts_with("/dev/ttyUSB") || path.starts_with("/dev/ttyACM")
    }
}
