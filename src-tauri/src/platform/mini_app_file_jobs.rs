//! File jobs keep their authority in the native registration, never in app paths.
use super::PermissionSet;
use cap_std::fs::Dir;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

pub struct FolderGrant {
    pub released: Arc<AtomicBool>,
    pub directory: Arc<Dir>,
    pub name: String,
    pub writable: bool,
}
impl Drop for FolderGrant {
    fn drop(&mut self) {
        self.released.store(true, Ordering::Release);
    }
}
pub struct FileJob {
    state: Arc<Mutex<Value>>,
    cancel: Arc<AtomicBool>,
}
impl Drop for FileJob {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
    }
}
impl FileJob {
    fn cancel(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "File job unavailable.")?;
        self.cancel.store(true, Ordering::Release);
        *state = json!({"status":"cancelled", "message":"Scan cancelled.", "result":null});
        Ok(())
    }
}

pub fn execute(
    permissions: &mut PermissionSet,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    let key = params
        .get(if method == "files.scanStart" {
            "handle"
        } else {
            "jobId"
        })
        .and_then(Value::as_str)
        .ok_or("Missing folder or job handle.")?;
    if method == "files.scanStart" {
        if permissions.scans.len() >= 16 {
            return Err("Close an old scan before starting another.".into());
        }
        let folder = permissions
            .folders
            .get(key)
            .ok_or("This folder is not granted to this App.")?;
        let directory = folder.directory.clone();
        let name = folder.name.clone();
        static WORKERS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
        let slot = WORKERS
            .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(4)))
            .clone()
            .try_acquire_owned()
            .map_err(|_| "Other folder scans are running. Try again shortly.")?;
        let id = uuid::Uuid::new_v4().to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        let state = Arc::new(Mutex::new(
            json!({"id":id,"status":"running","message":"Scanning folder…","result":null}),
        ));
        permissions.scans.insert(
            id.clone(),
            FileJob {
                state: state.clone(),
                cancel: cancel.clone(),
            },
        );
        tokio::task::spawn_blocking(move || {
            let _slot = slot;
            let result = scan(&directory, &name, &cancel);
            if let Ok(mut state) = state.lock() {
                // Revocation drops the native job and cancels the worker; late
                // results can never become visible to a replacement instance.
                if cancel.load(Ordering::Acquire) {
                    *state =
                        json!({"status":"cancelled","message":"Scan cancelled.","result":null});
                } else {
                    *state = match result {
                        Ok(result) => {
                            json!({"status":"completed","message":"Storage report ready.","result":result})
                        }
                        Err(error) => json!({"status":"failed","message":error,"result":null}),
                    };
                }
            }
        });
        return Ok(json!({"jobId":id}));
    }
    let job = permissions
        .scans
        .get(key)
        .ok_or("This scan does not belong to this App instance.")?;
    match method {
        "files.scanStatus" => Ok(job
            .state
            .lock()
            .map_err(|_| "File job unavailable.")?
            .clone()),
        "files.scanCancel" => {
            job.cancel()?;
            Ok(Value::Null)
        }
        "files.scanClose" => {
            permissions.scans.remove(key);
            Ok(Value::Null)
        }
        _ => Err("Unsupported file job.".into()),
    }
}

fn scan(root: &Dir, name: &str, cancel: &AtomicBool) -> Result<Value, String> {
    let mut stack = vec![(PathBuf::from("."), 0usize)];
    let (mut bytes, mut files, mut folders, mut skipped) = (0u64, 0u64, 0u64, 0u64);
    let mut largest: Vec<(u64, String, String, String)> = Vec::new();
    let mut types: HashMap<String, (u64, u64)> = HashMap::new();
    let started = Instant::now();
    let mut visited = 0;
    let mut truncated = false;
    'scan: while let Some((relative, depth)) = stack.pop() {
        if cancel.load(Ordering::Acquire) {
            return Err("Scan cancelled.".into());
        }
        // Every operation resolves from the retained directory capability, so
        // renaming/replacing a path or symlink cannot escape the chosen root.
        let entries = match root.read_dir(&relative) {
            Ok(entries) => entries,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        for entry in entries {
            if cancel.load(Ordering::Acquire) {
                return Err("Scan cancelled.".into());
            }
            visited += 1;
            if visited > 500_000 || started.elapsed() > Duration::from_secs(120) {
                truncated = true;
                break 'scan;
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            let path = relative.join(entry.file_name());
            if path.as_os_str().len() > 4096 {
                skipped += 1;
                continue;
            }
            let metadata = match root.symlink_metadata(&path) {
                Ok(value) => value,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            if metadata.is_dir() {
                folders += 1;
                if depth < 128 && stack.len() < 16_384 {
                    stack.push((path, depth + 1));
                } else {
                    skipped += 1;
                    truncated = true;
                }
                continue;
            }
            if !metadata.is_file() {
                skipped += 1;
                continue;
            }
            let len = metadata.len();
            bytes = bytes.saturating_add(len);
            files += 1;
            let kind = path
                .extension()
                .and_then(|value| value.to_str())
                .filter(|value| !value.is_empty() && value.len() <= 32)
                .map(|value| format!(".{}", value.to_lowercase()))
                .unwrap_or("Other".into());
            let kind = if types.len() < 256 || types.contains_key(&kind) {
                kind
            } else {
                "Other".into()
            };
            let row = types.entry(kind.clone()).or_default();
            row.0 = row.0.saturating_add(len);
            row.1 += 1;
            largest.push((
                len,
                path.to_string_lossy().into_owned(),
                entry.file_name().to_string_lossy().into_owned(),
                kind,
            ));
            largest.sort_unstable_by(|a, b| b.0.cmp(&a.0));
            largest.truncate(50);
        }
    }
    let mut types: Vec<_> = types.into_iter().collect();
    types.sort_unstable_by(|a, b| b.1 .0.cmp(&a.1 .0));
    types.truncate(20);
    Ok(
        json!({"root":name,"bytes":bytes,"files":files,"folders":folders,"skipped":skipped,"truncated":truncated,
        "largest":largest.into_iter().map(|(bytes,path,name,kind)|json!({"bytes":bytes,"path":path,"name":name,"kind":kind})).collect::<Vec<_>>(),
        "types":types.into_iter().map(|(kind,(bytes,files))|json!({"kind":kind,"bytes":bytes,"files":files})).collect::<Vec<_>>() }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scans_only_the_open_folder_without_following_symlinks_or_disclosing_absolute_paths() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("chosen")).unwrap();
        std::fs::write(root.path().join("chosen/a.txt"), "hello").unwrap();
        std::fs::write(root.path().join("secret.txt"), "outside").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("../secret.txt", root.path().join("chosen/link")).unwrap();
        let dir = Dir::open_ambient_dir(root.path().join("chosen"), cap_std::ambient_authority())
            .unwrap();
        let result = scan(&dir, "chosen", &AtomicBool::new(false)).unwrap();
        assert_eq!(result["bytes"], 5);
        assert_eq!(result["files"], 1);
        assert!(!result.to_string().contains(root.path().to_str().unwrap()));
        assert!(scan(&dir, "chosen", &AtomicBool::new(true)).is_err());
        // The handle keeps referring to the selected directory after its old
        // pathname is replaced by a different folder.
        #[cfg(unix)]
        {
            std::fs::rename(root.path().join("chosen"), root.path().join("moved")).unwrap();
            std::fs::create_dir(root.path().join("chosen")).unwrap();
            std::fs::write(root.path().join("chosen/secret"), "replacement").unwrap();
            assert_eq!(
                scan(&dir, "chosen", &AtomicBool::new(false)).unwrap()["bytes"],
                5
            );
        }
    }
    #[tokio::test]
    async fn jobs_are_instance_owned_and_revocation_discards_results() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a"), "a").unwrap();
        let mut permissions = PermissionSet::from_document(
            "app",
            &json!({"runtime_capabilities":["files.read"]}),
            None,
        )
        .unwrap();
        permissions.decide("files.read", true).unwrap();
        permissions.folders.insert(
            "chosen".into(),
            FolderGrant {
                released: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                directory: Arc::new(
                    Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap(),
                ),
                name: "chosen".into(),
                writable: false,
            },
        );
        assert!(execute(
            &mut permissions,
            "files.scanStart",
            &json!({"handle":"/etc"})
        )
        .is_err());
        let started = execute(
            &mut permissions,
            "files.scanStart",
            &json!({"handle":"chosen"}),
        )
        .unwrap();
        let job = json!({"jobId":started["jobId"]});
        let mut other = PermissionSet::from_document("app", &json!({}), None).unwrap();
        assert!(execute(&mut other, "files.scanStatus", &job).is_err());
        execute(&mut permissions, "files.scanCancel", &job).unwrap();
        assert_eq!(
            execute(&mut permissions, "files.scanStatus", &job).unwrap()["status"],
            "cancelled"
        );
        let cancelled = permissions.scans.values().next().unwrap().cancel.clone();
        permissions.decide("files.read", false).unwrap();
        assert!(cancelled.load(Ordering::Acquire));
        assert!(permissions.folders.is_empty());
        assert!(execute(&mut permissions, "files.scanStatus", &job).is_err());
    }
}
