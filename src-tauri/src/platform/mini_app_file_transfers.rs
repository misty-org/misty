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
    p.authorize("files.write")?;
    if method == "files.transferStart" {
        #[cfg(target_os = "macos")]
        return macos::start(p, params);
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
    async fn copies_large_macos_filenames_metadata_and_links_without_following_them() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let name = "日本語 #?: name.ts";
        let folder = source.path().join("project");
        std::fs::create_dir(&folder).unwrap();
        sparse(&folder.join(name), 257 * 1024 * 1024);
        std::fs::set_permissions(folder.join(name), std::fs::Permissions::from_mode(0o751))
            .unwrap();
        let xattr = std::process::Command::new("/usr/bin/xattr")
            .args(["-w", "com.misty.fixture", "copied metadata"])
            .arg(folder.join(name))
            .status()
            .unwrap();
        assert!(xattr.success());
        std::fs::write(outside.path().join("private.txt"), "outside data").unwrap();
        std::os::unix::fs::symlink(outside.path(), folder.join("link")).unwrap();
        let mut p = permissions();
        grant(&mut p, "source", source.path(), false);
        grant(&mut p, "destination", destination.path(), true);
        let job = start(&mut p, "project", "copy", "error").unwrap();
        let status = done(&p, &job).await;
        assert_eq!(status["status"], "completed", "{status}");
        assert_eq!(status["result"]["sourceRemoved"], false);
        assert_eq!(status["bytes"], 257 * 1024 * 1024u64);
        let copied = destination.path().join("project").join(name);
        let file = std::fs::File::open(&copied).unwrap();
        let mut data = [0u8; 4];
        file.read_exact_at(&mut data, 257 * 1024 * 1024 - 4)
            .unwrap();
        assert_eq!(&data, b"tail");
        assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o751);
        let attr = std::process::Command::new("/usr/bin/xattr")
            .args(["-p", "com.misty.fixture"])
            .arg(copied)
            .output()
            .unwrap();
        assert!(attr.status.success());
        assert_eq!(
            String::from_utf8(attr.stdout).unwrap().trim(),
            "copied metadata"
        );
        assert_eq!(
            std::fs::read_link(destination.path().join("project/link")).unwrap(),
            outside.path()
        );
        assert_eq!(
            std::fs::read_to_string(outside.path().join("private.txt")).unwrap(),
            "outside data"
        );
        assert_eq!(std::fs::read_dir(destination.path()).unwrap().count(), 1);
        let mut other = permissions();
        assert!(execute(&mut other, "files.transferStatus", &job).is_err());
        execute(&mut p, "files.transferClose", &job).unwrap();
        assert!(execute(&mut p, "files.transferStatus", &job).is_err());
    }
    #[tokio::test]
    async fn cleans_readonly_staging_after_a_destination_conflict() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let folder = source.path().join("project");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("file"), "source").unwrap();
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o555)).unwrap();
        std::fs::write(destination.path().join("project"), "keep").unwrap();
        let mut p = permissions();
        grant(&mut p, "source", source.path(), false);
        grant(&mut p, "destination", destination.path(), true);
        let job = start(&mut p, "project", "copy", "error").unwrap();
        assert_eq!(done(&p, &job).await["status"], "failed");
        assert_eq!(std::fs::read_dir(destination.path()).unwrap().count(), 1);
        assert_eq!(
            folder.metadata().unwrap().permissions().mode() & 0o777,
            0o555
        );
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    #[tokio::test]
    async fn moves_exclusively_and_renames_copy_conflicts_without_overwriting() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        std::fs::write(source.path().join("a.txt"), "source").unwrap();
        std::fs::write(destination.path().join("a.txt"), "existing").unwrap();
        let mut p = permissions();
        grant(&mut p, "source", source.path(), true);
        grant(&mut p, "destination", destination.path(), true);
        let job = start(&mut p, "a.txt", "move", "error").unwrap();
        assert_eq!(done(&p, &job).await["status"], "failed");
        assert_eq!(
            std::fs::read_to_string(destination.path().join("a.txt")).unwrap(),
            "existing"
        );
        let copied = start(&mut p, "a.txt", "copy", "rename").unwrap();
        let state = done(&p, &copied).await;
        assert_eq!(state["status"], "completed", "{state}");
        assert_eq!(state["result"]["name"], "a (copy 1).txt");
        let moved = start(&mut p, "a.txt", "move", "rename").unwrap();
        let state = done(&p, &moved).await;
        assert_eq!(state["status"], "completed", "{state}");
        assert_eq!(state["result"]["name"], "a (copy 2).txt");
        assert_eq!(state["result"]["sourceRemoved"], true);
        assert!(!source.path().join("a.txt").exists());
        assert_eq!(
            std::fs::read_to_string(destination.path().join("a (copy 2).txt")).unwrap(),
            "source"
        );
    }
    #[tokio::test]
    async fn refuses_descendant_transfers_and_readonly_move_grants() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("parent/child")).unwrap();
        let mut p = permissions();
        grant(&mut p, "source", root.path(), true);
        grant(
            &mut p,
            "destination",
            &root.path().join("parent/child"),
            true,
        );
        let job = start(&mut p, "parent", "copy", "rename").unwrap();
        let state = done(&p, &job).await;
        assert_eq!(state["status"], "failed");
        assert!(state["message"].as_str().unwrap().contains("descendants"));
        assert_eq!(
            std::fs::read_dir(root.path().join("parent/child"))
                .unwrap()
                .count(),
            0
        );
        grant(&mut p, "source", root.path(), false);
        assert!(start(&mut p, "parent", "move", "error").is_err());
        grant(&mut p, "destination", root.path(), false);
        assert!(start(&mut p, "parent", "copy", "error").is_err());
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
    #[tokio::test]
    async fn cancels_native_work_when_requested_released_or_revoked() {
        for mode in ["cancel", "release", "revoke"] {
            let source = tempfile::tempdir().unwrap();
            let destination = tempfile::tempdir().unwrap();
            sparse(&source.path().join("large.bin"), 1024 * 1024 * 1024);
            let mut p = permissions();
            grant(&mut p, "source", source.path(), true);
            grant(&mut p, "destination", destination.path(), true);
            let job = start(&mut p, "large.bin", "copy", "error").unwrap();
            let state = p.transfers[job["jobId"].as_str().unwrap()].state.clone();
            for _ in 0..200 {
                if state.lock().unwrap()["bytes"].as_u64().unwrap() > 0 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
            assert_eq!(state.lock().unwrap()["status"], "running");
            match mode {
                "cancel" => {
                    execute(&mut p, "files.transferCancel", &job).unwrap();
                }
                "release" => {
                    p.folders.remove("source");
                }
                _ => {
                    p.decide("files.write", false).unwrap();
                }
            }
            let status = state_done(&state).await;
            assert_eq!(status["status"], "cancelled", "{mode}: {status}");
            assert!(source.path().join("large.bin").exists());
            assert_eq!(std::fs::read_dir(destination.path()).unwrap().count(), 0);
            if mode == "revoke" {
                assert!(p.transfers.is_empty());
            }
        }
    }
}
