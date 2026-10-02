//! View-owned transfer jobs; the worker only receives retained folder capabilities.
use super::PermissionSet;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

pub struct TransferJob {
    pub(super) state: Arc<Mutex<Value>>,
    pub(super) cancel: Arc<AtomicBool>,
}
impl Drop for TransferJob {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
    }
}
pub fn execute(p: &mut PermissionSet, method: &str, params: &Value) -> Result<Value, String> {
    #[cfg(all(test, target_os = "macos"))]
    let lease = Some(super::document_processing::ServiceLease::fixture_worker(
        "file-operations",
    ));
    #[cfg(not(all(test, target_os = "macos")))]
    let lease = None;
    execute_with_worker(p, method, params, lease)
}
pub fn execute_with_worker(
    p: &mut PermissionSet,
    method: &str,
    params: &Value,
    worker_lease: Option<Arc<super::document_processing::ServiceLease>>,
) -> Result<Value, String> {
    p.authorize("files.write")?;
    if method == "files.transferPrepared" {
        #[cfg(target_os = "macos")]
        return macos::start_prepared(
            p,
            params,
            worker_lease.ok_or("Update this App to install its file service.")?,
        );
        #[cfg(not(target_os = "macos"))]
        return Err("Prepared file copies are currently available on macOS.".into());
    }
    if method == "files.transferStart" {
        #[cfg(target_os = "macos")]
        return macos::start(
            p,
            params,
            worker_lease.ok_or("Update this App to install its file service.")?,
        );
        #[cfg(not(target_os = "macos"))]
        return Err("App file transfers are currently available on macOS.".into());
    }
    let id = params
        .get("jobId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .ok_or("Missing transfer handle.")?;
    let job = p
        .transfers
        .get(id)
        .ok_or("This transfer belongs to another App or has closed.")?;
    match method {
        "files.transferStatus" => Ok(job
            .state
            .lock()
            .map_err(|_| "Transfer status unavailable.")?
            .clone()),
        "files.transferCancel" => {
            job.cancel.store(true, Ordering::Release);
            Ok(Value::Null)
        }
        "files.transferClose" => {
            p.transfers.remove(id);
            Ok(Value::Null)
        }
        _ => Err("Unknown transfer operation.".into()),
    }
}

#[cfg(target_os = "macos")]
#[path = "mini_app_file_transfers_macos.rs"]
mod macos;

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::super::{directories::encode_name, file_jobs::FolderGrant};
    use super::*;
    use cap_std::fs::Dir;
    use std::{
        ffi::OsStr,
        os::unix::fs::{FileExt, PermissionsExt},
        path::Path,
        time::Duration,
    };

    fn permissions() -> PermissionSet {
        let mut p = PermissionSet::from_document(
            "code",
            &json!({"runtime_capabilities":["files.read","files.write"]}),
            None,
        )
        .unwrap();
        p.decide("files.read", true).unwrap();
        p.decide("files.write", true).unwrap();
        p
    }
    fn grant(p: &mut PermissionSet, key: &str, path: &Path, writable: bool) {
        p.folders.insert(
            key.into(),
            FolderGrant {
                directory: Arc::new(
                    Dir::open_ambient_dir(path, cap_std::ambient_authority()).unwrap(),
                ),
                name: "Folder".into(),
                writable,
                released: Arc::new(AtomicBool::new(false)),
            },
        );
    }
    fn start(
        p: &mut PermissionSet,
        name: &str,
        operation: &str,
        conflict: &str,
    ) -> Result<Value, String> {
        execute(
            p,
            "files.transferStart",
            &json!({"sourceDirectory":"source","entry":encode_name(OsStr::new(name)),"destinationDirectory":"destination","operation":operation,"conflict":conflict}),
        )
    }
    async fn state_done(state: &Arc<Mutex<Value>>) -> Value {
        for _ in 0..2000 {
            let value = state.lock().unwrap().clone();
            if value["status"] != "running" {
                return value;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("Transfer did not finish");
    }
    async fn done(p: &PermissionSet, id: &Value) -> Value {
        state_done(&p.transfers[id["jobId"].as_str().unwrap()].state).await
    }
    fn sparse(path: &Path, bytes: u64) {
        let file = std::fs::File::create(path).unwrap();
        file.set_len(bytes).unwrap();
        file.write_all_at(b"start", 0).unwrap();
        file.write_all_at(b"tail", bytes - 4).unwrap();
    }
    #[tokio::test]
    #[ignore = "requires an explicitly provided disposable second mounted volume"]
    async fn moves_between_real_volumes_preserving_files_and_metadata() {
        use std::os::unix::fs::MetadataExt;
        let mount = std::env::var_os("MISTY_SDK_TRANSFER_OTHER_VOLUME")
            .expect("Set the disposable fixture volume path");
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir_in(mount).unwrap();
        assert_ne!(
            source.path().metadata().unwrap().dev(),
            destination.path().metadata().unwrap().dev()
        );
        let folder = source.path().join("project");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("日本語 #?: name.txt"), "cross-volume data").unwrap();
        std::fs::set_permissions(
            folder.join("日本語 #?: name.txt"),
            std::fs::Permissions::from_mode(0o751),
        )
        .unwrap();
        std::os::unix::fs::symlink("日本語 #?: name.txt", folder.join("link")).unwrap();
        let mut p = permissions();
        grant(&mut p, "source", source.path(), true);
        grant(&mut p, "destination", destination.path(), true);
        let job = start(&mut p, "project", "move", "error").unwrap();
        let status = done(&p, &job).await;
        assert_eq!(status["status"], "completed", "{status}");
        assert_eq!(status["result"]["sourceRemoved"], true);
        assert!(!folder.exists());
        let copied = destination.path().join("project/日本語 #?: name.txt");
        assert_eq!(
            std::fs::read_to_string(&copied).unwrap(),
            "cross-volume data"
        );
        assert_eq!(
            copied.metadata().unwrap().permissions().mode() & 0o777,
            0o751
        );
        assert_eq!(
            std::fs::read_link(destination.path().join("project/link")).unwrap(),
            Path::new("日本語 #?: name.txt")
        );
        assert_eq!(std::fs::read_dir(destination.path()).unwrap().count(), 1);
    }
}
