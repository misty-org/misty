use std::{
    env, fs,
    path::{Component, Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::artifacts::write_private;

const LAYOUT_VERSION: u32 = 1;

const REQUIRED_DIRECTORIES: &[&str] = &[
    ".cache",
    ".cache/remotes",
    ".cache/sessions",
    ".cache/trash",
    ".local/bin",
    "assets",
    "assets/notes",
    "cloud",
    "config",
    "config/automations/v1",
    "config/sessions",
    "db",
    "mnt",
    "plugins/private",
    "plugins/public",
    "restic/passwords",
    "tmp/downloads",
    "tmp/transfers",
];

const PORTABLE_ASSET_TREES: &[&str] =
    &["animations", "claude", "fonts", "icons", "logos", "themes"];

const LEGACY_PATHS: &[&str] = &[
    ".local/bin/misty-proxy",
    ".profiles",
    ".release",
    ".template",
    "assets/logos/old",
    "config/file_sidebar.json",
    "config/imgui.ini",
    "db/misty.db",
    "forms",
    "local",
    "logs",
    "public",
    "rclone",
    "scripts",
    "workflows",
];

const PRIVATE_FILES: &[&str] = &[
    "cloud/connections.json",
    "config/jwt.secret",
    "config/misty.json",
    "config/settings.json",
    "config/workspaces.json",
    "db/data.db",
    "db/token.key",
    "home.json",
];

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct HomeManifest {
    format: String,
    layout_version: u32,
}

#[derive(Debug, Default)]
struct CopyReport {
    copied: usize,
    preserved: usize,
}

pub fn default_root() -> Result<PathBuf> {
    let data_root = env::var_os("MISTY_DESKTOP_DATA_ROOT")
        .or_else(|| env::var_os("MISTY_DATA_ROOT"))
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
        .context("could not locate the user home directory")?;
    Ok(data_root.join(".misty"))
}

pub fn generate(destination: Option<&Path>, source: Option<&Path>) -> Result<()> {
    let destination = absolute(
        destination
            .map(Path::to_path_buf)
            .unwrap_or(default_root()?),
    )?;
    let source = source
        .map(|path| absolute(path.to_path_buf()))
        .transpose()?;

    secure_directory(&destination)?;
    for relative in REQUIRED_DIRECTORIES {
        secure_directory(&destination.join(relative))?;
    }

    write_if_missing(&destination.join("home.json"), &manifest_bytes()?)?;
    write_if_missing(
        &destination.join("config/misty.json"),
        b"{\n  \"server\": {\n    \"mode\": \"hosted\"\n  }\n}\n",
    )?;

    let mut report = CopyReport::default();
    if let Some(source) = source.as_deref() {
        if !same_path(source, &destination) {
            copy_portable_payload(source, &destination, &mut report)?;
        }
    }
    secure_known_files(&destination)?;

    println!("Misty home is ready at {}.", destination.display());
    if source.is_some() {
        println!(
            "Copied {} portable file(s); preserved {} existing file(s).",
            report.copied, report.preserved
        );
    }
    println!("Device state, credentials, notes, mounts, caches, and binaries were not copied.");
    Ok(())
}

pub fn check(path: Option<&Path>) -> Result<()> {
    let root = absolute(path.map(Path::to_path_buf).unwrap_or(default_root()?))?;
    let mut problems = Vec::new();

    if !root.is_dir() {
        bail!("Misty home does not exist at {}", root.display());
    }
    for relative in REQUIRED_DIRECTORIES {
        if !root.join(relative).is_dir() {
            problems.push(format!("missing directory: {relative}"));
        }
    }
    check_manifest(&root, &mut problems);
    for relative in LEGACY_PATHS {
        if root.join(relative).exists() {
            problems.push(format!("legacy path: {relative}"));
        }
    }
    check_permissions(&root, &mut problems)?;

    if problems.is_empty() {
        println!(
            "Misty home layout v{LAYOUT_VERSION} is ready at {}.",
            root.display()
        );
        return Ok(());
    }
    for problem in &problems {
        eprintln!("- {problem}");
    }
    bail!("Misty home has {} issue(s)", problems.len())
}

fn copy_portable_payload(source: &Path, destination: &Path, report: &mut CopyReport) -> Result<()> {
    if !source.is_dir() {
        bail!("Misty home source does not exist: {}", source.display());
    }
    for tree in PORTABLE_ASSET_TREES {
        let source_tree = source.join("assets").join(tree);
        if source_tree.is_dir() {
            copy_missing_tree(
                &source_tree,
                &destination.join("assets").join(tree),
                false,
                report,
            )?;
        }
    }
    for tree in ["plugins/public", "plugins/private"] {
        let source_tree = source.join(tree);
        if source_tree.is_dir() {
            copy_missing_tree(&source_tree, &destination.join(tree), true, report)?;
        }
    }
    Ok(())
}

fn copy_missing_tree(
    source: &Path,
    destination: &Path,
    portable_plugins_only: bool,
    report: &mut CopyReport,
) -> Result<()> {
    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry?;
        let relative = entry.path().strip_prefix(source)?;
        if ignored_relative(relative, portable_plugins_only, entry.file_type().is_file()) {
            continue;
        }
        let target = destination.join(relative);
        if entry.file_type().is_dir() {
            secure_directory(&target)?;
        } else if entry.file_type().is_file() {
            if target.exists() {
                report.preserved += 1;
                continue;
            }
            if let Some(parent) = target.parent() {
                secure_directory(parent)?;
            }
            fs::copy(entry.path(), &target).with_context(|| {
                format!(
                    "could not copy portable file {} to {}",
                    entry.path().display(),
                    target.display()
                )
            })?;
            report.copied += 1;
        }
    }
    Ok(())
}

fn ignored_relative(path: &Path, portable_plugins_only: bool, is_file: bool) -> bool {
    if path.components().any(|component| {
        matches!(component, Component::Normal(name) if matches!(name.to_str(), Some(".DS_Store" | "Thumbs.db" | "desktop.ini" | "old" | "variants")))
    }) {
        return true;
    }
    if !portable_plugins_only || !is_file {
        return false;
    }
    !matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some(
            "css"
                | "gif"
                | "html"
                | "jpeg"
                | "jpg"
                | "js"
                | "json"
                | "map"
                | "md"
                | "png"
                | "svg"
                | "ttf"
                | "webp"
                | "woff"
                | "woff2"
        )
    )
}

fn check_manifest(root: &Path, problems: &mut Vec<String>) {
    let path = root.join("home.json");
    let Ok(contents) = fs::read_to_string(&path) else {
        problems.push("missing or unreadable home.json".to_owned());
        return;
    };
    match serde_json::from_str::<HomeManifest>(&contents) {
        Ok(manifest)
            if manifest.format == "misty-home" && manifest.layout_version == LAYOUT_VERSION => {}
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
        layout_version: LAYOUT_VERSION,
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
    for relative in PRIVATE_FILES {
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
        for relative in PRIVATE_FILES {
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

fn same_path(left: &Path, right: &Path) -> bool {
    let left = left.to_string_lossy();
    let right = right.to_string_lossy();
    if cfg!(windows) {
        left.eq_ignore_ascii_case(&right)
    } else {
        left == right
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generation_is_idempotent_and_excludes_device_state() {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source/.misty");
        let destination = temporary.path().join("output/.misty");
        for (path, contents) in [
            ("assets/icons/cloud.svg", "icon"),
            ("assets/logos/old/retired.png", "old"),
            ("assets/notes/account/note/private.png", "private"),
            ("plugins/private/themes/plugin.json", "{}"),
            ("plugins/private/themes/variants/plugin.dylib", "native"),
            ("db/data.db", "state"),
            ("config/jwt.secret", "secret"),
        ] {
            let path = source.join(path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, contents).unwrap();
        }

        generate(Some(&destination), Some(&source)).unwrap();
        generate(Some(&destination), Some(&source)).unwrap();

        assert!(destination.join("assets/icons/cloud.svg").is_file());
        assert!(destination
            .join("plugins/private/themes/plugin.json")
            .is_file());
        assert!(!destination.join("assets/logos/old").exists());
        assert!(!destination.join("assets/notes/account").exists());
        assert!(!destination.join("plugins/private/themes/variants").exists());
        assert!(!destination.join("db/data.db").exists());
        assert!(!destination.join("config/jwt.secret").exists());
        check(Some(&destination)).unwrap();
    }

    #[test]
    fn check_rejects_legacy_layout_entries() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join(".misty");
        generate(Some(&root), None).unwrap();
        fs::create_dir_all(root.join("rclone")).unwrap();
        assert!(check(Some(&root)).is_err());
    }
}
