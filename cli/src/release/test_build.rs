//! A build to try on this computer: the release's app, with no certificate, updater key or
//! upload. Its installer is what `misty build` hands over.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::{
    process::{npm, CommandSpec},
    workspace::Workspace,
};

use super::config;

/// The website the app links to, when `MISTY_RELEASE_WEB_URL` doesn't name another.
const DEFAULT_WEBSITE: &str = "https://mistysys.com";

pub fn run(workspace: &Workspace) -> Result<PathBuf> {
    workspace.validate()?;
    let temporary = tempfile::Builder::new()
        .prefix("misty-test-build-")
        .tempdir()?;
    let config_path = temporary.path().join("tauri.test.conf.json");
    std::fs::write(
        &config_path,
        serde_json::to_vec_pretty(&config::test_build())?,
    )?;
    let website =
        std::env::var("MISTY_RELEASE_WEB_URL").unwrap_or_else(|_| DEFAULT_WEBSITE.to_owned());
    let mut command = CommandSpec::new(npm())
        .args(["run", "tauri", "--", "build"])
        .args(bundle_arguments())
        .arg("--config")
        .arg(config_path.as_os_str())
        .arg("--ci")
        .env("MISTY_PUBLIC_URL", website);
    // A stable identity keeps Keychain access between test builds on macOS.
    if let Ok(identity) = std::env::var("MISTY_DEV_SIGNING_IDENTITY") {
        command = command.env("APPLE_SIGNING_IDENTITY", identity);
    }
    command.run(&workspace.misty)?;
    built_app(&workspace.misty.join("src-tauri/target/release"))
}

fn bundle_arguments() -> &'static [&'static str] {
    if cfg!(windows) {
        &["--bundles", "nsis"]
    } else if cfg!(target_os = "macos") {
        &["--bundles", "app"]
    } else {
        &["--no-bundle"]
    }
}

fn built_app(output: &Path) -> Result<PathBuf> {
    let (folder, extension) = if cfg!(windows) {
        (output.join("bundle/nsis"), "exe")
    } else if cfg!(target_os = "macos") {
        (output.join("bundle/macos"), "app")
    } else {
        return Ok(output.join("misty-desktop"));
    };
    newest_with_extension(&folder, extension)
        .with_context(|| format!("the build left no .{extension} in {}", folder.display()))
}

/// Earlier versions' installers stay in the folder, so the newest is this build's.
fn newest_with_extension(folder: &Path, extension: &str) -> Option<PathBuf> {
    std::fs::read_dir(folder)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|value| value == extension))
        .max_by_key(|path| path.metadata().and_then(|file| file.modified()).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_this_builds_installer_over_older_ones() {
        let folder = tempfile::tempdir().unwrap();
        assert_eq!(newest_with_extension(folder.path(), "exe"), None);
        std::fs::write(folder.path().join("Misty_0.1.0_x64-setup.exe"), "").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let newest = folder.path().join("Misty_0.2.0_x64-setup.exe");
        std::fs::write(&newest, "").unwrap();
        std::fs::write(folder.path().join("notes.txt"), "").unwrap();
        assert_eq!(newest_with_extension(folder.path(), "exe"), Some(newest));
    }
}
