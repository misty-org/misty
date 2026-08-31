use std::{
    env, fs,
    net::TcpListener,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use serde_json::json;
use walkdir::WalkDir;

use crate::{
    artifacts,
    process::{npm, CommandSpec},
    workspace::Workspace,
};

pub fn dev(workspace: &Workspace, profile: Option<&str>, route: Option<&str>) -> Result<()> {
    validate_profile(profile)?;
    validate_route(route)?;
    let port = available_port(
        env::var("MISTY_DESKTOP_DEV_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(5173),
    )?;
    let route = route
        .map(str::to_owned)
        .or_else(|| env::var("MISTY_DESKTOP_INITIAL_ROUTE").ok())
        .unwrap_or_default();
    validate_route((!route.is_empty()).then_some(route.as_str()))?;

    let temporary = tempfile::Builder::new()
        .prefix("misty-tauri-dev-")
        .tempdir()?;
    let config_path = temporary.path().join("tauri.dev.conf.json");
    let mut config = json!({
        "build": {
            "devUrl": format!("http://127.0.0.1:{port}{route}"),
            "beforeDevCommand": "npm run dev:desktop"
        }
    });
    if let Some(profile) = profile {
        config["productName"] = json!(format!("Misty {profile}"));
        config["identifier"] = json!(format!("com.misty.desktop.{profile}"));
    }
    fs::write(&config_path, serde_json::to_vec_pretty(&config)?)?;

    let mut command = CommandSpec::new(npm())
        .args(["run", "tauri", "--", "dev", "--config"])
        .arg(config_path.as_os_str())
        .env("MISTY_DESKTOP_DEV_PORT", port.to_string());
    if let Some(profile) = profile {
        let profile_root = crate::home::default_root()?
            .join("cli/profiles")
            .join(profile);
        fs::create_dir_all(&profile_root)?;
        command = command
            .env("MISTY_PROFILE", profile)
            .env("MISTY_DESKTOP_PROFILE", profile)
            .env("MISTY_PROFILE_DIR", profile_root.as_os_str());
    }
    command.run(&workspace.misty)
}

pub fn build(workspace: &Workspace) -> Result<()> {
    CommandSpec::new(npm())
        .args(["run", "tauri", "--", "build"])
        .run(&workspace.misty)
}

pub fn clean(workspace: &Workspace, apply: bool) -> Result<()> {
    let root = &workspace.misty;
    let mut candidates = vec![
        "dist",
        "build",
        ".vite",
        "node_modules/.vite",
        "design-qa",
        "design-qa-output",
        "artifacts/design-qa",
        "src-tauri/target",
        "src-tauri/gen/apple/build",
        "src-tauri/gen/apple/DerivedData",
        "src-tauri/gen/apple/Externals",
        "src-tauri/gen/apple/Pods",
        "src-tauri/gen/android/.gradle",
    ]
    .into_iter()
    .map(|path| root.join(path))
    .collect::<Vec<_>>();
    collect_named(root, ".DS_Store", false, &mut candidates);
    collect_named(
        &root.join("src-tauri/gen/android"),
        "build",
        true,
        &mut candidates,
    );
    candidates.sort();
    candidates.dedup();

    for path in candidates.into_iter().filter(|path| path.exists()) {
        let relative = safe_relative(root, &path)?;
        if apply {
            if path.is_dir() {
                fs::remove_dir_all(&path)?;
            } else {
                fs::remove_file(&path)?;
            }
            println!("removed {relative}");
        } else {
            println!("would remove {relative}");
        }
    }
    if !apply {
        println!("Run again with --apply to remove these generated files.");
    }
    Ok(())
}

pub fn stage_windows_assets(
    workspace: &Workspace,
    source: Option<&Path>,
    destination: Option<&Path>,
) -> Result<()> {
    let source = source
        .map(Path::to_path_buf)
        .unwrap_or(default_asset_root()?);
    let destination = destination
        .map(Path::to_path_buf)
        .unwrap_or_else(|| workspace.misty.join(".windows-test/.misty/assets"));
    let copied = artifacts::copy_tree(&source, &destination)?;
    println!("Staged {copied} asset files at {}", destination.display());
    Ok(())
}

pub fn sync_icons(workspace: &Workspace, source: Option<&Path>) -> Result<()> {
    let source = source
        .map(Path::to_path_buf)
        .unwrap_or(default_asset_root()?.join("icons/misty-logo.icns"));
    let contents = fs::read(&source)
        .with_context(|| format!("could not read app icon {}", source.display()))?;
    let png = largest_png_variant(&contents)?;
    let temporary = tempfile::Builder::new().prefix("misty-icons-").tempdir()?;
    let master = temporary.path().join("misty-icon.png");
    fs::write(&master, png)?;
    CommandSpec::new(npm())
        .args(["run", "tauri", "--", "icon"])
        .arg(master.as_os_str())
        .run(&workspace.misty)?;
    fs::copy(&source, workspace.misty.join("src-tauri/icons/icon.icns"))?;
    println!("Desktop icons are synchronized.");
    Ok(())
}

fn default_asset_root() -> Result<PathBuf> {
    Ok(dirs::home_dir()
        .context("could not locate home directory")?
        .join(".misty/assets"))
}

fn validate_profile(profile: Option<&str>) -> Result<()> {
    let Some(profile) = profile else {
        return Ok(());
    };
    let valid = regex::Regex::new(r"^[a-z0-9][a-z0-9-]{0,31}$")?;
    if !valid.is_match(profile) {
        bail!("profile names must use 1-32 lowercase letters, numbers, or hyphens");
    }
    Ok(())
}

fn validate_route(route: Option<&str>) -> Result<()> {
    let Some(route) = route else {
        return Ok(());
    };
    if !route.starts_with('/') || route.starts_with("//") || route.contains("://") {
        bail!("desktop route must be an absolute in-app path");
    }
    Ok(())
}

fn available_port(start: u16) -> Result<u16> {
    for port in start..start.saturating_add(50) {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    bail!("no available desktop dev port found from {start}");
}

fn safe_relative(root: &Path, path: &Path) -> Result<String> {
    let relative = path
        .strip_prefix(root)
        .with_context(|| format!("cleanup path escaped repository: {}", path.display()))?;
    let label = relative.to_string_lossy().replace('\\', "/");
    if label.is_empty()
        || label == "node_modules"
        || label.contains(".env")
        || label.to_ascii_lowercase().contains("signing")
    {
        bail!("refusing unsafe cleanup path: {label}");
    }
    Ok(label)
}

fn collect_named(root: &Path, name: &str, directories: bool, output: &mut Vec<PathBuf>) {
    if !root.exists() {
        return;
    }
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            !matches!(
                entry.file_name().to_str(),
                Some(".git" | "node_modules" | "target")
            )
        })
        .filter_map(Result::ok)
    {
        if entry.file_name() == name
            && ((directories && entry.file_type().is_dir())
                || (!directories && entry.file_type().is_file()))
        {
            output.push(entry.into_path());
        }
    }
}

fn largest_png_variant(icns: &[u8]) -> Result<&[u8]> {
    if icns.len() < 8 || &icns[..4] != b"icns" {
        bail!("source is not an ICNS file");
    }
    let preferred = [
        b"ic10", b"ic14", b"ic09", b"ic13", b"ic08", b"ic07", b"ic12", b"ic11",
    ];
    let mut variants = Vec::new();
    let mut offset = 8;
    while offset + 8 <= icns.len() {
        let kind = &icns[offset..offset + 4];
        let length = u32::from_be_bytes(icns[offset + 4..offset + 8].try_into()?) as usize;
        if length < 8 || offset + length > icns.len() {
            break;
        }
        variants.push((kind, &icns[offset + 8..offset + length]));
        offset += length;
    }
    for expected in preferred {
        if let Some((_, data)) = variants
            .iter()
            .find(|(kind, data)| *kind == expected && data.starts_with(b"\x89PNG\r\n\x1a\n"))
        {
            return Ok(data);
        }
    }
    bail!("ICNS file has no supported PNG variant")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_profiles_and_routes() {
        assert!(validate_profile(Some("owner-2")).is_ok());
        assert!(validate_profile(Some("../owner")).is_err());
        assert!(validate_route(Some("/spaces/demo")).is_ok());
        assert!(validate_route(Some("https://example.com")).is_err());
    }

    #[test]
    fn cleanup_refuses_repository_root() {
        let root = Path::new("/tmp/misty");
        assert!(safe_relative(root, root).is_err());
    }
}
