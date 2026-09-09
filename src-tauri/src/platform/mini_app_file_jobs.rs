//! File jobs keep their authority in the native registration, never in app paths.
use super::PermissionSet;
use cap_std::fs::Dir;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
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

#[cfg(test)]
pub fn execute(p: &mut PermissionSet, method: &str, params: &Value) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    let lease = Some(super::document_processing::ServiceLease::fixture_worker(
        "file-operations",
    ));
    #[cfg(not(target_os = "macos"))]
    let lease = None;
    execute_with_worker(p, method, params, lease)
}
pub fn execute_with_worker(
    permissions: &mut PermissionSet,
    method: &str,
    params: &Value,
    lease: Option<Arc<super::document_processing::ServiceLease>>,
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
        let lease = lease.ok_or("Update this App to install its file service.")?;
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
            #[cfg(target_os = "macos")]
            let result = {
                use std::os::fd::AsRawFd;
                super::capability_worker::run(
                    &lease,
                    json!({"operation":"scan","name":name}),
                    &[directory.as_raw_fd()],
                    &[(directory.as_raw_fd(), false)],
                    || cancel.load(Ordering::Acquire),
                )
            };
            #[cfg(not(target_os = "macos"))]
            let result: Result<Value, String> =
                Err("App scans are unavailable on this device.".into());
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

#[cfg(test)]
mod tests {
    use super::*;
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
