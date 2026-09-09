//! Native process ownership for SDK Code projects. Native cwd/id stay inside the host.
use super::{MiniAppState, PermissionSet};
use crate::infra::code_lsp;
use cap_std::fs::Dir;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub struct ProjectProcess {
    id: String,
    directory: Arc<Dir>,
    released: Arc<AtomicBool>,
    root: String,
    _slot: tokio::sync::OwnedSemaphorePermit,
}
impl Drop for ProjectProcess {
    fn drop(&mut self) {
        let _ = code_lsp::lsp_stop_blocking(self.id.clone());
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
        root: code_lsp::directory_path(&folder.directory)?,
        directory: folder.directory.clone(),
        released: folder.released.clone(),
        language: input.language,
        slot,
        epoch: permissions.epoch,
    })
}
impl Pending {
    fn finish(self, permissions: &mut PermissionSet, id: String) -> Result<Value, String> {
        // The guard stops the launched process on every rejected/late result.
        let process = ProjectProcess {
            id,
            directory: self.directory,
            released: self.released,
            root: self.root,
            _slot: self.slot,
        };
        permissions.authorize("code.execute")?;
        permissions.authorize("files.read")?;
        if permissions.epoch != self.epoch
            || process.released.load(Ordering::Acquire)
            || code_lsp::directory_path(&process.directory)? != process.root
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
    let directory = pending.directory.clone();
    let language = pending.language.clone();
    let id = tauri::async_runtime::spawn_blocking(move || {
        code_lsp::start_in_directory(app, &language, directory)
    })
    .await
    .map_err(|e| e.to_string())??;
    let mut registry = match state.0.lock() {
        Ok(registry) => registry,
        Err(_) => {
            let _ = code_lsp::lsp_stop_blocking(id);
            return Err("App registry unavailable.".into());
        }
    };
    let Some(owner) = registry.get_mut(instance) else {
        let _ = code_lsp::lsp_stop_blocking(id);
        return Err("App closed while starting its language server.".into());
    };
    pending.finish(&mut owner.permissions, id)
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
    {
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
            || code_lsp::directory_path(&process.directory)? != process.root
        {
            permissions.code_lsp.remove(&input.native_id);
            return Err("The Code folder moved or its access was released. Reopen the project language server.".into());
        }
    }
    code_lsp::code_lsp_send(input.native_id, input.payload).await?;
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
    async fn actual_clangd_uses_owned_directory_and_is_stopped_on_release_or_late_revocation() {
        let (_dir, mut permissions) = fixture();
        let pending =
            prepare(&permissions, json!({"directory":"folder","language":"cpp"})).unwrap();
        let root = pending.root.clone();
        let (send, receive) = std::sync::mpsc::channel();
        let id = code_lsp::test_start_in_directory(
            "cpp",
            pending.directory.clone(),
            move |_, message| {
                let _ = send.send(message);
            },
            |_, _| {},
        )
        .unwrap();
        let result = pending.finish(&mut permissions, id.clone()).unwrap();
        assert_eq!(result["nativeRoot"], root);
        code_lsp::code_lsp_send(id.clone(), json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
            "processId":null,"rootUri":url::Url::from_directory_path(&root).unwrap().as_str(),"capabilities":{}
        }}).to_string()).await.unwrap();
        let response: Value = serde_json::from_str(
            &receive
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(response["id"], 1);
        assert!(response.get("result").is_some());
        release_folder(&mut permissions, "folder");
        assert!(permissions.code_lsp.is_empty());
        assert!(code_lsp::code_lsp_send(
            id,
            json!({"jsonrpc":"2.0","method":"initialized","params":{}}).to_string()
        )
        .await
        .is_err());

        let pending =
            prepare(&permissions, json!({"directory":"folder","language":"cpp"})).unwrap();
        permissions.decide("code.execute", false).unwrap();
        let id = code_lsp::test_start_in_directory(
            "cpp",
            pending.directory.clone(),
            |_, _| {},
            |_, _| {},
        )
        .unwrap();
        assert!(pending.finish(&mut permissions, id.clone()).is_err());
        assert!(code_lsp::code_lsp_send(
            id,
            json!({"jsonrpc":"2.0","method":"initialized","params":{}}).to_string()
        )
        .await
        .is_err());
    }
}
