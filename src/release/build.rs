use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use walkdir::WalkDir;

use crate::{
    artifacts,
    process::{npm, CommandSpec},
    workspace::Workspace,
};

use super::{model::ReleaseManifest, state};

pub(super) fn platform(
    workspace: &Workspace,
    release: &ReleaseManifest,
    platform: &str,
    config_path: &Path,
) -> Result<()> {
    let arguments = if platform == "macos-universal" {
        vec![
            "run",
            "tauri",
            "--",
            "build",
            "--bundles",
            "app,dmg",
            "--target",
            "universal-apple-darwin",
            "--config",
        ]
    } else {
        vec![
            "run",
            "tauri",
            "--",
            "build",
            "--bundles",
            "nsis",
            "--config",
        ]
    };
    CommandSpec::new(npm())
        .args(arguments)
        .arg(config_path.as_os_str())
        .arg("--ci")
        .run(&workspace.misty)?;
    let bundle = if platform == "macos-universal" {
        workspace
            .misty
            .join("src-tauri/target/universal-apple-darwin/release/bundle")
    } else {
        workspace.misty.join("src-tauri/target/release/bundle")
    };
    if platform == "macos-universal" {
        verify_macos_bundle(workspace, &bundle)?;
    }
    let destination = state::release_root(workspace, &release.version).join(platform);
    if destination.exists() {
        std::fs::remove_dir_all(&destination)?;
    }
    std::fs::create_dir_all(&destination)?;
    let selected = select_artifacts(&bundle, platform)?;
    for path in &selected {
        std::fs::copy(
            path,
            destination.join(path.file_name().context("artifact has no file name")?),
        )?;
    }
    let (updater, signature) = updater_pair(&destination, platform)?;
    let manifest = super::model::PlatformManifest::from_files(
        release,
        platform,
        &destination,
        updater,
        signature,
    )?;
    manifest.write(&destination.join(format!("release-{platform}.json")))?;
    artifacts::write_checksums(&destination)?;
    println!("Built {platform} artifacts in {}", destination.display());
    Ok(())
}

fn verify_macos_bundle(workspace: &Workspace, bundle: &Path) -> Result<()> {
    let app = WalkDir::new(bundle)
        .into_iter()
        .filter_map(Result::ok)
        .find(|entry| {
            entry.file_type().is_dir() && entry.path().extension().is_some_and(|e| e == "app")
        })
        .map(|entry| entry.into_path())
        .context("universal macOS app bundle was not produced")?;
    let executable = std::fs::read_dir(app.join("Contents/MacOS"))?
        .filter_map(Result::ok)
        .find(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .map(|entry| entry.path())
        .context("macOS app bundle has no executable")?;
    let architectures = CommandSpec::new("lipo")
        .args(["-archs"])
        .arg(executable.as_os_str())
        .capture(&workspace.misty)?;
    if !architectures.contains("arm64") || !architectures.contains("x86_64") {
        bail!(
            "macOS release binary is not universal: {}",
            architectures.trim()
        );
    }
    CommandSpec::new("codesign")
        .args(["--verify", "--deep", "--strict", "--verbose=2"])
        .arg(app.as_os_str())
        .run(&workspace.misty)?;
    CommandSpec::new("spctl")
        .args(["--assess", "--type", "execute", "--verbose=4"])
        .arg(app.as_os_str())
        .run(&workspace.misty)?;
    if let Some(dmg) = find_extension(bundle, "dmg") {
        CommandSpec::new("xcrun")
            .args(["stapler", "validate"])
            .arg(dmg.as_os_str())
            .run(&workspace.misty)?;
    }
    Ok(())
}

fn select_artifacts(bundle: &Path, platform: &str) -> Result<Vec<PathBuf>> {
    let extensions: &[&str] = if platform == "macos-universal" {
        &["dmg", "gz", "sig"]
    } else {
        &["exe", "sig"]
    };
    let files = artifacts::files_under(bundle)?
        .into_iter()
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extensions.contains(&extension))
        })
        .collect::<Vec<_>>();
    if files.is_empty() {
        bail!(
            "no {platform} release artifacts were found under {}",
            bundle.display()
        );
    }
    Ok(files)
}

fn updater_pair(root: &Path, platform: &str) -> Result<(String, String)> {
    let files = artifacts::files_under(root)?;
    let updater = files
        .iter()
        .find(|path| {
            if platform == "macos-universal" {
                path.to_string_lossy().ends_with(".app.tar.gz")
            } else {
                path.extension().is_some_and(|extension| extension == "exe")
            }
        })
        .context("updater artifact was not produced")?;
    let signature = files
        .iter()
        .find(|path| {
            path.file_name().is_some_and(|name| {
                name.to_string_lossy()
                    == format!("{}.sig", updater.file_name().unwrap().to_string_lossy())
            })
        })
        .context("updater signature was not produced")?;
    Ok((
        updater.file_name().unwrap().to_string_lossy().into_owned(),
        signature
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned(),
    ))
}

pub(super) fn current_platform() -> Result<&'static str> {
    if cfg!(target_os = "macos") {
        Ok("macos-universal")
    } else if cfg!(windows) {
        Ok("windows-x86_64")
    } else {
        bail!("desktop releases must be built on macOS or Windows")
    }
}

fn find_extension(root: &Path, extension: &str) -> Option<PathBuf> {
    WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .find(|entry| {
            entry.file_type().is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|value| value == extension)
        })
        .map(|entry| entry.into_path())
}
