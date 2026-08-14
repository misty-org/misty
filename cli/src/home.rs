use std::{
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::artifacts::write_private;

/// Shared with the desktop app, which applies the same layout on every launch.
const LAYOUT_JSON: &str = include_str!("../../src-tauri/misty-home-layout.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Layout {
    layout_version: u32,
    directories: Vec<String>,
    private_files: Vec<String>,
    retired: Vec<String>,
}

fn layout() -> Layout {
    serde_json::from_str(LAYOUT_JSON).expect("misty-home-layout.json is valid")
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct HomeManifest {
    format: String,
    layout_version: u32,
}

pub fn default_root() -> Result<PathBuf> {
    let data_root = env::var_os("MISTY_DESKTOP_DATA_ROOT")
        .or_else(|| env::var_os("MISTY_DATA_ROOT"))
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
        .context("could not locate the user home directory")?;
    Ok(data_root.join(".misty"))
}

pub fn generate(destination: Option<&Path>) -> Result<()> {
    let destination = absolute(
        destination
            .map(Path::to_path_buf)
            .unwrap_or(default_root()?),
    )?;

    secure_directory(&destination)?;
    for relative in &layout().directories {
        secure_directory(&destination.join(relative))?;
    }

    write_if_missing(&destination.join("home.json"), &manifest_bytes()?)?;
    write_if_missing(
        &destination.join("config/misty.json"),
        b"{\n  \"server\": {\n    \"mode\": \"hosted\"\n  }\n}\n",
    )?;
    secure_known_files(&destination)?;

    println!("Misty home is ready at {}.", destination.display());
    Ok(())
}

pub fn check(path: Option<&Path>) -> Result<()> {
    let root = absolute(path.map(Path::to_path_buf).unwrap_or(default_root()?))?;
    let mut problems = Vec::new();

    if !root.is_dir() {
        bail!("Misty home does not exist at {}", root.display());
    }
    for relative in &layout().directories {
        if !root.join(relative).is_dir() {
            problems.push(format!("missing directory: {relative}"));
        }
    }
    check_manifest(&root, &mut problems);
    for relative in &layout().retired {
        if root.join(relative).exists() {
            problems.push(format!("legacy path: {relative}"));
        }
    }
    check_permissions(&root, &mut problems)?;

    if problems.is_empty() {
        println!(
            "Misty home layout v{} is ready at {}.",
            layout().layout_version,
            root.display()
        );
        return Ok(());
    }
    for problem in &problems {
        eprintln!("- {problem}");
    }
    bail!("Misty home has {} issue(s)", problems.len())
}

fn check_manifest(root: &Path, problems: &mut Vec<String>) {
    let path = root.join("home.json");
    let Ok(contents) = fs::read_to_string(&path) else {
        problems.push("missing or unreadable home.json".to_owned());
        return;
    };
    match serde_json::from_str::<HomeManifest>(&contents) {
        Ok(manifest)
            if manifest.format == "misty-home"
                && manifest.layout_version == layout().layout_version => {}
        Ok(manifest) => problems.push(format!(
            "unsupported home manifest: format={}, layoutVersion={}",
            manifest.format, manifest.layout_version
        )),
        Err(_) => problems.push("invalid home.json".to_owned()),
    }
}

fn manifest_bytes() -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(&HomeManifest {
        format: "misty-home".to_owned(),
        layout_version: layout().layout_version,
    })?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn write_if_missing(path: &Path, contents: &[u8]) -> Result<()> {
    if path.exists() {
        return Ok(());
    }
    write_private(path, contents)
}

fn secure_known_files(root: &Path) -> Result<()> {
    #[cfg(unix)]
    for relative in &layout().private_files {
        let path = root.join(relative);
        if path.is_file() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .with_context(|| format!("could not secure {}", path.display()))?;
        }
    }
    Ok(())
}

fn check_permissions(root: &Path, problems: &mut Vec<String>) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let root_mode = fs::metadata(root)?.permissions().mode() & 0o077;
        if root_mode != 0 {
            problems.push("home directory is accessible by group or others".to_owned());
        }
        for relative in &layout().private_files {
            let path = root.join(relative);
            if !path.is_file() {
                continue;
            }
            let mode = fs::metadata(&path)?.permissions().mode() & 0o077;
            if mode != 0 {
                problems.push(format!(
                    "private file is accessible by group or others: {relative}"
                ));
            }
        }
    }
    Ok(())
}

fn secure_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path).with_context(|| format!("could not create {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .with_context(|| format!("could not secure {}", path.display()))?;
    }
    Ok(())
}

fn absolute(path: PathBuf) -> Result<PathBuf> {
    if path.is_absolute() {
        return Ok(path);
    }
    env::current_dir()
        .context("could not read current directory")
        .map(|current| current.join(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generation_is_idempotent() {
        let temporary = tempfile::tempdir().unwrap();
        let destination = temporary.path().join("output/.misty");
        generate(Some(&destination)).unwrap();
        generate(Some(&destination)).unwrap();
        assert!(destination.join("config").is_dir());
        assert!(!destination.join("plugins").exists());
        check(Some(&destination)).unwrap();
    }

    #[test]
    fn check_rejects_legacy_layout_entries() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join(".misty");
        generate(Some(&root)).unwrap();
        fs::create_dir_all(root.join("rclone")).unwrap();
        assert!(check(Some(&root)).is_err());
    }
}
