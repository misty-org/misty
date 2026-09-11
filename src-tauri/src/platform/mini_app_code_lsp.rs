//! Native process ownership for SDK Code projects. Native cwd/id stay inside the host.
use super::{MiniAppState, PermissionSet};
use crate::infra::{document_intelligence::ServiceLease, native_process_worker::ProcessWorker};
use cap_std::fs::Dir;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::Emitter;

pub struct ProjectProcess {
    id: String,
    worker: Arc<ProcessWorker>,
    lease: Arc<ServiceLease>,
    directory: Arc<Dir>,
    released: Arc<AtomicBool>,
    root: String,
    _slot: tokio::sync::OwnedSemaphorePermit,
}
impl Drop for ProjectProcess {
    fn drop(&mut self) {
        self.worker.close();
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Start {
    directory: String,
    language: String,
}
struct Pending {
    directory: Arc<Dir>,
    released: Arc<AtomicBool>,
    root: String,
    language: String,
    slot: tokio::sync::OwnedSemaphorePermit,
    epoch: u64,
}
fn directory_path(directory: &Dir) -> Result<String, String> {
    use std::os::fd::AsRawFd;
    let mut bytes = [0 as libc::c_char; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_GETPATH, bytes.as_mut_ptr()) } == -1 {
        return Err("The selected Code folder is unavailable.".into());
    }
    unsafe { std::ffi::CStr::from_ptr(bytes.as_ptr()) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| "The selected Code folder path is not valid UTF-8.".into())
}
fn prepare(permissions: &PermissionSet, params: Value) -> Result<Pending, String> {
    permissions.authorize("code.execute")?;
    permissions.authorize("files.read")?;
    let input: Start =
        serde_json::from_value(params).map_err(|_| "Invalid Code project request.")?;
    if input.directory.is_empty() || input.directory.len() > 256 || input.language.len() > 32 {
        return Err("Invalid Code project request.".into());
    }
    let folder = permissions
        .folders
        .get(&input.directory)
        .ok_or("This Code folder is not owned by this view.")?;
    if folder.released.load(Ordering::Acquire) {
        return Err("This Code folder was released.".into());
    }
    let slot = permissions
        .code_lsp_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Too many Code language servers in this view.")?;
    Ok(Pending {
        root: directory_path(&folder.directory)?,
        directory: folder.directory.clone(),
        released: folder.released.clone(),
        language: input.language,
        slot,
        epoch: permissions.epoch,
    })
}
impl Pending {
    fn finish(
        self,
        permissions: &mut PermissionSet,
        id: String,
        worker: Arc<ProcessWorker>,
        lease: Arc<ServiceLease>,
    ) -> Result<Value, String> {
        // The guard stops the launched process on every rejected/late result.
        let process = ProjectProcess {
            id,
            worker,
            lease,
            directory: self.directory,
            released: self.released,
            root: self.root,
            _slot: self.slot,
        };
        permissions.authorize("code.execute")?;
        permissions.authorize("files.read")?;
        if permissions.epoch != self.epoch
            || process.released.load(Ordering::Acquire)
            || directory_path(&process.directory)? != process.root
        {
            return Err(
                "The Code project changed or its access was revoked while starting.".into(),
            );
        }
        let result = json!({ "nativeId": process.id, "nativeRoot": process.root });
        permissions.code_lsp.insert(process.id.clone(), process);
        Ok(result)
    }
}
pub async fn start(
    app: tauri::AppHandle,
    state: &MiniAppState,
    instance: &str,
    params: Value,
) -> Result<Value, String> {
    let pending = {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        prepare(
            &registry.get(instance).ok_or("App is closed.")?.permissions,
            params,
        )?
    };
    let lease = Arc::new(ServiceLease::acquire_code_tools(state, instance).await?);
    let directory = pending.directory.clone();
    let language = pending.language.clone();
    let id = uuid::Uuid::new_v4().to_string();
    let event_id = id.clone();
    let event_lease = lease.clone();
    let events = Arc::new(move |event: Value| {
        if event["event"] == "message" && !event_lease.cancelled() {
            let _ = app.emit_to(
                "main",
                "misty://code-lsp-message",
                json!({"sessionId":event_id,"payload":event["payload"]}),
            );
        } else if event["event"] == "exit" {
            let _ = app.emit_to(
                "main",
                "misty://code-lsp-exit",
                json!({"sessionId":event_id,"reason":event["reason"]}),
            );
        }
    });
    let worker_lease = lease.clone();
    let worker = tokio::task::spawn_blocking(move || {
        let worker = Arc::new(ProcessWorker::launch_code(worker_lease, events, directory)?);
        worker.call(json!({"operation":"start","language":language}))?;
        Ok::<_, String>(worker)
    })
    .await
    .map_err(|e| e.to_string())??;
    if let Err(error) = lease.validate(state, instance) {
        worker.close();
        return Err(error);
    }
    let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
    let owner = registry
        .get_mut(instance)
        .ok_or("App closed while starting its language server.")?;
    pending.finish(&mut owner.permissions, id, worker, lease)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Send {
    native_id: String,
    payload: String,
}
pub async fn send(state: &MiniAppState, instance: &str, params: Value) -> Result<Value, String> {
    let input: Send =
        serde_json::from_value(params).map_err(|_| "Invalid language-server message.")?;
    if input.payload.len() > 8 * 1024 * 1024 {
        return Err("Language-server messages are limited to 8 MiB.".into());
    }
    let (worker, lease) = {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let permissions = &mut registry
            .get_mut(instance)
            .ok_or("App is closed.")?
            .permissions;
        permissions.authorize("code.execute")?;
        permissions.authorize("files.read")?;
        let process = permissions
            .code_lsp
            .get(&input.native_id)
            .ok_or("Language server is not owned by this view.")?;
        if process.released.load(Ordering::Acquire)
            || directory_path(&process.directory)? != process.root
        {
            permissions.code_lsp.remove(&input.native_id);
            return Err("The Code folder moved or its access was released. Reopen the project language server.".into());
        }
        (process.worker.clone(), process.lease.clone())
    };
    lease.validate(state, instance)?;
    tokio::task::spawn_blocking(move || {
        worker.call(json!({"operation":"send","payload":input.payload}))
    })
    .await
    .map_err(|e| e.to_string())??;
    lease.validate(state, instance)?;
    Ok(Value::Null)
}
pub fn release(permissions: &mut PermissionSet, params: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Input {
        native_id: String,
    }
    let input: Input =
        serde_json::from_value(params).map_err(|_| "Invalid language-server release.")?;
    permissions.code_lsp.remove(&input.native_id);
    Ok(Value::Null)
}
pub fn release_folder(permissions: &mut PermissionSet, handle: &str) {
    if let Some(folder) = permissions.folders.get(handle) {
        let directory = folder.directory.clone();
        permissions
            .code_lsp
            .retain(|_, process| !Arc::ptr_eq(&process.directory, &directory));
    }
}

#[cfg(test)]
mod tests {
    use super::super::file_jobs::FolderGrant;
    use super::*;

    fn fixture() -> (tempfile::TempDir, PermissionSet) {
        let dir = tempfile::tempdir().unwrap();
        let mut permissions = PermissionSet::from_document(
            "code",
            &json!({ "runtime_capabilities": ["files.read", "code.execute"] }),
            None,
        )
        .unwrap();
        permissions.decide("files.read", true).unwrap();
        permissions.decide("code.execute", true).unwrap();
        permissions.folders.insert(
            "folder".into(),
            FolderGrant {
                released: Arc::new(AtomicBool::new(false)),
                directory: Arc::new(
                    Dir::open_ambient_dir(dir.path(), cap_std::ambient_authority()).unwrap(),
                ),
                name: "Code fixture".into(),
                writable: false,
            },
        );
        (dir, permissions)
    }

    #[test]
    fn requires_owned_folder_and_both_permissions_without_accepting_process_arguments() {
        let (_dir, mut permissions) = fixture();
        assert!(prepare(
            &permissions,
            json!({"directory":"foreign","language":"cpp"})
        )
        .is_err());
        assert!(prepare(
            &permissions,
            json!({"directory":"folder","language":"cpp","args":["--anything"]})
        )
        .is_err());
        permissions.decide("code.execute", false).unwrap();
        assert!(prepare(&permissions, json!({"directory":"folder","language":"cpp"})).is_err());
        permissions.decide("code.execute", true).unwrap();
        permissions.decide("files.read", false).unwrap();
        assert!(prepare(&permissions, json!({"directory":"folder","language":"cpp"})).is_err());
    }

    #[tokio::test]
    #[ignore = "requires MISTY_TEST_CODE_WORKER and the macOS clangd"]
    async fn signed_worker_uses_owned_directory_and_stops_on_release_or_late_revocation() {
        use super::super::document_processing::tests::{
            fixture as service_fixture, service_receipt,
        };
        let bytes = std::fs::read(std::env::var("MISTY_TEST_CODE_WORKER").unwrap()).unwrap();
        let (state, root) = service_fixture();
        let (_dir, mut permissions) = fixture();
        permissions.version = "1".into();
        permissions.space_owned = true;
        permissions.owner_namespace = Some("member-family".into());
        state.0.lock().unwrap().get_mut("test").unwrap().permissions = permissions;
        service_receipt(root.path(), &bytes, "code", "code-tools", 1);
        let lease = Arc::new(
            ServiceLease::acquire_code_tools(&state, "test")
                .await
                .unwrap(),
        );
        let pending = prepare(
            &state.0.lock().unwrap()["test"].permissions,
            json!({"directory":"folder","language":"cpp"}),
        )
        .unwrap();
        let project_root = pending.root.clone();
        let (messages, receive) = std::sync::mpsc::channel();
        let worker = Arc::new(
            ProcessWorker::launch_code(
                lease.clone(),
                Arc::new(move |message| {
                    let _ = messages.send(message);
                }),
                pending.directory.clone(),
            )
            .unwrap(),
        );
        worker
            .call(json!({"operation":"start","language":"cpp"}))
            .unwrap();
        let id = "owned-server".to_string();
        pending
            .finish(
                &mut state.0.lock().unwrap().get_mut("test").unwrap().permissions,
                id.clone(),
                worker.clone(),
                lease.clone(),
            )
            .unwrap();
        send(&state,"test",json!({"nativeId":id,"payload":json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":url::Url::from_directory_path(&project_root).unwrap().as_str(),"capabilities":{}}}).to_string()})).await.unwrap();
        let event = receive
            .recv_timeout(std::time::Duration::from_secs(10))
            .unwrap();
        let reply: Value = serde_json::from_str(event["payload"].as_str().unwrap()).unwrap();
        assert_eq!(reply["id"], 1);
        assert!(reply["result"]["capabilities"].is_object());
        // A second Space uses its own package receipt, directory, and process.
        let (second_state, second_root) = service_fixture();
        let (_second_dir, mut second_permissions) = fixture();
        second_permissions.version = "1".into();
        second_permissions.space_owned = true;
        second_permissions.owner_namespace = Some("member-work".into());
        second_state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions = second_permissions;
        service_receipt(second_root.path(), &bytes, "code", "code-tools", 1);
        assert!(lease.validate(&second_state, "test").is_err());
        let second_lease = Arc::new(
            ServiceLease::acquire_code_tools(&second_state, "test")
                .await
                .unwrap(),
        );
        let second_pending = prepare(
            &second_state.0.lock().unwrap()["test"].permissions,
            json!({"directory":"folder","language":"cpp"}),
        )
        .unwrap();
        let second_path = second_pending.root.clone();
        let (second_messages, second_receive) = std::sync::mpsc::channel();
        let second_worker = Arc::new(
            ProcessWorker::launch_code(
                second_lease.clone(),
                Arc::new(move |event| {
                    let _ = second_messages.send(event);
                }),
                second_pending.directory.clone(),
            )
            .unwrap(),
        );
        second_worker
            .call(json!({"operation":"start","language":"cpp"}))
            .unwrap();
        second_pending
            .finish(
                &mut second_state
                    .0
                    .lock()
                    .unwrap()
                    .get_mut("test")
                    .unwrap()
                    .permissions,
                "second".into(),
                second_worker.clone(),
                second_lease,
            )
            .unwrap();
        release_folder(
            &mut state.0.lock().unwrap().get_mut("test").unwrap().permissions,
            "folder",
        );
        assert!(worker
            .call(json!({"operation":"send","payload":"{}"}))
            .is_err());
        assert!(send(&state, "test", json!({"nativeId":id,"payload":"{}"}))
            .await
            .is_err());
        // A startup that finishes after revocation is never retained.
        let pending = prepare(
            &state.0.lock().unwrap()["test"].permissions,
            json!({"directory":"folder","language":"cpp"}),
        )
        .unwrap();
        let other = Arc::new(
            ProcessWorker::launch_code(lease.clone(), Arc::new(|_| {}), pending.directory.clone())
                .unwrap(),
        );
        other
            .call(json!({"operation":"start","language":"cpp"}))
            .unwrap();
        let mut registry = state.0.lock().unwrap();
        let permissions = &mut registry.get_mut("test").unwrap().permissions;
        permissions.decide("code.execute", false).unwrap();
        assert!(pending
            .finish(permissions, "late".into(), other.clone(), lease)
            .is_err());
        assert!(other
            .call(json!({"operation":"send","payload":"{}"}))
            .is_err());
        drop(registry);
        send(&second_state,"test",json!({"nativeId":"second","payload":json!({"jsonrpc":"2.0","id":2,"method":"initialize","params":{"processId":null,"rootUri":url::Url::from_directory_path(&second_path).unwrap().as_str(),"capabilities":{}}}).to_string()})).await.unwrap();
        let event = second_receive
            .recv_timeout(std::time::Duration::from_secs(10))
            .unwrap();
        let reply: Value = serde_json::from_str(event["payload"].as_str().unwrap()).unwrap();
        assert_eq!(reply["id"], 2);
        assert!(reply["result"]["capabilities"].is_object());
        second_state
            .0
            .lock()
            .unwrap()
            .get_mut("test")
            .unwrap()
            .permissions
            .decide("files.read", false)
            .unwrap();
        assert!(second_worker
            .call(json!({"operation":"send","payload":"{}"}))
            .is_err());
    }
}
