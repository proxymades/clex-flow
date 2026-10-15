use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
};

pub fn unique(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut result = Vec::new();
    for path in paths {
        if !result.contains(&path) {
            result.push(path);
        }
    }
    result
}

pub fn registries(base: &Path) -> Vec<PathBuf> {
    [
        "esp_idf.json",
        "esp-idf.json",
        "eim_idf.json",
        "tools/eim_idf.json",
        "registry/eim_idf.json",
    ]
    .iter()
    .map(|name| base.join(name))
    .collect()
}

// Only inspect known installation/version containers, never recursively crawl a drive.
pub fn roots_in(base: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut queue = VecDeque::from([(base.to_path_buf(), 0)]);
    let mut visited = 0;
    while let Some((path, depth)) = queue.pop_front() {
        visited += 1;
        if visited > 256 {
            break;
        }
        if crate::idf_environment::sdk_version(&path).is_ok() {
            if let Ok(path) = path.canonicalize() {
                if !roots.contains(&path) {
                    roots.push(path);
                }
            }
            continue;
        }
        if depth == 3 {
            continue;
        }
        let Ok(entries) = fs::read_dir(&path) else {
            continue;
        };
        let mut children: Vec<_> = entries
            .flatten()
            .filter(|entry| {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                (name == "frameworks"
                    || name.starts_with("esp-idf")
                    || name.starts_with("esp_idf")
                    || name.as_bytes().first().is_some_and(u8::is_ascii_digit)
                    || name
                        .strip_prefix('v')
                        .is_some_and(|v| v.as_bytes().first().is_some_and(u8::is_ascii_digit)))
                    && entry.file_type().is_ok_and(|kind| kind.is_dir())
            })
            .map(|entry| entry.path())
            .collect();
        children.sort();
        queue.extend(children.into_iter().take(128).map(|path| (path, depth + 1)));
    }
    roots
}

#[cfg(any(windows, test))]
pub fn drive_bases(mask: u32) -> Vec<PathBuf> {
    (0..26)
        .filter(|index| mask & (1 << index) != 0)
        .flat_map(|index| {
            let letter = char::from(b'A' + index as u8);
            [
                PathBuf::from(format!(r"{letter}:\Espressif")),
                PathBuf::from(format!(r"{letter}:\esp")),
            ]
        })
        .collect()
}

pub fn installation_bases(home: &Path) -> Vec<PathBuf> {
    let mut bases = Vec::new();
    for name in ["IDF_TOOLS_PATH", "IDF_PATH"] {
        if let Some(path) = std::env::var_os(name) {
            bases.push(path.into());
        }
    }
    bases.extend([
        home.join(".espressif"),
        home.join(".espressif/tools"),
        home.join(".espressif-s3"),
        home.join("esp"),
    ]);
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetLogicalDrives() -> u32;
        }
        // Includes user-mapped and subst drives, not just C:.
        bases.extend(drive_bases(unsafe { GetLogicalDrives() }));
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            bases.push(PathBuf::from(local).join("Espressif"));
        }
    }
    unique(bases)
}

pub fn related_bases(root: &Path) -> Vec<PathBuf> {
    unique(
        root.ancestors()
            .take(5)
            .filter(|path| path.file_name().is_some())
            .flat_map(|path| [path.to_path_buf(), path.join("tools")]),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sdk(root: &Path) {
        fs::create_dir_all(root.join("components/esp_common/include")).unwrap();
        fs::create_dir_all(root.join("tools")).unwrap();
        fs::write(root.join("components/esp_common/include/esp_idf_version.h"), "#define ESP_IDF_VERSION_MAJOR 5\n#define ESP_IDF_VERSION_MINOR 4\n#define ESP_IDF_VERSION_PATCH 4\n").unwrap();
        fs::write(root.join("tools/idf.py"), "fixture").unwrap();
        fs::write(root.join("tools/idf_tools.py"), "fixture").unwrap();
    }
    #[test]
    fn drive_candidates_include_x_and_do_not_assume_c() {
        assert_eq!(
            drive_bases(1 << 23),
            vec![PathBuf::from(r"X:\Espressif"), PathBuf::from(r"X:\esp")]
        );
        assert!(!drive_bases((1 << 23) | (1 << 25))
            .iter()
            .any(|path| path.to_string_lossy().starts_with("C:")));
    }
    #[test]
    fn finds_installer_frameworks_and_eim_versions_without_scanning_unrelated_folders() {
        let d = tempfile::tempdir().unwrap();
        let base = d.path().join("Espressif - тест");
        let old = base.join("frameworks/esp-idf-v5.4.4");
        let eim = base.join("v5.4.4/esp-idf");
        sdk(&old);
        sdk(&eim);
        sdk(&base.join("unrelated/esp-idf"));
        let found = roots_in(&base);
        assert_eq!(found.len(), 2);
        assert!(found.contains(&old.canonicalize().unwrap()));
        assert!(found.contains(&eim.canonicalize().unwrap()));
        assert_eq!(roots_in(&old), vec![old.canonicalize().unwrap()]);
    }
    #[cfg(windows)]
    #[test]
    fn detects_an_actual_mapped_non_c_drive_without_modifying_existing_drives() {
        use std::process::Command;
        #[link(name = "kernel32")]
        extern "system" {
            fn GetLogicalDrives() -> u32;
        }
        let mask = unsafe { GetLogicalDrives() };
        let index = [23, 24, 25, 22, 21]
            .into_iter()
            .find(|index| mask & (1 << index) == 0)
            .expect("free drive letter for isolated test");
        let letter = format!("{}:", char::from(b'A' + index as u8));
        let d = tempfile::tempdir().unwrap();
        assert!(Command::new("subst")
            .args([std::ffi::OsStr::new(&letter), d.path().as_os_str()])
            .status()
            .unwrap()
            .success());
        struct OwnedDrive(String);
        impl Drop for OwnedDrive {
            fn drop(&mut self) {
                let _ = Command::new("subst").args([&self.0, "/D"]).output();
            }
        }
        let _owned = OwnedDrive(letter.clone());
        let base = PathBuf::from(format!(r"{letter}\Espressif"));
        let root = base.join("frameworks/esp-idf-v5.4.4");
        sdk(&root);
        assert!(installation_bases(&d.path().join("user")).contains(&base));
        assert_eq!(roots_in(&base), vec![root.canonicalize().unwrap()]);
        assert_eq!(crate::idf_environment::sdk_version(&root).unwrap(), "5.4.4");
        assert!(d
            .path()
            .join("Espressif/frameworks/esp-idf-v5.4.4/tools/idf.py")
            .is_file());
    }
}
