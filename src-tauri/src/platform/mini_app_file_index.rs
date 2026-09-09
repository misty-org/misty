//! A downloaded index receives app-supplied metadata only, with a private cache
//! bound to the current installation owner and an explicitly granted folder.
use super::MiniAppState;
use crate::infra::document_intelligence::ServiceLease;
use cap_std::fs::MetadataExt;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    os::{fd::AsRawFd, unix::fs::PermissionsExt},
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    directory: String,
    operation: String,
    query: Option<String>,
    offset: Option<u64>,
    #[serde(default)]
    documents: Vec<Document>,
    #[serde(default)]
    deletes: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    path: String,
    name: String,
    extension: String,
    directory: bool,
    bytes: u64,
    modified_ms: u64,
    hidden: bool,
}
fn relative(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 4096
        && !path.contains(['\\', '\0'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

pub async fn execute(
    app: AppHandle,
    state: &MiniAppState,
    instance: &str,
    params: Value,
) -> Result<Value, String> {
    if serde_json::to_vec(&params)
        .map_err(|_| "Invalid index request.")?
        .len()
        > 8 * 1024 * 1024
    {
        return Err("Index batch exceeds its limit.".into());
    }
    let request: Request = serde_json::from_value(params).map_err(|_| "Invalid index request.")?;
    if !["init", "query", "dump", "apply"].contains(&request.operation.as_str())
        || request.directory.len() > 256
        || request.documents.len() > 1000
        || request.deletes.len() > 1000
        || request.query.as_ref().is_some_and(|q| q.len() > 16384)
        || request.offset.is_some_and(|n| n > 1_000_000)
        || request.deletes.iter().any(|p| !relative(p))
        || request.documents.iter().any(|d| {
            !relative(&d.path)
                || d.name.is_empty()
                || d.name.len() > 1024
                || d.extension.len() > 128
                || d.bytes > 9_007_199_254_740_991
                || d.modified_ms > 9_007_199_254_740_991
        })
    {
        return Err("Invalid index operation or metadata limits.".into());
    }
    if request.operation != "apply"
        && (!request.documents.is_empty() || !request.deletes.is_empty())
    {
        return Err("Only an apply operation accepts index mutations.".into());
    }
    let lease =
        Arc::new(ServiceLease::acquire_service(state, instance, "files", "file-search", 1).await?);
    let _cancel = lease.cancel_on_drop();
    let (folder, released, key) = {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let p = &registry.get(instance).ok_or("App is closed.")?.permissions;
        p.authorize("files.read")?;
        let folder = p
            .folders
            .get(&request.directory)
            .ok_or("Choose a local folder before indexing it.")?;
        if folder.released.load(Ordering::Acquire) {
            return Err("The folder was released.".into());
        }
        let owner = p.native_owner.as_ref().ok_or("Missing index owner.")?;
        let deployment = owner
            .deployment
            .as_ref()
            .filter(|s| !s.is_empty())
            .ok_or("Missing index deployment.")?;
        let space = owner
            .space_id
            .as_ref()
            .filter(|s| !s.is_empty())
            .ok_or("Missing index Space.")?;
        let mut path = [0 as libc::c_char; libc::PATH_MAX as usize];
        if unsafe {
            libc::fcntl(
                folder.directory.as_raw_fd(),
                libc::F_GETPATH,
                path.as_mut_ptr(),
            )
        } == -1
        {
            return Err("The granted folder is unavailable.".into());
        }
        let identity = unsafe { std::ffi::CStr::from_ptr(path.as_ptr()) }.to_bytes();
        let metadata = folder
            .directory
            .dir_metadata()
            .map_err(|_| "The folder identity is unavailable.")?;
        let key = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(
                    deployment,
                    &owner.account_id,
                    space,
                    &p.app_id,
                    &p.version,
                    identity,
                    metadata.dev(),
                    metadata.ino()
                ))
                .map_err(|_| "Invalid index owner.")?
            )
        );
        (folder.directory.clone(), folder.released.clone(), key)
    };
    let index = app
        .path()
        .app_data_dir()
        .map_err(|_| "App storage is unavailable.")?
        .join("app-index-v1")
        .join(key);
    let worker_lease = lease.clone();
    let mut pending = tokio::task::spawn_blocking(move || {
        let _folder = folder;
        std::fs::create_dir_all(&index).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&index, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
        let mut mutations = if request.operation == "apply" {
            Some(tempfile::NamedTempFile::new().map_err(|e| e.to_string())?)
        } else {
            None
        };
        if let Some(file) = &mut mutations {
            for path in request.deletes {
                serde_json::to_writer(file.as_file_mut(), &json!({"delete":path}))
                    .map_err(|e| e.to_string())?;
                file.write_all(b"\n").map_err(|e| e.to_string())?;
            }
            for doc in request.documents {
                serde_json::to_writer(file.as_file_mut(), &json!({"delete":doc.path}))
                    .map_err(|e| e.to_string())?;
                file.write_all(b"\n").map_err(|e| e.to_string())?;
                serde_json::to_writer(file.as_file_mut(), &json!({"add":{
                    "path":doc.path,"name":doc.name,"extension":doc.extension,"source_kind":"local",
                    "provider_type":"","remote_name":"","remote_path":"","mime_type":"",
                    "is_file":!doc.directory,"is_dir":doc.directory,"size":doc.bytes,"modified_ms":doc.modified_ms,"hidden":doc.hidden
                }})).map_err(|e| e.to_string())?;
                file.write_all(b"\n").map_err(|e| e.to_string())?;
            }
            file.flush().map_err(|e| e.to_string())?;
        }
        crate::infra::search::execute_package_index(
            &worker_lease,
            &index,
            json!({"protocol":1,"operation":request.operation,"query":request.query.unwrap_or_default().to_lowercase(),"offset":request.offset.unwrap_or(0)}),
            mutations.as_ref().map(|file| file.path()),
        )
    });
    let mut interval = tokio::time::interval(Duration::from_millis(100));
    let result = loop {
        if released.load(Ordering::Acquire) || lease.validate(state, instance).is_err() {
            lease.cancel_operation();
            let _ = pending.await;
            return Err("The Files index or folder grant changed.".into());
        }
        tokio::select! {
            value = &mut pending => break value.map_err(|_| "The index process stopped.")?,
            _ = interval.tick() => {}
        }
    };
    lease.validate(state, instance)?;
    if released.load(Ordering::Acquire) {
        return Err("The indexed folder was released.".into());
    }
    let mut result = result?;
    if let Some(docs) = result.get("docs").and_then(Value::as_array) {
        let documents = docs.iter().map(|doc| json!({
            "path":doc["path"],"name":doc["name"],"extension":doc["extension"],
            "directory":doc["is_dir"],"bytes":doc["size"],"modifiedMs":doc["modified_ms"],"hidden":doc["hidden"]
        })).collect();
        result["docs"] = Value::Array(documents);
    }
    Ok(result)
}
