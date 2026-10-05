//! Directory entries and change snapshots for files a device shares.

use super::*;

pub(super) fn opaque_root_id(path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"misty-peer-root-v1\0");
    hasher.update(path.as_os_str().to_string_lossy().as_bytes());
    format!("root_{}", hex::encode(&hasher.finalize()[..12]))
}

pub(super) fn entry_from_metadata(
    device_id: &str,
    root_id: &str,
    relative_path: PathBuf,
    metadata: &fs::Metadata,
) -> ApiResult<PeerEntry> {
    let name = relative_path
        .file_name()
        .unwrap_or_else(|| OsStr::new(""))
        .to_string_lossy()
        .into_owned();
    let kind = if metadata.file_type().is_symlink() {
        PeerEntryKind::Symlink
    } else if metadata.is_dir() {
        PeerEntryKind::Directory
    } else {
        PeerEntryKind::File
    };
    let path = PeerVirtualPath::format(device_id, root_id, &relative_path)?;
    Ok(PeerEntry {
        name: name.clone(),
        path,
        kind,
        size_bytes: metadata.is_file().then_some(metadata.len()),
        modified_ms: metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as i64),
        snapshot: metadata_snapshot(metadata),
        readonly: true,
        hidden: name.starts_with('.'),
    })
}

pub(super) fn metadata_snapshot(metadata: &fs::Metadata) -> String {
    let mut hasher = Sha256::new();
    hasher.update(metadata.len().to_be_bytes());
    if let Ok(modified) = metadata.modified().and_then(|value| {
        value
            .duration_since(UNIX_EPOCH)
            .map_err(std::io::Error::other)
    }) {
        hasher.update(modified.as_nanos().to_be_bytes());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        hasher.update(metadata.dev().to_be_bytes());
        hasher.update(metadata.ino().to_be_bytes());
    }
    format!("v1:{}", hex::encode(hasher.finalize()))
}

pub(super) fn path_error(error: std::io::Error) -> ApiError {
    match error.kind() {
        std::io::ErrorKind::NotFound => ApiError::Message("Remote path was not found.".to_owned()),
        std::io::ErrorKind::PermissionDenied => {
            ApiError::Message("Misty is not allowed to read this remote path.".to_owned())
        }
        _ => ApiError::Message(format!("Could not read remote path: {error}")),
    }
}
