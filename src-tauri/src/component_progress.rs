use serde::Deserialize;
use std::{env, fs, path::Path, process::Command};

const PREFIX: &str = "__CLEX_COMPONENT_PROGRESS__";

pub fn configure(command: &mut Command, directory: &Path) -> Result<(), String> {
    let hooks = directory.join("component-progress");
    fs::create_dir_all(&hooks).map_err(|e| e.to_string())?;
    for (name, source) in [
        (
            "sitecustomize.py",
            include_str!("component_progress/sitecustomize.py"),
        ),
        (
            "clex_component_progress.py",
            include_str!("component_progress/clex_component_progress.py"),
        ),
    ] {
        let file = hooks.join(name);
        if fs::read_to_string(&file).ok().as_deref() != Some(source) {
            fs::write(file, source).map_err(|e| e.to_string())?;
        }
    }
    let previous = command
        .get_envs()
        .find(|(name, _)| name.to_string_lossy().eq_ignore_ascii_case("PYTHONPATH"))
        .map(|(_, value)| value.map(|v| v.to_os_string()))
        .unwrap_or_else(|| env::var_os("PYTHONPATH"));
    let mut paths = vec![hooks];
    if let Some(previous) = previous {
        paths.extend(env::split_paths(&previous));
    }
    command
        .env(
            "PYTHONPATH",
            env::join_paths(paths).map_err(|e| e.to_string())?,
        )
        .env("CLEX_COMPONENT_PROGRESS", "1");
    Ok(())
}

#[derive(Deserialize)]
struct Message {
    v: u8,
    id: String,
    component: String,
    version: String,
    phase: String,
    kind: String,
    downloaded: u64,
    total: Option<u64>,
    speed: f64,
    stalled: u64,
    complete: bool,
}

pub struct Update {
    pub key: String,
    pub text: String,
    pub downloaded: Option<u64>,
    pub total: Option<u64>,
}

fn amount(bytes: f64) -> String {
    let text = if bytes >= 1_000_000.0 {
        format!("{:.1} МБ", bytes / 1_000_000.0)
    } else if bytes >= 1_000.0 {
        format!("{:.0} КБ", bytes / 1_000.0)
    } else {
        format!("{bytes:.0} Б")
    };
    text.replace('.', ",")
}

pub fn is_message(text: &str) -> bool {
    text.starts_with(PREFIX)
}

pub fn parse(text: &str) -> Option<Update> {
    let input = text.strip_prefix(PREFIX)?;
    if input.len() > 4096 {
        return None;
    }
    let value: Message = serde_json::from_str(input).ok()?;
    if value.v != 1
        || value.id.len() != 32
        || !value.id.bytes().all(|b| b.is_ascii_hexdigit())
        || value.component.is_empty()
        || value.component.chars().count() > 128
        || value.version.chars().count() > 64
        || value
            .component
            .chars()
            .chain(value.version.chars())
            .any(char::is_control)
        || !value.speed.is_finite()
        || value.speed < 0.0
    {
        return None;
    }
    let label = format!("{} {}", value.component, value.version);
    let phase = match value.phase.as_str() {
        "prepare" => format!("Подготовка компонента {label}"),
        "download" => {
            let title = if value.kind == "checksums" {
                "Загрузка контрольных сумм"
            } else {
                "Загрузка"
            };
            let loaded = amount(value.downloaded as f64);
            let size = if let Some(total) = value.total.filter(|n| *n > 0) {
                let percent = (value.downloaded as f64 / total as f64 * 100.0).min(100.0);
                format!("{loaded} / {} · {percent:.0}%", amount(total as f64))
            } else {
                loaded
            };
            let state = if value.complete && value.total.is_none_or(|size| size == value.downloaded)
            {
                " · загружено".into()
            } else if value.stalled >= 15 {
                format!(" · данные не поступают {} с", value.stalled)
            } else {
                String::new()
            };
            format!("{title} {label}: {size} · {}/с{state}", amount(value.speed))
        }
        "unpack" => format!(
            "Распаковка {label}{}",
            if value.complete {
                " · завершена"
            } else {
                ""
            }
        ),
        "verify" => format!(
            "Проверка файлов {label}{}",
            if value.complete {
                " · завершена"
            } else {
                ""
            }
        ),
        "cached" => format!("Компонент {label} получен из кэша"),
        _ => return None,
    };
    let text = if value.phase == "prepare" && value.stalled >= 15 {
        format!("{phase} · выполняется {} с", value.stalled)
    } else {
        phase
    };
    Some(Update {
        key: value.id,
        text,
        downloaded: (value.phase == "download").then_some(value.downloaded),
        total: if value.phase == "download" {
            value.total.filter(|n| *n > 0)
        } else {
            None
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn line(total: serde_json::Value, phase: &str, stalled: u64) -> String {
        format!(
            "{PREFIX}{}",
            serde_json::json!({"v":1,"id":"123456781234123412341234567890ab",
            "component":"lvgl/lvgl","version":"9.2.2","phase":phase,"kind":"archive",
            "downloaded":8_400_000,"total":total,"speed":320_000.0,"stalled":stalled,"complete":false})
        )
    }
    #[test]
    fn known_and_unknown_sizes_are_reported_honestly() {
        let known = parse(&line(serde_json::json!(15_200_000), "download", 0)).unwrap();
        assert_eq!(
            known.text,
            "Загрузка lvgl/lvgl 9.2.2: 8,4 МБ / 15,2 МБ · 55% · 320 КБ/с"
        );
        let unknown = parse(&line(serde_json::Value::Null, "download", 0)).unwrap();
        assert!(!unknown.text.contains('%'));
        assert!(unknown.text.contains("8,4 МБ · 320 КБ/с"));
        assert!(parse(&line(serde_json::json!(0), "download", 0))
            .unwrap()
            .total
            .is_none());
    }
    #[test]
    fn stall_and_real_stages_have_separate_messages() {
        assert!(parse(&line(serde_json::Value::Null, "download", 17))
            .unwrap()
            .text
            .contains("данные не поступают 17 с"));
        assert!(parse(&line(serde_json::Value::Null, "prepare", 17))
            .unwrap()
            .text
            .contains("выполняется 17 с"));
        let unpack = parse(&line(serde_json::Value::Null, "unpack", 17)).unwrap();
        assert!(unpack.text.starts_with("Распаковка"));
        assert!(!unpack.text.contains("не поступают"));
        assert!(unpack.downloaded.is_none());
        assert!(parse(&line(serde_json::Value::Null, "unknown", 0)).is_none());
        assert!(parse("NOTICE: [1/2] lvgl/lvgl (9.2.2)").is_none());
    }
    #[test]
    fn only_private_build_hooks_are_written_and_existing_python_path_is_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let mut command = Command::new("python");
        let previous = dir.path().join("existing packages");
        command.env("PYTHONPATH", &previous);
        configure(&mut command, dir.path()).unwrap();
        let paths = command
            .get_envs()
            .find(|(key, _)| *key == "PYTHONPATH")
            .unwrap()
            .1
            .unwrap();
        assert_eq!(
            env::split_paths(paths).collect::<Vec<_>>(),
            vec![dir.path().join("component-progress"), previous]
        );
        assert!(dir
            .path()
            .join("component-progress/sitecustomize.py")
            .is_file());
    }
}
