//! Local resource authority for Space peers. Only retained, explicitly granted
//! directories enter this registry; network paths never become ambient OS paths.
use super::peer_files::PeerVirtualPath;
use crate::domain::connected_devices::{PeerEntry, PeerEntryKind, PeerRoot, PeerRootKind};
use cap_std::fs::{Dir, Metadata, OpenOptions};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::UNIX_EPOCH,
};

pub(crate) struct GrantedRoot {
    pub id: String,
    pub name: String,
    pub directory: Arc<Dir>,
    pub released: Arc<AtomicBool>,
}
struct Root {
    descriptor: PeerRoot,
    directory: Arc<Dir>,
    released: Arc<AtomicBool>,
}
pub(crate) struct Roots {
    device: String,
    roots: HashMap<String, Root>,
}
impl Roots {
    pub(crate) fn from_grants(
        namespace: &str,
        device: &str,
        grants: Vec<GrantedRoot>,
    ) -> Result<Self, String> {
        if namespace.is_empty() || device.is_empty() {
            return Err("Missing peer root owner.".into());
        }
        let mut roots = HashMap::new();
        for grant in grants {
            if grant.id.is_empty() || grant.released.load(Ordering::Acquire) {
                continue;
            }
            let identity = serde_json::to_vec(&(namespace, &grant.id))
                .map_err(|_| "Invalid peer root identity.")?;
            let id = format!("root_{}", hex::encode(&Sha256::digest(identity)[..12]));
            roots.insert(
                id.clone(),
                Root {
                    descriptor: PeerRoot {
                        id,
                        name: grant.name,
                        kind: PeerRootKind::Folder,
                        readonly: true,
                    },
                    directory: grant.directory,
                    released: grant.released,
                },
            );
        }
        Ok(Self {
            device: device.into(),
            roots,
        })
    }
    pub(crate) fn list(&self) -> Vec<PeerRoot> {
        let mut roots: Vec<_> = self
            .roots
            .values()
            .filter(|root| !root.released.load(Ordering::Acquire))
            .map(|root| root.descriptor.clone())
            .collect();
        roots.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
        roots
    }
    fn resolve(&self, path: &str) -> Result<(&Root, PathBuf), String> {
        let parsed = PeerVirtualPath::parse(path).map_err(|error| error.to_string())?;
        if parsed.device_id != self.device {
            return Err("Peer path belongs to another device.".into());
        }
        let root = self
            .roots
            .get(&parsed.root_id)
            .ok_or("Peer root is not granted.")?;
        root.check()?;
        Ok((
            root,
            if parsed.relative_path.as_os_str().is_empty() {
                PathBuf::from(".")
            } else {
                parsed.relative_path
            },
        ))
    }
    pub(crate) fn stat(&self, path: &str) -> Result<PeerEntry, String> {
        let (root, relative) = self.resolve(path)?;
        let metadata = root.directory.metadata(&relative).map_err(io_error)?;
        root.check()?;
        entry(path, &metadata)
    }
    pub(crate) fn read_link(
        &self,
        path: &str,
        expected: Option<&str>,
    ) -> Result<(Vec<u8>, String), String> {
        use std::os::unix::ffi::OsStrExt;
        let (root, relative) = self.resolve(path)?;
        let before = root
            .directory
            .symlink_metadata(&relative)
            .map_err(io_error)?;
        if !before.file_type().is_symlink() {
            return Err("Choose a symbolic link.".into());
        }
        let revision = snapshot(&before);
        if expected.is_some_and(|value| value != revision) {
            return Err("Source changed while reading the link.".into());
        }
        let target = root
            .directory
            .read_link_contents(&relative)
            .map_err(io_error)?;
        let bytes = target.as_os_str().as_bytes();
        if bytes.is_empty() || bytes.len() > 16 * 1024 || bytes.contains(&0) {
            return Err("Unsupported symbolic link target.".into());
        }
        root.check()?;
        if snapshot(
            &root
                .directory
                .symlink_metadata(&relative)
                .map_err(io_error)?,
        ) != revision
        {
            return Err("Source changed while reading the link.".into());
        }
        Ok((bytes.to_vec(), revision))
    }
    pub(crate) fn directory(
        &self,
        path: &str,
        hidden: bool,
    ) -> Result<(Vec<PeerEntry>, String), String> {
        let (root, relative) = self.resolve(path)?;
        let directory = root.directory.open_dir(relative).map_err(io_error)?;
        let mut entries = Vec::new();
        for child in directory.entries().map_err(io_error)? {
            root.check()?;
            let child = child.map_err(io_error)?;
            let name = child.file_name();
            let name = name.to_str().ok_or("Peer filename is not valid UTF-8.")?;
            if !hidden && name.starts_with('.') {
                continue;
            }
            let metadata = directory.symlink_metadata(name).map_err(io_error)?;
            let parsed = PeerVirtualPath::parse(path).map_err(|error| error.to_string())?;
            let child_path = PeerVirtualPath::format(
                &self.device,
                &root.descriptor.id,
                &parsed.relative_path.join(name),
            )
            .map_err(|error| error.to_string())?;
            entries.push(entry(&child_path, &metadata)?);
        }
        root.check()?;
        entries.sort_by(|a, b| {
            matches!(b.kind, PeerEntryKind::Directory)
                .cmp(&matches!(a.kind, PeerEntryKind::Directory))
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok((
            entries,
            snapshot(&directory.dir_metadata().map_err(io_error)?),
        ))
    }
    pub(crate) fn open(
        &self,
        path: &str,
        offset: u64,
        length: Option<u64>,
        expected: Option<&str>,
    ) -> Result<ReadRange, String> {
        let (root, relative) = self.resolve(path)?;
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NONBLOCK);
        }
        let opened = root
            .directory
            .open_with(relative, &options)
            .map_err(io_error)?;
        let metadata = opened.metadata().map_err(io_error)?;
        if !metadata.is_file() {
            return Err("Peer path is not a regular file.".into());
        }
        let snapshot = snapshot(&metadata);
        if expected.is_some_and(|expected| expected != snapshot) {
            return Err("Peer source changed.".into());
        }
        if offset > metadata.len() {
            return Err("Peer offset exceeds the file.".into());
        }
        let length = length
            .unwrap_or(metadata.len() - offset)
            .min(metadata.len() - offset);
        let mut file = opened;
        file.seek(SeekFrom::Start(offset)).map_err(io_error)?;
        root.check()?;
        Ok(ReadRange {
            file,
            released: root.released.clone(),
            snapshot,
            length,
            remaining: length,
        })
    }
}
impl Root {
    fn check(&self) -> Result<(), String> {
        if self.released.load(Ordering::Acquire) {
            Err("Peer folder grant was released.".into())
        } else {
            Ok(())
        }
    }
}
pub(crate) struct ReadRange {
    file: cap_std::fs::File,
    released: Arc<AtomicBool>,
    pub snapshot: String,
    pub length: u64,
    remaining: u64,
}
impl ReadRange {
    pub(crate) fn read(&mut self, bytes: &mut [u8]) -> Result<usize, String> {
        if self.released.load(Ordering::Acquire) {
            return Err("Peer folder grant was released.".into());
        }
        if snapshot(&self.file.metadata().map_err(io_error)?) != self.snapshot {
            return Err("Peer source changed while reading.".into());
        }
        let maximum = bytes
            .len()
            .min(64 * 1024)
            .min(self.remaining.min(usize::MAX as u64) as usize);
        if maximum == 0 {
            return Ok(0);
        }
        let count = self.file.read(&mut bytes[..maximum]).map_err(io_error)?;
        if self.released.load(Ordering::Acquire) {
            return Err("Peer folder grant was released.".into());
        }
        if snapshot(&self.file.metadata().map_err(io_error)?) != self.snapshot {
            return Err("Peer source changed while reading.".into());
        }
        if count == 0 {
            return Err("Peer source changed while reading.".into());
        }
        self.remaining -= count as u64;
        Ok(count)
    }
}
fn entry(path: &str, metadata: &Metadata) -> Result<PeerEntry, String> {
    let parsed = PeerVirtualPath::parse(path).map_err(|error| error.to_string())?;
    let name = parsed
        .relative_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    Ok(PeerEntry {
        name: name.clone(),
        path: path.into(),
        kind: if metadata.file_type().is_symlink() {
            PeerEntryKind::Symlink
        } else if metadata.is_dir() {
            PeerEntryKind::Directory
        } else {
            PeerEntryKind::File
        },
        size_bytes: metadata.is_file().then_some(metadata.len()),
        modified_ms: metadata
            .modified()
            .ok()
            .and_then(|value| value.into_std().duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as i64),
        snapshot: snapshot(metadata),
        readonly: true,
        hidden: name.starts_with('.'),
    })
}
fn snapshot(metadata: &Metadata) -> String {
    let mut hash = Sha256::new();
    hash.update(metadata.len().to_be_bytes());
    if let Ok(time) = metadata.modified() {
        if let Ok(time) = time.into_std().duration_since(UNIX_EPOCH) {
            hash.update(time.as_nanos().to_be_bytes());
        }
    }
    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;
        hash.update(metadata.dev().to_be_bytes());
        hash.update(metadata.ino().to_be_bytes());
    }
    format!("v2:{}", hex::encode(hash.finalize()))
}
fn io_error(error: std::io::Error) -> String {
    format!("Peer file operation failed: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retained_roots_confine_replacements_and_revoke_open_reads() {
        let temp = tempfile::tempdir().unwrap();
        let granted = temp.path().join("granted");
        std::fs::create_dir(&granted).unwrap();
        std::fs::write(granted.join("file"), b"original").unwrap();
        std::fs::write(temp.path().join("private"), b"private").unwrap();
        std::os::unix::fs::symlink("../private", granted.join("escape")).unwrap();
        let directory =
            Arc::new(Dir::open_ambient_dir(&granted, cap_std::ambient_authority()).unwrap());
        let released = Arc::new(AtomicBool::new(false));
        let roots = Roots::from_grants(
            "alice-family",
            "device-a",
            vec![GrantedRoot {
                id: "selected".into(),
                name: "Selected".into(),
                directory: directory.clone(),
                released: released.clone(),
            }],
        )
        .unwrap();
        let other = Roots::from_grants(
            "alice-work",
            "device-a",
            vec![GrantedRoot {
                id: "selected".into(),
                name: "Selected".into(),
                directory,
                released: Arc::new(AtomicBool::new(false)),
            }],
        )
        .unwrap();
        let root = roots.list().pop().unwrap();
        assert_ne!(root.id, other.list()[0].id);
        let base = PeerVirtualPath::format("device-a", &root.id, std::path::Path::new("")).unwrap();
        let file = format!("{base}/file");
        assert!(roots
            .open(&format!("{base}/escape"), 0, None, None)
            .is_err());
        assert!(roots
            .open(&format!("{base}/%2e%2e/private"), 0, None, None)
            .is_err());
        assert!(roots.stat(&file.replace("device-a", "device-b")).is_err());
        assert!(other.stat(&file).is_err());
        std::fs::rename(&granted, temp.path().join("retained")).unwrap();
        std::fs::create_dir(&granted).unwrap();
        std::fs::write(granted.join("file"), b"replacement").unwrap();
        let (entries, _) = roots.directory(&base, false).unwrap();
        assert!(entries.iter().any(|entry| entry.name == "file"));
        let stat = roots.stat(&file).unwrap();
        let mut read = roots.open(&file, 1, Some(3), Some(&stat.snapshot)).unwrap();
        let mut buffer = [0; 10];
        assert_eq!(read.read(&mut buffer).unwrap(), 3);
        assert_eq!(&buffer[..3], b"rig");
        assert_eq!(read.read(&mut buffer).unwrap(), 0);
        assert!(roots.open(&file, 0, None, Some("stale")).is_err());
        let mut read = roots.open(&file, 0, None, None).unwrap();
        released.store(true, Ordering::Release);
        assert!(roots.list().is_empty());
        assert!(roots.stat(&file).is_err());
        assert!(read.read(&mut buffer).is_err());
        let other_path = PeerVirtualPath::format(
            "device-a",
            &other.list()[0].id,
            std::path::Path::new("file"),
        )
        .unwrap();
        other
            .open(&other_path, 0, None, None)
            .unwrap()
            .read(&mut buffer)
            .unwrap();
        assert_eq!(&buffer[..8], b"original");
    }
    #[test]
    fn changed_source_is_not_returned_under_an_old_snapshot() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("file"), b"before").unwrap();
        let roots = Roots::from_grants(
            "owner",
            "device-a",
            vec![GrantedRoot {
                id: "root".into(),
                name: "Files".into(),
                directory: Arc::new(
                    Dir::open_ambient_dir(temp.path(), cap_std::ambient_authority()).unwrap(),
                ),
                released: Arc::new(AtomicBool::new(false)),
            }],
        )
        .unwrap();
        let path = PeerVirtualPath::format(
            "device-a",
            &roots.list()[0].id,
            std::path::Path::new("file"),
        )
        .unwrap();
        let mut read = roots.open(&path, 0, None, None).unwrap();
        std::fs::write(temp.path().join("file"), b"changed source").unwrap();
        assert!(read.read(&mut [0; 10]).is_err());
    }
}
