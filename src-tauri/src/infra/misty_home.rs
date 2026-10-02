//! Creates and maintains `~/.misty` on every launch.
//!
//! The home lives outside the app bundle, so installing or updating Misty never
//! replaces it. This module only ever adds what is missing and tightens
//! permissions; it never deletes. Paths retired by an earlier layout are moved
//! to the Trash so the user can still recover them.
use crate::infra::paths;
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

const LAYOUT_JSON: &str = include_str!("../../misty-home-layout.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Layout {
    layout_version: u32,
    directories: Vec<String>,
    private_files: Vec<String>,
    retired: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HomeManifest {
    format: String,
    layout_version: u32,
}

#[derive(Debug, Default)]
pub struct HomeReport {
    pub created: Vec<String>,
    pub retired: Vec<String>,
    /// Retired paths that could not be moved and were left in place.
    pub kept: Vec<String>,
}

fn layout() -> Layout {
    serde_json::from_str(LAYOUT_JSON).expect("misty-home-layout.json is valid")
}

/// Ensures the signed-in user's Misty home exists and matches the current layout.
pub fn ensure_misty_home() -> io::Result<HomeReport> {
    let root = paths::misty_home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no home directory"))?;
    ensure_at(&root, &trash_dir())
}

fn ensure_at(root: &Path, trash: &Path) -> io::Result<HomeReport> {
    let layout = layout();
    let mut report = HomeReport::default();
    secure_dir(root, &mut report, "")?;

    if manifest_version(root) < layout.layout_version {
        retire(root, &layout.retired, trash, &mut report)?;
    }
    for relative in &layout.directories {
        secure_dir(&root.join(relative), &mut report, relative)?;
    }
    #[cfg(unix)]
    for relative in &layout.private_files {
        use std::os::unix::fs::PermissionsExt;
        let path = root.join(relative);
        if path.is_file() {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        }
    }
    if manifest_version(root) != layout.layout_version {
        let manifest = HomeManifest {
            format: "misty-home".to_owned(),
            layout_version: layout.layout_version,
        };
        let mut bytes = serde_json::to_vec_pretty(&manifest)?;
        bytes.push(b'\n');
        write_private(&root.join("home.json"), &bytes)?;
    }
    Ok(report)
}

fn manifest_version(root: &Path) -> u32 {
    fs::read(root.join("home.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<HomeManifest>(&bytes).ok())
        .filter(|manifest| manifest.format == "misty-home")
        .map_or(0, |manifest| manifest.layout_version)
}

fn retire(
    root: &Path,
    retired: &[String],
    trash: &Path,
    report: &mut HomeReport,
) -> io::Result<()> {
    let present: Vec<&String> = retired
        .iter()
        .filter(|relative| root.join(relative).symlink_metadata().is_ok())
        .collect();
    if present.is_empty() {
        return Ok(());
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d %H.%M.%S");
    let destination = trash.join(format!("Misty retired files {stamp}"));
    for relative in present {
        let target = destination.join(relative);
        let moved = target
            .parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|_| fs::rename(root.join(relative), &target));
        // A cross-volume Trash cannot take a rename; leave the path rather than
        // copy-and-delete user data.
        match moved {
            Ok(()) => report.retired.push(relative.clone()),
            Err(_) => report.kept.push(relative.clone()),
        }
    }
    Ok(())
}

fn trash_dir() -> PathBuf {
    let home = paths::misty_data_root().unwrap_or_default();
    if cfg!(target_os = "macos") {
        home.join(".Trash")
    } else {
        // No portable user Trash without a desktop service; keep retired paths
        // inside the home so they stay recoverable and out of the live layout.
        home.join(".misty").join(".retired")
    }
}

fn secure_dir(path: &Path, report: &mut HomeReport, relative: &str) -> io::Result<()> {
    if !path.is_dir() {
        fs::create_dir_all(path)?;
        if !relative.is_empty() {
            report.created.push(relative.to_owned());
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let staging = path.with_extension("json.tmp");
    fs::write(&staging, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&staging, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(staging, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "misty-home-{label}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn creates_a_fresh_home_with_the_current_layout() {
        let base = temp("fresh");
        let root = base.join(".misty");
        let report = ensure_at(&root, &base.join("Trash")).unwrap();

        for relative in layout().directories {
            assert!(root.join(&relative).is_dir(), "{relative}");
        }
        assert_eq!(manifest_version(&root), layout().layout_version);
        assert!(report.retired.is_empty());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn keeps_user_data_and_moves_only_retired_paths_to_trash() {
        let base = temp("upgrade");
        let root = base.join(".misty");
        let trash = base.join("Trash");
        fs::create_dir_all(root.join("plugins/public")).unwrap();
        fs::create_dir_all(root.join(".keys")).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join(".keys/misty-backup.agekey"), "key").unwrap();
        fs::write(root.join("config/settings.json"), "{}").unwrap();
        fs::write(
            root.join("home.json"),
            r#"{"format":"misty-home","layoutVersion":1}"#,
        )
        .unwrap();

        let report = ensure_at(&root, &trash).unwrap();

        assert_eq!(report.retired, vec!["plugins".to_owned()]);
        assert!(!root.join("plugins").exists());
        assert!(root.join(".keys/misty-backup.agekey").is_file());
        assert!(root.join("config/settings.json").is_file());
        let moved = fs::read_dir(&trash)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert!(moved.join("plugins/public").is_dir());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn is_idempotent_and_leaves_current_homes_alone() {
        let base = temp("repeat");
        let root = base.join(".misty");
        let trash = base.join("Trash");
        ensure_at(&root, &trash).unwrap();
        // A path that looks retired but appears after the upgrade is not touched.
        fs::create_dir_all(root.join("notes")).unwrap();

        let report = ensure_at(&root, &trash).unwrap();

        assert!(report.created.is_empty());
        assert!(report.retired.is_empty());
        assert!(root.join("notes").is_dir());
        assert!(!trash.exists());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn recreates_folders_removed_since_the_last_launch() {
        let base = temp("recreate");
        let root = base.join(".misty");
        ensure_at(&root, &base.join("Trash")).unwrap();
        fs::remove_dir_all(root.join("tmp")).unwrap();

        let report = ensure_at(&root, &base.join("Trash")).unwrap();

        assert!(report.created.contains(&"tmp/downloads".to_owned()));
        assert!(root.join("tmp/transfers").is_dir());
        let _ = fs::remove_dir_all(base);
    }
}
