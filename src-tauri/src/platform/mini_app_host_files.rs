//! Host-only adapters for existing native services. Never included in the public SDK method table.
//! The downloaded component supplies owned handles; only the compiled Host sees native paths.
use super::{FileGrant, MiniAppState};
use serde_json::{json, Value};
use std::fs;
use tauri::{AppHandle, Manager, State, Webview};

#[cfg(target_os = "macos")]
fn directory_path(directory: &cap_std::fs::Dir) -> Result<std::path::PathBuf, String> {
    use std::{ffi::CStr, os::{fd::AsRawFd, unix::{ffi::OsStrExt, fs::MetadataExt}}};
    let mut bytes = [0 as libc::c_char; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_GETPATH, bytes.as_mut_ptr()) } == -1 {
        return Err("The chosen folder's location is unavailable.".into());
    }
    let path = std::path::PathBuf::from(std::ffi::OsStr::from_bytes(unsafe { CStr::from_ptr(bytes.as_ptr()) }.to_bytes()));
    let owned = directory.try_clone().map(|dir| dir.into_std_file()).and_then(|file| file.metadata()).map_err(|_| "The chosen folder is unavailable.")?;
    let current = fs::symlink_metadata(&path).map_err(|_| "The chosen folder moved or was removed.")?;
    if !path.is_absolute() || !current.is_dir() || (owned.dev(), owned.ino()) != (current.dev(), current.ino()) {
        return Err("The chosen folder moved or was replaced. Choose it again.".into());
    }
    Ok(path)
}

#[tauri::command]
pub async fn mini_app_host_file(
    app: AppHandle,
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    operation: String,
    params: Value,
) -> Result<Value, String> {
    super::super::require_host(&webview)?;
    let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
    let p = &mut registry.get_mut(&instance).ok_or("App is closed.")?.permissions;
    p.authorize("files.read")?;
    match operation.as_str() {
        "startTransfer" => {
            use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
            use base64::Engine;
            p.authorize("files.write")?;
            let request: crate::domain::explorer::PasteItemsRequest = serde_json::from_value(params.get("request").cloned().ok_or("Missing transfer request.")?).map_err(|_| "Invalid host transfer request.")?;
            if request.sources.len() != 1 { return Err("Host transfers require one owned source.".into()); }
            let slot = p.transfer_slots.clone().try_acquire_owned().map_err(|_| "Other file transfers are running. Try again shortly.")?;
            let status = Arc::new(Mutex::new(json!({"status":"running","bytes":0,"files":0,"message":"Transferring connected file…","result":null})));
            let cancel = Arc::new(AtomicBool::new(false));
            let mut permission = p.cancellation.subscribe();
            let job_id = uuid::Uuid::new_v4().to_string();
            p.transfers.insert(job_id.clone(), super::file_transfers::TransferJob {state:status.clone(),cancel:cancel.clone()});
            let explorer = app.state::<crate::app::runtime::MistyRuntime>().explorer.clone();
            let peers = app.state::<crate::app::runtime::MistyRuntime>().connected_devices.clone();
            tokio::spawn(async move {
                let _slot = slot;
                let cancellation = cancel.clone();
                let monitor = tokio::spawn(async move { let _ = permission.changed().await; cancellation.store(true, Ordering::Release); });
                let mut request = request;
                let operation = async {
                    if request.sources[0].path.starts_with("misty://device/") {
                        if matches!(request.operation, crate::domain::explorer::ClipboardOperation::Move) { return Err("Connected devices are read-only.".to_owned()); }
                        let prepared = peers.materialize_tree(&request.sources[0].path).await.map_err(|e| e.to_string())?;
                        request.sources[0].path = prepared.local_path.to_string_lossy().into_owned();
                    }
                    let removed = matches!(request.operation, crate::domain::explorer::ClipboardOperation::Move);
                    let kind = if request.sources[0].is_directory {"directory"} else {"file"};
                    let result = explorer.paste_items_with_cancellation(request, cancel.clone()).await.map_err(|e| e.to_string())?;
                    let path = result.affected_paths.first().ok_or("Transfer finished without a destination.")?;
                    let name = std::path::Path::new(path).file_name().and_then(|value| value.to_str()).ok_or("Invalid transfer destination.")?;
                    let token = format!("u:{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(name.as_bytes()));
                    Ok::<_, String>(json!({"entry":token,"name":name,"kind":kind,"sourceRemoved":removed}))
                }.await;
                monitor.abort();
                if let Ok(mut current) = status.lock() {
                    match operation {
                        Ok(result) => { current["status"] = json!("completed"); current["files"] = json!(1); current["message"] = json!("Done"); current["result"] = result; }
                        Err(error) => { current["status"] = json!(if cancel.load(Ordering::Acquire) {"cancelled"} else {"failed"}); current["message"] = json!(error.chars().take(2048).collect::<String>()); }
                    }
                }
            });
            Ok(json!({"jobId":job_id}))
        }
        "resolve" => {
            let handle = params.get("handle").and_then(Value::as_str).ok_or("Missing file handle.")?;
            let write = params.get("write").and_then(Value::as_bool).unwrap_or(false);
            if write { p.authorize("files.write")?; }
            #[cfg(target_os = "macos")]
            {
                if let Some(folder) = p.folders.get(handle) {
                    if folder.released.load(std::sync::atomic::Ordering::Acquire) || write && !folder.writable {
                        return Err("This folder is read-only or has been released.".into());
                    }
                    return Ok(json!({"path":directory_path(&folder.directory)?, "kind":"directory", "writable":folder.writable}));
                }
                let file = p.files.get(handle).ok_or("This file belongs to another App or has closed.")?;
                if write && !file.writable { return Err("This file is read-only.".into()); }
                Ok(json!({"path":super::file_open::granted_path(&file.file)?, "kind":"file", "writable":file.writable}))
            }
            #[cfg(not(target_os = "macos"))]
            { let _ = handle; Err("Native file services currently require macOS.".into()) }
        }
        "adoptDirectory" => {
            let write = params.get("write").and_then(Value::as_bool).unwrap_or(false);
            if write { p.authorize("files.write")?; }
            let path = params.get("path").and_then(Value::as_str).filter(|path| std::path::Path::new(path).is_absolute()).ok_or("Invalid source folder.")?;
            if p.folders.len() >= 64 { return Err("Close a folder before opening another.".into()); }
            let directory = cap_std::fs::Dir::open_ambient_dir(path, cap_std::ambient_authority()).map_err(|_| "This source folder is unavailable.")?;
            let name = params.get("name").and_then(Value::as_str).unwrap_or("Folder").to_owned();
            let handle = uuid::Uuid::new_v4().to_string();
            p.folders.insert(handle.clone(), super::file_jobs::FolderGrant {
                released: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                directory: std::sync::Arc::new(directory), name: name.clone(), writable: write,
            });
            Ok(json!({"handle":handle,"name":name,"writable":write}))
        }
        "adoptPrepared" => {
            // The Host validates the selected connected source before materializing it.
            // Native WebViews cannot invoke this command, and SDK RPC has no path parameter.
            let path = params.get("path").and_then(Value::as_str).filter(|path| std::path::Path::new(path).is_absolute()).ok_or("Invalid prepared file.")?;
            if p.files.len() >= 256 { return Err("Too many open files in this App.".into()); }
            let metadata = fs::symlink_metadata(path).map_err(|_| "The prepared file is unavailable.")?;
            if !metadata.is_file() { return Err("Prepared sources must be regular files.".into()); }
            #[cfg(unix)]
            let file = {
                use std::os::unix::fs::OpenOptionsExt;
                fs::OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK).open(path)
            };
            #[cfg(not(unix))]
            let file = fs::File::open(path);
            let file = file.map_err(|_| "The prepared file could not be opened.")?;
            let bytes = file.metadata().map_err(|_| "The prepared file is unavailable.")?.len();
            let handle = uuid::Uuid::new_v4().to_string();
            p.files.insert(handle.clone(), FileGrant {file, writable:false});
            Ok(json!({"handle":handle,"bytes":bytes}))
        }
        _ => Err("Unknown host file operation.".into()),
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[test]
    fn resolves_retained_folder_identity_after_rename_and_rejects_unlinked_folders() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("chosen");
        fs::create_dir(&path).unwrap();
        let directory = cap_std::fs::Dir::open_ambient_dir(&path, cap_std::ambient_authority()).unwrap();
        let moved = root.path().join("moved");
        fs::rename(&path, &moved).unwrap();
        fs::create_dir(&path).unwrap();
        assert_eq!(directory_path(&directory).unwrap(), moved.canonicalize().unwrap());
        fs::remove_dir(&moved).unwrap();
        assert!(directory_path(&directory).is_err());
    }
}
