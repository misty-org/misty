//! Metadata and invalidation-only native watches for already-granted objects.
//! No native path, filename, or unbounded event queue is exposed to the App.
use super::PermissionSet;
use cap_std::fs::Dir;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{json, Value};
use std::{
    fs::Metadata,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

pub struct DirectoryWatch {
    watcher: Option<RecommendedWatcher>,
    pub directory: Arc<Dir>,
    released: Arc<AtomicBool>,
    path: PathBuf,
    identity: (u64, u64),
    revision: Arc<AtomicU64>,
    failed: Arc<AtomicBool>,
    _slot: tokio::sync::OwnedSemaphorePermit,
}

#[cfg(target_os = "macos")]
fn identity(metadata: &Metadata) -> (u64, u64) {
    use std::os::unix::fs::MetadataExt;
    (metadata.dev(), metadata.ino())
}
#[cfg(not(target_os = "macos"))]
fn identity(_: &Metadata) -> (u64, u64) {
    (0, 0)
}

#[cfg(target_os = "macos")]
fn granted_path(directory: &Dir) -> Result<PathBuf, String> {
    use std::{
        ffi::CStr,
        os::{fd::AsRawFd, unix::ffi::OsStrExt},
    };
    let mut bytes = [0 as libc::c_char; libc::PATH_MAX as usize];
    // F_GETPATH resolves the retained directory descriptor, not a caller string.
    if unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_GETPATH, bytes.as_mut_ptr()) } == -1 {
        return Err("The chosen folder's location is unavailable.".into());
    }
    let path = unsafe { CStr::from_ptr(bytes.as_ptr()) };
    Ok(PathBuf::from(std::ffi::OsStr::from_bytes(path.to_bytes())))
}
#[cfg(not(target_os = "macos"))]
fn granted_path(_: &Dir) -> Result<PathBuf, String> {
    Err("Directory observation is not implemented on this platform yet.".into())
}
fn metadata(directory: &Dir) -> Result<Metadata, String> {
    directory
        .try_clone()
        .and_then(|dir| dir.into_std_file().metadata())
        .map_err(|_| "The chosen folder is unavailable.".into())
}
impl DirectoryWatch {
    pub fn start(directory: Arc<Dir>, released: Arc<AtomicBool>) -> Result<Self, String> {
        if released.load(Ordering::Acquire) {
            return Err("The folder grant was released.".into());
        }
        static SLOTS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
        let slot = SLOTS
            .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(32)))
            .clone()
            .try_acquire_owned()
            .map_err(|_| "Too many folders are being watched.".to_owned())?;
        let path = granted_path(&directory)?;
        let identity = identity(&metadata(&directory)?);
        let revision = Arc::new(AtomicU64::new(0));
        let failed = Arc::new(AtomicBool::new(false));
        let changes = revision.clone();
        let errors = failed.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                match event {
                    // Reads alone must not cause an editor reload loop.
                    Ok(event) if matches!(event.kind, notify::EventKind::Access(_)) => return,
                    Err(_) => errors.store(true, Ordering::Release),
                    _ => {}
                }
                // Coalesce arbitrary event volume into a safe integer revision.
                let _ = changes.fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                    (value < 9_007_199_254_740_991).then_some(value + 1)
                });
            })
            .map_err(|_| "The native folder watcher could not start.".to_owned())?;
        watcher
            .watch(&path, RecursiveMode::Recursive)
            .map_err(|_| "The chosen folder could not be watched.".to_owned())?;
        let result = Self {
            watcher: Some(watcher),
            directory,
            released,
            path,
            identity,
            revision,
            failed,
            _slot: slot,
        };
        // Fence path replacement during native watch setup. Subsequent polls do
        // the same check; events never authorize a read from the watched path.
        if !result.same_root() || result.released.load(Ordering::Acquire) {
            return Err("The folder moved while its watcher was starting.".into());
        }
        Ok(result)
    }
    fn same_root(&self) -> bool {
        std::fs::symlink_metadata(&self.path)
            .is_ok_and(|value| value.is_dir() && identity(&value) == self.identity)
    }
    fn status(&mut self) -> Result<Value, String> {
        if self.released.load(Ordering::Acquire) {
            self.watcher = None;
            return Err("The folder grant was released.".into());
        }
        let reason = if !self.same_root() {
            Some("root_changed")
        } else if self.failed.load(Ordering::Acquire) {
            Some("watch_failed")
        } else {
            None
        };
        if reason.is_some() {
            self.watcher = None;
        }
        Ok(
            json!({ "revision": self.revision.load(Ordering::Acquire), "active": self.watcher.is_some(), "reason": reason }),
        )
    }
}
fn milliseconds(value: std::io::Result<SystemTime>) -> Option<i64> {
    let value = value.ok()?;
    let result = match value.duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_millis()).ok()?,
        Err(error) => -i64::try_from(error.duration().as_millis()).ok()?,
    };
    (result.unsigned_abs() <= 9_007_199_254_740_991).then_some(result)
}
pub fn execute(
    permissions: &mut PermissionSet,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    permissions.authorize("files.read")?;
    let key = params
        .get(if method == "files.stat" {
            "handle"
        } else {
            "watcher"
        })
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 256)
        .ok_or("Missing file or watcher handle.")?;
    if method == "files.stat" {
        let (metadata, writable) = if let Some(file) = permissions.files.get(key) {
            (
                file.file
                    .metadata()
                    .map_err(|_| "The file is unavailable.".to_owned())?,
                file.writable,
            )
        } else if let Some(folder) = permissions.folders.get(key) {
            (metadata(&folder.directory)?, folder.writable)
        } else {
            return Err("This handle is not granted to this App.".into());
        };
        if metadata.len() > 9_007_199_254_740_991 {
            return Err("The file size exceeds the SDK range.".into());
        }
        return Ok(
            json!({"kind":if metadata.is_dir() {"directory"} else {"file"},"bytes":metadata.len(),
            "modifiedMs":milliseconds(metadata.modified()),"createdMs":milliseconds(metadata.created()),
            "readOnly":metadata.permissions().readonly(),"writeGranted":writable}),
        );
    }
    let watcher = permissions
        .directory_watches
        .get_mut(key)
        .ok_or("This watcher does not belong to this App.")?;
    match method {
        "files.watchStatus" => watcher.status(),
        "files.watchClose" => {
            permissions.directory_watches.remove(key);
            Ok(Value::Null)
        }
        _ => Err("Unknown file observation operation.".into()),
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::super::{directories, file_jobs::FolderGrant, FileGrant};
    use super::*;
    use std::{
        io::Write,
        time::{Duration, Instant},
    };

    fn fixture(path: &std::path::Path) -> PermissionSet {
        let mut permissions = PermissionSet::from_document(
            "code",
            &json!({"runtime_capabilities":["files.read","files.write"]}),
            None,
        )
        .unwrap();
        permissions.decide("files.read", true).unwrap();
        permissions.decide("files.write", true).unwrap();
        permissions.folders.insert(
            "folder".into(),
            FolderGrant {
                directory: Arc::new(
                    Dir::open_ambient_dir(path, cap_std::ambient_authority()).unwrap(),
                ),
                released: Arc::new(AtomicBool::new(false)),
                name: "Project".into(),
                writable: true,
            },
        );
        permissions
    }
    fn start(permissions: &mut PermissionSet) -> String {
        let request = directories::prepare(
            permissions,
            "files.watchDirectory",
            &json!({"directory":"folder"}),
        )
        .unwrap();
        let output = request.run().unwrap();
        request.commit(permissions, output).unwrap()["watcher"]
            .as_str()
            .unwrap()
            .into()
    }
    fn status(permissions: &mut PermissionSet, watcher: &str) -> Value {
        execute(
            permissions,
            "files.watchStatus",
            &json!({"watcher":watcher}),
        )
        .unwrap()
    }
    #[test]
    fn metadata_is_bound_to_open_objects_and_distinguishes_write_grants() {
        let root = tempfile::tempdir().unwrap();
        let mut permissions = fixture(root.path());
        let path = root.path().join("original.txt");
        std::fs::write(&path, "🦀 original").unwrap();
        permissions.files.insert(
            "file".into(),
            FileGrant {
                file: std::fs::File::open(&path).unwrap(),
                writable: false,
            },
        );
        std::fs::rename(&path, root.path().join("moved.txt")).unwrap();
        std::fs::write(&path, "replacement is a different object").unwrap();
        let value = execute(&mut permissions, "files.stat", &json!({"handle":"file"})).unwrap();
        assert_eq!(value["bytes"], "🦀 original".len());
        assert_eq!(value["writeGranted"], false);
        assert_eq!(value["readOnly"], false);
        assert!(value["modifiedMs"].is_i64());
        assert_eq!(
            execute(&mut permissions, "files.stat", &json!({"handle":"folder"})).unwrap()["kind"],
            "directory"
        );
        assert!(execute(&mut permissions, "files.stat", &json!({"handle":"foreign"})).is_err());
        super::super::binary_files::release(&mut permissions, "file");
        assert!(execute(&mut permissions, "files.stat", &json!({"handle":"file"})).is_err());
    }
    #[test]
    fn native_recursive_watch_reports_coalesced_invalidations_without_paths() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("src")).unwrap();
        let mut permissions = fixture(root.path());
        let watcher = start(&mut permissions);
        // Let startup notifications settle before measuring the nested write.
        std::thread::sleep(Duration::from_millis(250));
        let before = status(&mut permissions, &watcher)["revision"]
            .as_u64()
            .unwrap();
        let mut file = std::fs::File::create(root.path().join("src/main.rs")).unwrap();
        file.write_all(b"fn main() {}").unwrap();
        file.sync_all().unwrap();
        let deadline = Instant::now() + Duration::from_secs(6);
        loop {
            let value = status(&mut permissions, &watcher);
            assert_eq!(value["active"], true);
            assert_eq!(value.as_object().unwrap().len(), 3);
            if value["revision"].as_u64().unwrap() > before {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "Native watcher missed a nested file write"
            );
            std::thread::sleep(Duration::from_millis(40));
        }
        execute(
            &mut permissions,
            "files.watchClose",
            &json!({"watcher":watcher}),
        )
        .unwrap();
        assert!(permissions.directory_watches.is_empty());
    }
    #[test]
    fn moved_roots_stop_observation_and_can_be_reopened_from_the_grant() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("original");
        std::fs::create_dir(&root).unwrap();
        let mut permissions = fixture(&root);
        let watcher = start(&mut permissions);
        std::fs::rename(&root, parent.path().join("moved")).unwrap();
        std::fs::create_dir(&root).unwrap();
        let value = status(&mut permissions, &watcher);
        assert_eq!(value["active"], false);
        assert_eq!(value["reason"], "root_changed");
        execute(
            &mut permissions,
            "files.watchClose",
            &json!({"watcher":watcher}),
        )
        .unwrap();
        let reopened = start(&mut permissions);
        assert_eq!(status(&mut permissions, &reopened)["active"], true);
    }
    #[test]
    fn release_revocation_and_late_completion_cannot_retain_a_watcher() {
        let root = tempfile::tempdir().unwrap();
        let mut permissions = fixture(root.path());
        let watcher = start(&mut permissions);
        let mut other = fixture(root.path());
        assert!(execute(&mut other, "files.watchStatus", &json!({"watcher":watcher})).is_err());
        super::super::binary_files::release(&mut permissions, "folder");
        assert!(permissions.directory_watches.is_empty());
        assert!(execute(
            &mut permissions,
            "files.watchStatus",
            &json!({"watcher":watcher})
        )
        .is_err());
        let request = directories::prepare(
            &other,
            "files.watchDirectory",
            &json!({"directory":"folder"}),
        )
        .unwrap();
        let output = request.run().unwrap();
        other.decide("files.read", false).unwrap();
        assert!(request.commit(&mut other, output).is_err());
        assert!(other.directory_watches.is_empty());
        assert!(execute(&mut other, "files.stat", &json!({"handle":"folder"})).is_err());
    }
}
