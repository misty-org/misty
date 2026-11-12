// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): its
// scripts/prune-appimage-wayland-libs.mjs.
//! The AppImage's bundled Wayland client libraries crash it on systems whose own libwayland
//! differs from the build machine's, since the system's Mesa and GTK then load against the wrong
//! one. The AppImage is unpacked, its `usr/lib/libwayland-*` removed so the system's are used,
//! and packed again with appimagetool (`MISTY_APPIMAGETOOL`, else `appimagetool` on the PATH).

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use crate::process::CommandSpec;

fn is_wayland_library(name: &str) -> bool {
    name.starts_with("libwayland-")
}

/// The AppImage the build left in `bundle/appimage`, newest first.
pub(super) fn find(bundle: &Path) -> Option<PathBuf> {
    std::fs::read_dir(bundle.join("appimage"))
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "AppImage"))
        .max_by_key(|path| path.metadata().and_then(|file| file.modified()).ok())
}

fn architecture(appimage: &Path) -> &'static str {
    let name = appimage
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name.contains("aarch64") || name.contains("arm64") {
        "aarch64"
    } else {
        "x86_64"
    }
}

/// Removes the bundled Wayland libraries from `appimage` in place. Returns what it removed;
/// the AppImage is left untouched when it bundles none or repacking fails.
pub(super) fn prune_wayland(appimage: &Path) -> Result<Vec<String>> {
    let appimage = appimage
        .canonicalize()
        .with_context(|| format!("AppImage not found: {}", appimage.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&appimage, std::fs::Permissions::from_mode(0o755))?;
    }
    let work = tempfile::Builder::new()
        .prefix("misty-appimage-prune-")
        .tempdir()?;
    CommandSpec::new(appimage.as_os_str())
        .arg("--appimage-extract")
        .env("APPIMAGE_EXTRACT_AND_RUN", "1")
        .run(work.path())?;
    let root = work.path().join("squashfs-root");
    if !root.is_dir() {
        bail!("extracting {} produced no squashfs-root", appimage.display());
    }
    let libraries = root.join("usr/lib");
    let mut removed = Vec::new();
    if libraries.is_dir() {
        for entry in std::fs::read_dir(&libraries)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_wayland_library(&name) {
                let path = entry.path();
                if path.is_dir() {
                    std::fs::remove_dir_all(&path)?;
                } else {
                    std::fs::remove_file(&path)?;
                }
                removed.push(format!("usr/lib/{name}"));
            }
        }
    }
    if removed.is_empty() {
        return Ok(removed);
    }
    removed.sort();
    let tool = std::env::var("MISTY_APPIMAGETOOL").unwrap_or_else(|_| "appimagetool".to_owned());
    let backup = work.path().join("original.AppImage");
    std::fs::copy(&appimage, &backup)?;
    std::fs::remove_file(&appimage)?;
    let packed = CommandSpec::new(&tool)
        .arg(root.as_os_str())
        .arg(appimage.as_os_str())
        .env("ARCH", architecture(&appimage))
        .env("APPIMAGE_EXTRACT_AND_RUN", "1")
        .run(work.path());
    if let Err(error) = packed {
        let _ = std::fs::remove_file(&appimage);
        std::fs::rename(&backup, &appimage)?;
        return Err(error.context(format!(
            "appimagetool ({tool}) couldn't repack the AppImage without its Wayland libraries"
        )));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&appimage, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(removed)
}

/// Prunes the build's AppImage and says what it did.
pub(super) fn prune_bundle(bundle: &Path) -> Result<Option<PathBuf>> {
    let appimage = find(bundle).context("the Linux build produced no AppImage")?;
    let removed = prune_wayland(&appimage)?;
    if removed.is_empty() {
        println!("The AppImage bundles no Wayland libraries.");
        return Ok(None);
    }
    println!(
        "Removed {} bundled Wayland libraries from {}: {}",
        removed.len(),
        appimage.display(),
        removed.join(", ")
    );
    Ok(Some(appimage))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_wayland_client_libraries_are_pruned() {
        for name in [
            "libwayland-client.so.0",
            "libwayland-cursor.so.0.22.0",
            "libwayland-egl.so.1",
        ] {
            assert!(is_wayland_library(name), "{name}");
        }
        for name in ["libgtk-3.so.0", "libwebkit2gtk-4.1.so.0", "wayland-info"] {
            assert!(!is_wayland_library(name), "{name}");
        }
    }

    #[test]
    fn the_architecture_comes_from_the_file_name() {
        assert_eq!(architecture(Path::new("Misty_0.1.0_amd64.AppImage")), "x86_64");
        assert_eq!(architecture(Path::new("Misty_0.1.0_aarch64.AppImage")), "aarch64");
    }
}
