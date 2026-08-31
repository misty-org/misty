use std::{
    collections::HashMap,
    ffi::OsStr,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    domain::connected_devices::{PeerEntry, PeerEntryKind, PeerRoot, PeerRootKind},
    error::{ApiError, ApiResult},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerVirtualPath {
    pub device_id: String,
    pub root_id: String,
    pub relative_path: PathBuf,
}

impl PeerVirtualPath {
    pub fn parse(value: &str) -> ApiResult<Self> {
        // Parse the path before handing it to `url`: URL parsers normalize dot
        // segments, which would hide an attempted `%2e%2e` traversal from the
        // confinement checks below.
        let raw_path = value
            .strip_prefix("misty://device/")
            .ok_or_else(|| ApiError::Message("Remote device path is invalid.".to_owned()))?;
        if raw_path.contains(['?', '#']) || raw_path.starts_with('/') {
            return Err(ApiError::Message(
                "Remote device path is invalid.".to_owned(),
            ));
        }
        let mut segments = raw_path.split('/');
        let device_id = decode_segment(segments.next())?;
        let root_id = decode_segment(segments.next())?;
        if !valid_opaque_id(&device_id) || !valid_opaque_id(&root_id) {
            return Err(ApiError::Message(
                "Remote device path is invalid.".to_owned(),
            ));
        }
        let mut relative_path = PathBuf::new();
        for segment in segments {
            let decoded = percent_decode_str(segment)
                .decode_utf8()
                .map_err(|_| ApiError::Message("Remote device path is invalid.".to_owned()))?;
            validate_relative_component(&decoded)?;
            relative_path.push(decoded.as_ref());
        }
        validate_relative_path(&relative_path)?;
        Ok(Self {
            device_id,
            root_id,
            relative_path,
        })
    }

    pub fn format(device_id: &str, root_id: &str, relative_path: &Path) -> ApiResult<String> {
        if !valid_opaque_id(device_id) || !valid_opaque_id(root_id) {
            return Err(ApiError::Message(
                "Remote device identity is invalid.".to_owned(),
            ));
        }
        validate_relative_path(relative_path)?;
        let mut value = format!("misty://device/{device_id}/{root_id}");
        for component in relative_path.components() {
            let Component::Normal(part) = component else {
                continue;
            };
            value.push('/');
            value.push_str(
                &percent_encoding::utf8_percent_encode(
                    &part.to_string_lossy(),
                    percent_encoding::NON_ALPHANUMERIC,
                )
                .to_string(),
            );
        }
        Ok(value)
    }
}

fn decode_segment(segment: Option<&str>) -> ApiResult<String> {
    percent_decode_str(segment.unwrap_or_default())
        .decode_utf8()
        .map(|value| value.into_owned())
        .map_err(|_| ApiError::Message("Remote device path is invalid.".to_owned()))
}

fn valid_opaque_id(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

fn validate_relative_component(value: &str) -> ApiResult<()> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || value.contains('\0')
    {
        Err(ApiError::Message(
            "Remote path escapes its shared root.".to_owned(),
        ))
    } else {
        Ok(())
    }
}

fn validate_relative_path(path: &Path) -> ApiResult<()> {
    if path.is_absolute() {
        return Err(ApiError::Message(
            "Remote path escapes its shared root.".to_owned(),
        ));
    }
    for component in path.components() {
        match component {
            Component::Normal(part) => validate_relative_component(&part.to_string_lossy())?,
            Component::CurDir if path.as_os_str().is_empty() => {}
            _ => {
                return Err(ApiError::Message(
                    "Remote path escapes its shared root.".to_owned(),
                ))
            }
        }
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct RootRecord {
    descriptor: PeerRoot,
    canonical_path: PathBuf,
}

#[derive(Debug, Clone, Default)]
pub struct PeerRootRegistry {
    roots: HashMap<String, RootRecord>,
}

impl PeerRootRegistry {
    pub fn discover() -> Self {
        let mut candidates: Vec<(String, PathBuf, PeerRootKind)> = Vec::new();

        #[cfg(target_os = "macos")]
        {
            candidates.push((
                "Macintosh HD".to_owned(),
                PathBuf::from("/"),
                PeerRootKind::System,
            ));
            if let Ok(volumes) = fs::read_dir("/Volumes") {
                for volume in volumes.flatten() {
                    candidates.push((
                        volume.file_name().to_string_lossy().into_owned(),
                        volume.path(),
                        PeerRootKind::Volume,
                    ));
                }
            }
        }

        #[cfg(windows)]
        {
            for letter in b'A'..=b'Z' {
                let path = PathBuf::from(format!("{}:\\", letter as char));
                if path.exists() {
                    candidates.push((
                        format!("{}:", letter as char),
                        path,
                        if letter == b'C' {
                            PeerRootKind::System
                        } else {
                            PeerRootKind::Volume
                        },
                    ));
                }
            }
        }

        #[cfg(not(any(target_os = "macos", windows)))]
        candidates.push((
            "Filesystem".to_owned(),
            PathBuf::from("/"),
            PeerRootKind::System,
        ));

        Self::from_candidates(candidates)
    }

    pub fn from_candidates(candidates: Vec<(String, PathBuf, PeerRootKind)>) -> Self {
        let mut roots = HashMap::new();
        for (name, path, kind) in candidates {
            let Ok(canonical_path) = fs::canonicalize(path) else {
                continue;
            };
            let id = opaque_root_id(&canonical_path);
            roots.entry(id.clone()).or_insert_with(|| RootRecord {
                descriptor: PeerRoot {
                    id,
                    name,
                    kind,
                    readonly: true,
                },
                canonical_path,
            });
        }
        Self { roots }
    }

    pub fn roots(&self) -> Vec<PeerRoot> {
        let mut roots: Vec<_> = self
            .roots
            .values()
            .map(|root| root.descriptor.clone())
            .collect();
        roots.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));
        roots
    }

    pub fn reference_for_local_path(&self, path: &Path) -> Option<(String, PathBuf)> {
        let canonical = fs::canonicalize(path).ok()?;
        self.roots
            .values()
            .filter_map(|root| {
                canonical
                    .strip_prefix(&root.canonical_path)
                    .ok()
                    .map(|relative| {
                        (
                            root.descriptor.id.clone(),
                            relative.to_owned(),
                            root.canonical_path.components().count(),
                        )
                    })
            })
            .max_by_key(|(_, _, depth)| *depth)
            .map(|(root_id, relative, _)| (root_id, relative))
    }

    pub fn list_directory(
        &self,
        device_id: &str,
        root_id: &str,
        relative_path: &Path,
        show_hidden: bool,
    ) -> ApiResult<(Vec<PeerEntry>, String)> {
        let directory = self.resolve_existing(root_id, relative_path)?;
        if !directory.is_dir() {
            return Err(ApiError::Message(
                "Remote path is not a directory.".to_owned(),
            ));
        }
        let mut entries = Vec::new();
        for item in fs::read_dir(&directory).map_err(path_error)? {
            let item = item.map_err(path_error)?;
            let name = item.file_name().to_string_lossy().into_owned();
            let hidden = name.starts_with('.');
            if hidden && !show_hidden {
                continue;
            }
            let child_relative = relative_path.join(&name);
            let metadata = fs::symlink_metadata(item.path()).map_err(path_error)?;
            entries.push(entry_from_metadata(
                device_id,
                root_id,
                child_relative,
                &metadata,
            )?);
        }
        entries.sort_by(|left, right| {
            let left_directory = matches!(left.kind, PeerEntryKind::Directory);
            let right_directory = matches!(right.kind, PeerEntryKind::Directory);
            right_directory
                .cmp(&left_directory)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        let snapshot = metadata_snapshot(&fs::metadata(directory).map_err(path_error)?);
        Ok((entries, snapshot))
    }

    pub fn stat(
        &self,
        device_id: &str,
        root_id: &str,
        relative_path: &Path,
    ) -> ApiResult<PeerEntry> {
        let resolved = self.resolve_existing(root_id, relative_path)?;
        let metadata = fs::symlink_metadata(resolved).map_err(path_error)?;
        entry_from_metadata(device_id, root_id, relative_path.to_owned(), &metadata)
    }

    pub fn open_file(
        &self,
        root_id: &str,
        relative_path: &Path,
        expected_snapshot: Option<&str>,
    ) -> ApiResult<OpenedPeerFile> {
        let resolved = self.resolve_existing(root_id, relative_path)?;
        let file = File::open(&resolved).map_err(path_error)?;
        let metadata = file.metadata().map_err(path_error)?;
        if !metadata.is_file() {
            return Err(ApiError::Message(
                "Remote path is not a regular file.".to_owned(),
            ));
        }
        let snapshot = metadata_snapshot(&metadata);
        if expected_snapshot.is_some_and(|expected| expected != snapshot) {
            return Err(ApiError::Message("Remote source changed.".to_owned()));
        }
        Ok(OpenedPeerFile {
            file,
            snapshot,
            length: metadata.len(),
        })
    }

    fn resolve_existing(&self, root_id: &str, relative_path: &Path) -> ApiResult<PathBuf> {
        validate_relative_path(relative_path)?;
        let root = self
            .roots
            .get(root_id)
            .ok_or_else(|| ApiError::Message("Remote root was not found.".to_owned()))?;
        let candidate =
            fs::canonicalize(root.canonical_path.join(relative_path)).map_err(path_error)?;
        if candidate != root.canonical_path && !candidate.starts_with(&root.canonical_path) {
            return Err(ApiError::Message(
                "Remote path escapes its shared root.".to_owned(),
            ));
        }
        Ok(candidate)
    }
}

pub struct OpenedPeerFile {
    pub file: File,
    pub snapshot: String,
    pub length: u64,
}

impl OpenedPeerFile {
    pub fn range_length(&self, offset: u64, requested: Option<u64>) -> ApiResult<u64> {
        if offset > self.length {
            return Err(ApiError::Message(
                "Requested range starts past the end of the file.".to_owned(),
            ));
        }
        Ok(requested
            .unwrap_or(self.length - offset)
            .min(self.length - offset))
    }

    pub fn read_range(mut self, offset: u64, requested: Option<u64>) -> ApiResult<Vec<u8>> {
        let length = self.range_length(offset, requested)?;
        let length: usize = length
            .try_into()
            .map_err(|_| ApiError::Message("Requested range is too large.".to_owned()))?;
        self.file
            .seek(SeekFrom::Start(offset))
            .map_err(path_error)?;
        let mut bytes = vec![0; length];
        self.file.read_exact(&mut bytes).map_err(path_error)?;
        Ok(bytes)
    }
}

fn opaque_root_id(path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"misty-peer-root-v1\0");
    hasher.update(path.as_os_str().to_string_lossy().as_bytes());
    format!("root_{}", hex::encode(&hasher.finalize()[..12]))
}

fn entry_from_metadata(
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

fn metadata_snapshot(metadata: &fs::Metadata) -> String {
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

fn path_error(error: std::io::Error) -> ApiError {
    match error.kind() {
        std::io::ErrorKind::NotFound => ApiError::Message("Remote path was not found.".to_owned()),
        std::io::ErrorKind::PermissionDenied => {
            ApiError::Message("Misty is not allowed to read this remote path.".to_owned())
        }
        _ => ApiError::Message(format!("Could not read remote path: {error}")),
    }
}

#[cfg(test)]
#[path = "peer_files_tests.rs"]
mod tests;
