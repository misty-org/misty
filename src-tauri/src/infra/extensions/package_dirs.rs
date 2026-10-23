//! Where a Space's extension packages live, and which version of each runs.
use super::*;

pub(super) fn account_root(app: &tauri::AppHandle, account: &str) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("extensions")
        .join(identity(account)))
}
/// A Space's packages: `extensions/<account>/<space>`.
pub(super) fn root(app: &tauri::AppHandle, account: &str, space: &str) -> Result<PathBuf, String> {
    if !crate::infra::space_windows::valid_key(space) {
        return Err("Unknown Space.".into());
    }
    Ok(account_root(app, account)?.join(space))
}
#[derive(Default, Serialize, Deserialize)]
pub(super) struct PackageSelection {
    pub(super) current: String,
    pub(super) previous: Option<String>,
}
pub(super) fn selected_package(root: &Path, previous: bool) -> Result<PathBuf, String> {
    let selection: PackageSelection = serde_json::from_slice(
        &std::fs::read(root.join("selection.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let version = if previous {
        selection
            .previous
            .ok_or("No previous package is available.")?
    } else {
        selection.current
    };
    if version.len() != 64 || !version.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid package selection.".into());
    }
    Ok(root.join("versions").join(version))
}
pub(super) fn read_review(root: &Path) -> Result<package::Review, String> {
    serde_json::from_slice(&std::fs::read(root.join("review.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

pub(super) fn prune_versions(root: &Path) {
    let Ok(current) = selected_package(root, false) else {
        return;
    };
    let previous = selected_package(root, true).ok();
    let Ok(entries) = std::fs::read_dir(root.join("versions")) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path != current
            && previous.as_ref() != Some(&path)
            && name.len() == 64
            && name.bytes().all(|v| v.is_ascii_hexdigit())
            && entry.file_type().is_ok_and(|v| v.is_dir())
        {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

pub(super) fn valid_installation(value: &Installation) -> bool {
    let identity = match catalog::Store::of(&value.id) {
        Some(catalog::Store::Chrome) => value.guid == value.id,
        Some(catalog::Store::Firefox) => !catalog::is_chrome_id(&value.guid),
        None => false,
    };
    identity
        && !value.guid.is_empty()
        && value.guid.len() <= 256
        && value.name.len() <= 512
        && uuid::Uuid::parse_str(&value.generation).is_ok()
        && value.permissions.len() <= 256
        && value.hosts.len() <= 2048
        && value
            .permissions
            .iter()
            .chain(&value.hosts)
            .all(|v| !v.contains('\0') && v.len() <= 8192)
}
