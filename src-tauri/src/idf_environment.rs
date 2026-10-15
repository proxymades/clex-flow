use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    #[serde(default = "crate::boards::default_target")]
    pub target: String,
    pub root: String,
    pub python: String,
    pub tools_path: String,
    pub sdk_version: String,
    pub identity: String,
    pub version: String,
    pub compiler_version: String,
    pub cmake_version: String,
    pub ninja_version: String,
    pub diagnostics: String,
    #[serde(skip)]
    pub variables: BTreeMap<String, String>,
}

pub fn capture(mut command: Command, timeout: Duration) -> Result<(String, String), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Не удалось запустить инструмент: {e}"))?;
    let read = |pipe: Box<dyn Read + Send>| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = pipe.take(1024 * 1024).read_to_end(&mut bytes);
            String::from_utf8_lossy(&bytes).to_string()
        })
    };
    let out = read(Box::new(child.stdout.take().ok_or("Нет stdout")?));
    let err = read(Box::new(child.stderr.take().ok_or("Нет stderr")?));
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if start.elapsed() > timeout {
            crate::idf::stop_group(child.id());
            let _ = child.kill();
            let _ = child.wait();
            let _ = out.join();
            let _ = err.join();
            return Err("Истекло время проверки инструмента".into());
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

pub fn sdk_version(root: &Path) -> Result<String, String> {
    let text = fs::read_to_string(root.join("components/esp_common/include/esp_idf_version.h"))
        .map_err(|_| "В каталоге нет ESP-IDF")?;
    let mut numbers = Vec::new();
    for key in ["MAJOR", "MINOR", "PATCH"] {
        let name = format!("ESP_IDF_VERSION_{key}");
        let value = text
            .lines()
            .find_map(|line| {
                let p: Vec<_> = line.split_whitespace().collect();
                if p.len() >= 3 && p[1] == name {
                    p[2].parse::<u32>().ok()
                } else {
                    None
                }
            })
            .ok_or("Не удалось определить версию ESP-IDF")?;
        numbers.push(value);
    }
    if !root.join("tools/idf.py").is_file() || !root.join("tools/idf_tools.py").is_file() {
        return Err("Не найдены инструменты ESP-IDF".into());
    }
    Ok(format!("{}.{}.{}", numbers[0], numbers[1], numbers[2]))
}
pub fn home() -> Result<PathBuf, String> {
    env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .ok_or("Не определен домашний каталог".into())
}
pub fn executable(venv: &Path) -> PathBuf {
    venv.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    })
}
pub fn base_path() -> String {
    let path = env::var("PATH").unwrap_or_default();
    if cfg!(target_os = "macos") {
        format!("/opt/homebrew/bin:/usr/local/bin:{path}")
    } else {
        path
    }
}
pub fn find_tool(name: &str, path: &str) -> Option<PathBuf> {
    let suffixes = if cfg!(windows) {
        vec![".exe", ".cmd", ".bat", ""]
    } else {
        vec![""]
    };
    env::split_paths(path)
        .flat_map(|dir| {
            suffixes
                .iter()
                .map(move |suffix| dir.join(format!("{name}{suffix}")))
        })
        .find(|file| file.is_file())
}
// EIM stores tools directly under its tools directory; idf_tools.py expects a parent containing tools/.
pub fn export_root(tools: &Path) -> PathBuf {
    if tools
        .file_name()
        .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("tools"))
        && !tools.join("tools").is_dir()
    {
        tools.parent().unwrap_or(tools).to_path_buf()
    } else {
        tools.to_path_buf()
    }
}

fn python_environment(python: &Path) -> Result<PathBuf, String> {
    let parent = python.parent().ok_or("Некорректный Python-путь")?;
    if parent
        .file_name()
        .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("scripts") || name == "bin")
    {
        parent
            .parent()
            .map(Path::to_path_buf)
            .ok_or("Некорректный Python-путь".into())
    } else {
        Ok(parent.to_path_buf())
    }
}

fn layout_candidates(
    root: &Path,
    python: Option<&Path>,
    tools: Option<&Path>,
    home: &Path,
    env_tools: Option<&Path>,
    env_python: Option<&Path>,
    version: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let major_minor = version.rsplit_once('.').ok_or("Некорректная версия")?.0;
    let default_tools = home.join(".espressif");
    let mut bases = Vec::new();
    if let Some(tools) = tools {
        bases.extend([tools.to_path_buf(), tools.join("tools")]);
    }
    if let Some(python) = python {
        bases.extend(crate::sdk_discovery::related_bases(&python_environment(
            python,
        )?));
    }
    bases.extend(crate::sdk_discovery::related_bases(root));
    if let Some(tools) = env_tools {
        bases.extend([tools.to_path_buf(), tools.join("tools")]);
    }
    bases.extend([default_tools.clone(), default_tools.join("tools")]);
    let bases = crate::sdk_discovery::unique(bases);
    let constraints = format!("espidf.constraints.v{major_minor}.txt");
    let mut pythons = Vec::new();
    if let Some(python) = python {
        pythons.push(python.to_path_buf());
    } else {
        for base in &bases {
            pythons.extend([
                executable(&base.join("python").join(format!("v{version}")).join("venv")),
                executable(&base.join(".venv")),
                executable(&base.join("venv")),
            ]);
            if let Ok(entries) = fs::read_dir(base.join("python_env")) {
                let mut environments: Vec<_> = entries
                    .flatten()
                    .filter(|entry| {
                        entry
                            .file_name()
                            .to_string_lossy()
                            .starts_with(&format!("idf{major_minor}_"))
                    })
                    .map(|entry| executable(&entry.path()))
                    .collect();
                environments.sort();
                environments.reverse();
                pythons.extend(environments);
            }
        }
        if let Some(path) = env_python {
            pythons.push(executable(path));
        }
    }
    for candidate in crate::sdk_discovery::unique(pythons) {
        if !candidate.is_file() {
            continue;
        }
        let inferred = crate::sdk_discovery::related_bases(&python_environment(&candidate)?);
        let candidates = if let Some(tools) = tools {
            vec![tools.to_path_buf(), tools.join("tools")]
        } else {
            crate::sdk_discovery::unique(inferred.into_iter().chain(bases.iter().cloned()))
        };
        if let Some(tools) = candidates
            .into_iter()
            .find(|path| path.join(&constraints).is_file())
        {
            return Ok((candidate, tools));
        }
    }
    if python.is_some_and(|path| !path.is_file()) {
        return Err("Указанный Python не найден. Выберите python.exe из окружения ESP-IDF.".into());
    }
    if let Some(tools) = tools {
        if !tools.join(&constraints).is_file() && !tools.join("tools").join(&constraints).is_file()
        {
            return Err(format!("В указанной папке инструментов не найден {constraints}. Укажите каталог инструментов выбранной ESP-IDF."));
        }
    }
    Err("Не удалось найти Python и инструменты выбранной ESP-IDF. Укажите Python окружения и каталог инструментов в настройках.".into())
}

fn filtered_tools(root: &Path, cache: &Path, target: &str) -> Result<PathBuf, String> {
    let mut value: serde_json::Value = serde_json::from_slice(
        &fs::read(root.join("tools/tools.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let tools = value["tools"]
        .as_array_mut()
        .ok_or("Некорректный tools.json")?;
    tools.retain(|tool| {
        tool["supported_targets"]
            .as_array()
            .map(|targets| {
                targets
                    .iter()
                    .any(|value| value == target || value == "all")
            })
            .unwrap_or(false)
    });
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let key = format!("{:x}", Sha256::digest(root.to_string_lossy().as_bytes()));
    let path = cache.join(format!("{key}-{target}-tools.json"));
    fs::write(
        &path,
        serde_json::to_vec(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(path)
}

pub fn inspect_target(
    target: &str,
    root: &Path,
    python: Option<&Path>,
    tools: Option<&Path>,
    git: Option<&Path>,
    cache: &Path,
) -> Result<Environment, String> {
    let compiler = crate::boards::compiler(target)?;
    let root = root
        .canonicalize()
        .map_err(|e| format!("SDK недоступен: {e}"))?;
    let sdk_version = sdk_version(&root)?;
    let home = home()?;
    let env_tools = env::var_os("IDF_TOOLS_PATH").map(PathBuf::from);
    let env_python = env::var_os("IDF_PYTHON_ENV_PATH").map(PathBuf::from);
    let (python, tools) = layout_candidates(
        &root,
        python,
        tools,
        &home,
        env_tools.as_deref(),
        env_python.as_deref(),
        &sdk_version,
    )?;
    let venv = python_environment(&python)?;
    let mut variables = BTreeMap::new();
    variables.insert("IDF_PATH".into(), root.to_string_lossy().to_string());
    variables.insert(
        "IDF_PYTHON_ENV_PATH".into(),
        venv.to_string_lossy().to_string(),
    );
    variables.insert("PYTHONDONTWRITEBYTECODE".into(), "1".into());
    variables.insert("PYTHONIOENCODING".into(), "utf-8".into());
    variables.insert("PYTHONUTF8".into(), "1".into());
    variables.insert("IDF_COMPONENT_MANAGER".into(), "0".into());
    variables.insert("IDF_SKIP_CHECK_SUBMODULES".into(), "1".into());
    let separator = if cfg!(windows) { ";" } else { ":" };
    let mut path_parts = vec![python
        .parent()
        .unwrap_or(&root)
        .to_string_lossy()
        .to_string()];
    for candidate in [
        tools.join("git/cmd"),
        tools.join("git/bin"),
        tools.join("git"),
    ] {
        if candidate.is_dir() {
            path_parts.push(candidate.to_string_lossy().to_string());
        }
    }
    if let Some(parent) = git.and_then(Path::parent) {
        path_parts.push(parent.to_string_lossy().to_string());
    }
    path_parts.push(base_path());
    let child_base_path = path_parts.join(separator);
    variables.insert("PATH".into(), child_base_path.clone());
    let spec = filtered_tools(&root, cache, target)?;
    let deactivate = cache.join(format!(
        "{:x}-{target}-deactivate.json",
        Sha256::digest(root.to_string_lossy().as_bytes())
    ));
    variables.insert(
        "IDF_DEACTIVATE_FILE_PATH".into(),
        deactivate.to_string_lossy().to_string(),
    );
    let mut export = Command::new(&python);
    export
        .arg(root.join("tools/idf_tools.py"))
        .arg("--tools-json")
        .arg(spec)
        .args(["export", "--format", "key-value"])
        .envs(&variables)
        .env("IDF_TOOLS_PATH", export_root(&tools));
    let (output, diagnostics) = capture(export, Duration::from_secs(30))?;
    let base = child_base_path;
    for line in output.lines() {
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
                        .replace("${PATH}", &base)
                        .replace("$PATH", &base)
                        .replace("%PATH%", &base),
                );
            }
        }
    }
    variables.insert("IDF_TOOLS_PATH".into(), tools.to_string_lossy().to_string());
    let mut check = Command::new(&python);
    check
        .arg(root.join("tools/idf.py"))
        .arg("--version")
        .envs(&variables);
    let (version, warnings) = capture(check, Duration::from_secs(30))?;
    if !version.contains(&format!("v{sdk_version}")) {
        return Err("Версия SDK и tools/idf.py не совпадают".into());
    }
    fn tool(name: &str, vars: &BTreeMap<String, String>) -> Result<String, String> {
        let path = find_tool(name, vars.get("PATH").ok_or("Нет PATH")?)
            .ok_or_else(|| format!("Не найден {name}"))?;
        let mut command = Command::new(path);
        command.arg("--version").envs(vars);
        Ok(capture(command, Duration::from_secs(30))?
            .0
            .lines()
            .next()
            .unwrap_or_default()
            .into())
    }
    let compiler_version = tool(compiler, &variables)?;
    let cmake_version = tool("cmake", &variables)?;
    let ninja_version = tool("ninja", &variables)?;
    let identity = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(
                &root,
                &python,
                &tools,
                &sdk_version,
                &compiler_version,
                target
            ))
            .map_err(|e| e.to_string())?
        )
    );
    Ok(Environment {
        target: target.into(),
        root: root.to_string_lossy().into(),
        python: python.to_string_lossy().into(),
        tools_path: tools.to_string_lossy().into(),
        sdk_version,
        identity,
        version: version.trim().into(),
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
        path.strip_prefix("COM")
            .and_then(|n| n.parse::<u32>().ok())
            .is_some()
    } else {
        path.starts_with("/dev/ttyUSB") || path.starts_with("/dev/ttyACM")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn eim_and_standard_export_roots_are_distinct() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("tools")).unwrap();
        assert_eq!(export_root(d.path()), d.path());
        assert_eq!(export_root(&d.path().join("tools")), d.path());
    }
    #[test]
    fn missing_sdk_is_not_healthy() {
        let d = tempfile::tempdir().unwrap();
        assert!(sdk_version(d.path()).is_err());
    }
    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "fixture").unwrap();
    }
    #[test]
    fn standard_installer_resolves_python_and_tools_from_the_selected_installation() {
        let d = tempfile::tempdir().unwrap();
        let base = d.path().join("X Espressif - тест");
        let root = base.join("frameworks/esp-idf-v5.4.4");
        fs::create_dir_all(&root).unwrap();
        let python = executable(&base.join("python_env/idf5.4_py3.11_env"));
        touch(&python);
        touch(&base.join("espidf.constraints.v5.4.txt"));
        let home = d.path().join("home");
        // A different SDK in the default home must not win over the selected installation.
        touch(&executable(
            &home.join(".espressif/python_env/idf5.4_py3.9_env"),
        ));
        touch(&home.join(".espressif/espidf.constraints.v5.4.txt"));
        let found = layout_candidates(&root, None, None, &home, None, None, "5.4.4").unwrap();
        assert_eq!(found, (python.clone(), base.clone()));
        assert_eq!(
            layout_candidates(&root, Some(&python), None, &home, None, None, "5.4.4").unwrap(),
            (python, base.clone())
        );
        assert_eq!(export_root(&base), base);
    }
    #[test]
    fn eim_layout_and_explicit_tools_preserve_owned_slot_paths() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("v5.4.4/esp-idf");
        let tools = d.path().join("tools");
        let python = executable(&tools.join("python/v5.4.4/venv"));
        touch(&python);
        touch(&tools.join("espidf.constraints.v5.4.txt"));
        assert_eq!(
            layout_candidates(
                &root,
                None,
                Some(&tools),
                &d.path().join("home"),
                None,
                None,
                "5.4.4"
            )
            .unwrap(),
            (python, tools.clone())
        );
        assert_eq!(export_root(&tools), d.path());
    }
    #[test]
    fn supports_split_tools_paths_and_rejects_bad_explicit_overrides() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("sdk/esp-idf");
        let tools = d.path().join("other-drive/инструменты");
        let python = executable(&tools.join("python_env/idf5.4_py3.12_env"));
        touch(&python);
        touch(&tools.join("espidf.constraints.v5.4.txt"));
        assert_eq!(
            layout_candidates(
                &root,
                None,
                None,
                &d.path().join("home"),
                Some(&tools),
                None,
                "5.4.4"
            )
            .unwrap(),
            (python.clone(), tools.clone())
        );
        assert!(layout_candidates(
            &root,
            Some(&d.path().join("missing/python.exe")),
            Some(&tools),
            d.path(),
            None,
            None,
            "5.4.4"
        )
        .unwrap_err()
        .contains("Python не найден"));
        assert!(layout_candidates(
            &root,
            Some(&python),
            Some(&d.path().join("wrong")),
            d.path(),
            None,
            None,
            "5.4.4"
        )
        .unwrap_err()
        .contains("папке инструментов"));
        fs::remove_file(tools.join("espidf.constraints.v5.4.txt")).unwrap();
        assert!(layout_candidates(
            &root,
            Some(&python),
            Some(&tools),
            d.path(),
            None,
            None,
            "5.4.4"
        )
        .is_err());
    }
}
