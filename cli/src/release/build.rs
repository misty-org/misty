use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use walkdir::WalkDir;

use crate::{
    artifacts,
    process::{npm, CommandSpec},
    workspace::Workspace,
};

use super::{
    model::{
        cross_target, ReleaseManifest, LINUX_PLATFORM, MACOS_PLATFORM, WINDOWS_ARM_PLATFORM,
        WINDOWS_PLATFORM,
    },
    state,
};

pub(super) fn platform(
    workspace: &Workspace,
    release: &ReleaseManifest,
    platform: &str,
    config_path: &Path,
) -> Result<()> {
    let bundles = match platform {
        MACOS_PLATFORM => "app,dmg",
        LINUX_PLATFORM => "appimage,deb,rpm",
        _ => "nsis",
    };
    let mut arguments = vec!["run", "tauri", "--", "build", "--bundles", bundles];
    if let Some(target) = cross_target(platform) {
        arguments.extend(["--target", target]);
    }
    arguments.push("--config");
    CommandSpec::new(npm())
        .args(arguments)
        .arg(config_path.as_os_str())
        .arg("--ci")
        .run(&workspace.misty)?;
    let output = match cross_target(platform) {
        Some(target) => workspace.misty.join("src-tauri/target").join(target),
        None => workspace.misty.join("src-tauri/target"),
    }
    .join("release");
    let bundle = output.join("bundle");
    if platform == MACOS_PLATFORM {
        notarize_macos_bundle(workspace, &bundle)?;
        verify_macos_bundle(workspace, &bundle)?;
        archive_stapled_app(workspace, &bundle)?;
    } else if platform == LINUX_PLATFORM {
        // Repacking changes the AppImage after Tauri signed it for the updater; sign it again.
        if let Some(appimage) = super::appimage::prune_bundle(&bundle)? {
            let mut signature = appimage.clone().into_os_string();
            signature.push(".sig");
            let _ = std::fs::remove_file(&signature);
            sign_updater(workspace, &appimage)?;
        }
    } else {
        super::windows_signing::verify(workspace, &output)?;
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
    let checksums = artifacts::write_checksums(&destination)?;
    std::fs::rename(
        checksums,
        destination.join(format!("SHA256SUMS-{platform}")),
    )?;
    println!("Built {platform} artifacts in {}", destination.display());
    Ok(())
}

// Stapling changes the app after Tauri generated its initial updater archive.
// Ship and sign an archive containing the final, notarized application bytes.
fn archive_stapled_app(workspace: &Workspace, bundle: &Path) -> Result<()> {
    let app = find_app(bundle).context("macOS app bundle was not produced")?;
    let archive = app.with_extension("app.tar.gz");
    CommandSpec::new("tar")
        .arg("-czf")
        .arg(archive.as_os_str())
        .arg("-C")
        .arg(app.parent().context("app parent missing")?.as_os_str())
        .arg(app.file_name().context("app name missing")?)
        .run(&workspace.misty)?;
    sign_updater(workspace, &archive)
}

/// Signs an updater artifact with the release's minisign key, next to it as `<file>.sig`.
fn sign_updater(workspace: &Workspace, artifact: &Path) -> Result<()> {
    let configured_key = std::env::var("TAURI_SIGNING_PRIVATE_KEY")?;
    let key = if Path::new(&configured_key).is_file() {
        std::fs::read_to_string(&configured_key)?
    } else {
        configured_key
    };
    CommandSpec::new(npm())
        .args(["run", "tauri", "--", "signer", "sign"])
        .arg(artifact.as_os_str())
        .env("TAURI_SIGNING_PRIVATE_KEY", key)
        .env_remove("TAURI_SIGNING_PRIVATE_KEY_PATH")
        .run(&workspace.misty)
}

fn notarize_macos_bundle(workspace: &Workspace, bundle: &Path) -> Result<()> {
    let profile = std::env::var("MISTY_NOTARY_KEYCHAIN_PROFILE")
        .unwrap_or_default()
        .trim()
        .to_owned();
    if profile.is_empty() {
        bail!("MISTY_NOTARY_KEYCHAIN_PROFILE is required for a macOS release");
    }
    let app = find_app(bundle).context("macOS app bundle was not produced")?;
    let dmg = find_extension(bundle, "dmg").context("macOS DMG was not produced")?;
    CommandSpec::new("xcrun")
        .args(["notarytool", "submit"])
        .arg(dmg.as_os_str())
        .args(["--keychain-profile", &profile, "--wait"])
        .run(&workspace.misty)?;
    for path in [&app, &dmg] {
        CommandSpec::new("xcrun")
            .args(["stapler", "staple"])
            .arg(path.as_os_str())
            .run(&workspace.misty)?;
    }
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
    let extensions: &[&str] = match platform {
        MACOS_PLATFORM => &["dmg", "gz", "sig"],
        LINUX_PLATFORM => &["AppImage", "deb", "rpm", "sig"],
        _ => &["exe", "sig"],
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
            match platform {
                MACOS_PLATFORM => path.to_string_lossy().ends_with(".app.tar.gz"),
                // Tauri's Linux updater replaces the AppImage in place.
                LINUX_PLATFORM => path.extension().is_some_and(|extension| extension == "AppImage"),
                _ => path.extension().is_some_and(|extension| extension == "exe"),
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

/// The platforms this machine builds: one universal macOS app, Windows
/// for x64 and ARM64, or Linux for x64.
pub(super) fn current_platforms() -> Result<&'static [&'static str]> {
    if cfg!(target_os = "macos") {
        Ok(&[MACOS_PLATFORM])
    } else if cfg!(windows) {
        Ok(&[WINDOWS_PLATFORM, WINDOWS_ARM_PLATFORM])
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Ok(&[LINUX_PLATFORM])
    } else {
        bail!("desktop releases must be built on macOS, Windows or x64 Linux")
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

fn find_app(root: &Path) -> Option<PathBuf> {
    WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .find(|entry| {
            entry.file_type().is_dir()
                && entry.path().extension().is_some_and(|value| value == "app")
        })
        .map(|entry| entry.into_path())
}
