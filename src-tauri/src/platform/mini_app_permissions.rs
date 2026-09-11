//! Device grants are native-owned, scoped to one live App registration, and
//! invalidated on close. The main Host is the only permission decision maker.
use super::{require_host, MiniAppState};
#[path = "mini_app_remembered_permissions.rs"]
mod remembered_permissions;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    sync::Arc,
};
use tauri::{AppHandle, Manager, State, Webview};
use tauri_plugin_dialog::DialogExt;
#[path = "mini_app_binary_files.rs"]
mod binary_files;
#[path = "mini_app_clipboard.rs"]
mod clipboard;
#[path = "mini_app_directories.rs"]
mod directories;
/// How this platform remembers a folder across launches.
#[cfg(any(target_os = "macos", windows))]
#[cfg_attr(target_os = "macos", path = "mini_app_directory_bookmark_macos.rs")]
#[cfg_attr(windows, path = "mini_app_directory_bookmark_windows.rs")]
mod directory_bookmark;
#[cfg(any(target_os = "macos", windows))]
#[path = "mini_app_directory_bookmarks.rs"]
mod directory_bookmarks;
#[path = "mini_app_directory_handoff.rs"]
mod directory_handoff;
#[path = "mini_app_directory_mutations.rs"]
mod directory_mutations;
#[path = "mini_app_document_processing.rs"]
pub(crate) mod document_processing;
#[path = "mini_app_download_process.rs"]
mod download_process;
#[path = "mini_app_download_proxy.rs"]
mod download_proxy;
#[path = "mini_app_downloads.rs"]
mod downloads;
#[path = "mini_app_file_jobs.rs"]
mod file_jobs;
#[path = "mini_app_file_observation.rs"]
mod file_observation;
#[path = "mini_app_file_open.rs"]
mod file_open;
#[path = "mini_app_file_preview.rs"]
mod file_preview;
#[path = "mini_app_file_transfers.rs"]
mod file_transfers;
#[path = "mini_app_file_trash.rs"]
mod file_trash;
#[path = "mini_app_host_files.rs"]
pub mod host_files;
#[path = "mini_app_media.rs"]
mod media;
#[path = "mini_app_text_files.rs"]
mod text_files;
#[path = "mini_app_tool_sandbox.rs"]
mod tool_sandbox;

/// Registered only by the debug integration harness; normal app grants are unaffected.
#[cfg(all(debug_assertions, target_os = "macos"))]
pub(crate) struct MiniAppProbeDirectory(pub std::path::PathBuf);

#[cfg(target_os = "macos")]
#[path = "mini_app_tree_drafts.rs"]
mod tree_drafts;

pub struct PermissionSet {
    #[cfg(target_os = "macos")]
    tree_drafts: HashMap<String, tree_drafts::TreeDraft>,
    archive_reads: HashMap<String, file_preview::ReadGuard>,
    #[cfg(any(target_os = "macos", windows))]
    folder_security_scopes: HashMap<String, Arc<directory_bookmark::SecurityScope>>,
    pub(super) owner_namespace: Option<String>,
    pub(super) native_owner: Option<super::NativeOwner>,
    pub(super) account_owned: bool,
    pub(super) builtin: bool,
    consent_declaration: String,
    consent_loaded: bool,
    app_id: String,
    version: String,
    declared: HashSet<String>,
    origins: HashSet<String>,
    granted: HashSet<String>,
    denied: HashSet<String>,
    files: HashMap<String, FileGrant>,
    folders: HashMap<String, file_jobs::FolderGrant>,
    directory_shares: HashMap<String, directory_handoff::DirectoryShare>,
    directory_watches: HashMap<String, file_observation::DirectoryWatch>,
    transfers: HashMap<String, file_transfers::TransferJob>,
    transfer_slots: std::sync::Arc<tokio::sync::Semaphore>,
    outputs: HashMap<String, binary_files::OutputDraft>,
    media: HashMap<String, media::MediaJob>,
    downloads: HashMap<String, downloads::DownloadJob>,
    epoch: u64,
    cancellation: tokio::sync::watch::Sender<u64>,
}
struct FileGrant {
    file: fs::File,
    writable: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    app_id: String,
    capability: String,
    granted: bool,
    remembered: bool,
}

impl PermissionSet {
    pub(super) fn builtin(tool: &str, purpose: &str) -> Result<Self, String> {
        if !matches!(tool, "files" | "library")
            || !matches!(purpose, "documents" | "search" | "previews" | "devices")
            || (tool != "files" && matches!(purpose, "search" | "devices"))
        {
            return Err("Unknown built-in service.".into());
        }
        let scopes = if purpose == "devices" {
            vec!["files.read", "connections.read"]
        } else {
            vec!["files.read"]
        };
        let mut permissions = Self::from_document(
            tool,
            &json!({
                "version": "builtin-v1", "runtime_capabilities": scopes
            }),
            None,
        )?;
        permissions.granted = permissions.declared.clone();
        permissions.builtin = true;
        Ok(permissions)
    }

    fn from_document(
        app_id: &str,
        document: &Value,
        limit: Option<&[String]>,
    ) -> Result<Self, String> {
        use sha2::{Digest, Sha256};
        let mut scopes: Vec<_> = strings(document.get("runtime_capabilities"))?
            .into_iter()
            .collect();
        scopes.sort();
        let mut network: Vec<_> = strings(document.get("runtime_network_origins"))?
            .into_iter()
            .collect();
        network.sort();
        let consent_declaration = hex::encode(Sha256::digest(
            serde_json::to_vec(&json!([
                app_id,
                document.get("publisher"),
                document.get("repository_url"),
                document.get("permission_version"),
                scopes,
                network
            ]))
            .map_err(|e| e.to_string())?,
        ));
        let declared = strings(document.get("runtime_capabilities"))?;
        let declared: HashSet<_> = declared
            .into_iter()
            .filter(|scope| limit.is_none_or(|allowed| allowed.contains(scope)))
            .collect();
        let origins = strings(document.get("runtime_network_origins"))?
            .into_iter()
            .map(|value| origin(&value))
            .collect::<Result<HashSet<_>, _>>()?;
        Ok(Self {
            #[cfg(target_os = "macos")]
            tree_drafts: HashMap::new(),
            archive_reads: HashMap::new(),
            #[cfg(any(target_os = "macos", windows))]
            folder_security_scopes: HashMap::new(),
            owner_namespace: None,
            native_owner: None,
            account_owned: false,
            builtin: false,
            consent_declaration,
            consent_loaded: false,
            app_id: app_id.into(),
            version: document
                .get("version")
                .and_then(Value::as_str)
                .filter(|value| value.len() <= 80)
                .unwrap_or("0")
                .to_owned(),
            declared,
            origins,
            granted: HashSet::new(),
            denied: HashSet::new(),
            files: HashMap::new(),
            folders: HashMap::new(),
            directory_shares: HashMap::new(),
            directory_watches: HashMap::new(),
            transfers: HashMap::new(),
            transfer_slots: std::sync::Arc::new(tokio::sync::Semaphore::new(4)),
            outputs: HashMap::new(),
            media: HashMap::new(),
            downloads: HashMap::new(),
            epoch: 0,
            cancellation: tokio::sync::watch::channel(0).0,
        })
    }
    fn declaration(&self, capability: &str) -> Result<(), String> {
        if let Some(origin) = capability.strip_prefix("network.fetch@") {
            if self.declared.contains("network.fetch") && self.origins.contains(origin) {
                return Ok(());
            }
        } else if self.declared.contains(capability) {
            return Ok(());
        }
        Err(
            "This App did not declare the requested capability, or its session does not allow it."
                .into(),
        )
    }
    fn authorize(&self, capability: &str) -> Result<(), String> {
        self.declaration(capability)?;
        if !self.granted.contains(capability) {
            return Err("Permission has not been granted or was revoked.".into());
        }
        Ok(())
    }
    fn decide(&mut self, capability: &str, allowed: bool) -> Result<(), String> {
        self.declaration(capability)?;
        if allowed {
            self.denied.remove(capability);
            self.granted.insert(capability.into());
        } else {
            self.granted.remove(capability);
            self.denied.insert(capability.into());
            if capability.starts_with("files.") {
                self.archive_reads.clear();
                self.files.clear();
                self.folders.clear();
                #[cfg(any(target_os = "macos", windows))]
                self.folder_security_scopes.clear();
                self.directory_shares.clear();
                self.directory_watches.clear();
                self.transfers.clear();
                self.outputs.clear();
                #[cfg(target_os = "macos")]
                self.tree_drafts.clear();
                self.media.clear();
                self.downloads.clear();
            }
            if capability == "media.convert" {
                self.media.clear();
                self.outputs.clear();
                #[cfg(target_os = "macos")]
                self.tree_drafts.clear();
            }
            if capability == "media.download" {
                self.downloads.clear();
            }
            self.epoch += 1;
            self.cancellation.send_replace(self.epoch);
        }
        Ok(())
    }
}

fn strings(value: Option<&Value>) -> Result<HashSet<String>, String> {
    let Some(value) = value else {
        return Ok(HashSet::new());
    };
    let values = value.as_array().ok_or("Invalid capability declaration.")?;
    if values.len() > 64 {
        return Err("Too many App capabilities.".into());
    }
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .filter(|s| !s.is_empty() && s.len() <= 256)
                .map(str::to_owned)
                .ok_or_else(|| "Invalid capability declaration.".into())
        })
        .collect()
}
fn origin(value: &str) -> Result<String, String> {
    let url = url::Url::parse(value).map_err(|_| "Invalid network origin.")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Apps can request only HTTPS origins without credentials.".into());
    }
    Ok(url.origin().ascii_serialization())
}
/// Services this release does not bundle a worker for. Apps get a plain answer
/// instead of a failed worker lookup.
fn unavailable_feature(method: &str) -> Option<&'static str> {
    if method.starts_with("backups.") {
        Some("Backups")
    } else if method.starts_with("code.lsp.") {
        Some("Code language services")
    } else if method.starts_with("files.scan") {
        Some("Folder scans")
    } else if matches!(method, "files.transferStart" | "files.transferPrepared") {
        Some("App file transfers")
    } else {
        None
    }
}
fn capability(method: &str, params: &Value) -> Result<String, String> {
    Ok(match method {
        "terminal.authorize" => "terminal.execute".into(),
        "connections.authorize" => "connections.read".into(),
        "files.sources.open"
        | "files.rememberDirectory"
        | "files.reopenDirectory"
        | "files.shareDirectory"
        | "files.adoptDirectory"
        | "files.pickDirectory"
        | "files.openEntry"
            if params.get("write") == Some(&Value::Bool(true)) =>
        {
            "files.write".into()
        }
        "files.createCopy" | "files.appendCopy" | "files.commitCopy" | "files.discardCopy" => {
            "files.write".into()
        }
        "media.convertStart"
        | "media.convertStatus"
        | "media.convertCancel"
        | "media.convertCollect"
        | "media.convertClose" => "media.convert".into(),
        "downloads.inspectStart"
        | "downloads.downloadStart"
        | "downloads.jobStatus"
        | "downloads.jobCancel"
        | "downloads.jobClose" => "media.download".into(),
        "files.openExternal" => "files.open".into(),
        "files.index" | "files.sources.list" | "files.sources.open" | "files.readBytes"
        | "files.listArchive" | "documents.prepare" => "files.read".into(),
        "files.pick" if params.get("write") == Some(&Value::Bool(true)) => "files.write".into(),
        "files.pick" | "files.pickMany" | "files.readText" => "files.read".into(),
        "files.listSavedDirectories"
        | "files.rememberDirectory"
        | "files.reopenDirectory"
        | "files.forgetDirectory"
        | "files.shareDirectory"
        | "files.adoptDirectory"
        | "files.cancelDirectoryShare"
        | "files.pickDirectory"
        | "files.stat"
        | "files.watchDirectory"
        | "files.watchStatus"
        | "files.watchClose"
        | "files.listDirectory"
        | "files.openEntry" => "files.read".into(),
        "files.openTrash"
        | "files.replaceCopy"
        | "files.writeText"
        | "files.createEntry"
        | "files.renameEntry"
        | "files.removeEntry"
        | "files.treeBegin"
        | "files.treeDirectory"
        | "files.treeSymlink"
        | "files.treeCommit"
        | "files.treeDiscard"
        | "files.transferStatus"
        | "files.transferCancel"
        | "files.transferClose" => "files.write".into(),
        "appearance.preview" | "appearance.apply" | "appearance.preset" | "appearance.revert" => {
            "appearance.write".into()
        }
        "clipboard.readText" | "clipboard.readImage" => "clipboard.read".into(),
        "clipboard.writeText" | "clipboard.writeImage" => "clipboard.write".into(),
        "microphone.capture" => "microphone.capture".into(),
        "camera.capture" => "camera.capture".into(),
        "network.fetch" => format!(
            "network.fetch@{}",
            origin(
                params
                    .get("url")
                    .and_then(Value::as_str)
                    .ok_or("Missing network URL.")?
            )?
        ),
        _ => return Err("Unsupported device capability.".into()),
    })
}

#[tauri::command]
pub async fn mini_app_permission_status(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    method: String,
    params: Value,
) -> Result<PermissionStatus, String> {
    require_host(&webview)?;
    let capability = capability(&method, &params)?;
    remembered_permissions::restore_instance(&state, &instance).await?;
    let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
    let permissions = &mut registry
        .get_mut(&instance)
        .ok_or("App is closed.")?
        .permissions;
    permissions.declaration(&capability)?;
    if permissions.denied.contains(&capability) {
        return Err("Permission was denied or revoked for this session. Reopen the App to request it again.".into());
    }
    Ok(PermissionStatus {
        app_id: permissions.app_id.clone(),
        remembered: permissions.owner_namespace.is_some(),
        granted: permissions.granted.contains(&capability),
        capability,
    })
}

#[tauri::command]
pub async fn mini_app_permission_decide(
    app: AppHandle,
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    capability: String,
    allowed: bool,
) -> Result<(), String> {
    require_host(&webview)?;
    remembered_permissions::decide_instance(&app, &state, &instance, &capability, allowed).await
}

#[tauri::command]
pub async fn mini_app_permission_list(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
) -> Result<Vec<String>, String> {
    require_host(&webview)?;
    remembered_permissions::restore_instance(&state, &instance).await?;
    let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
    let permissions = &mut registry
        .get_mut(&instance)
        .ok_or("App is closed.")?
        .permissions;
    let mut result: Vec<_> = permissions.granted.iter().cloned().collect();
    result.sort();
    Ok(result)
}

#[tauri::command]
pub fn mini_app_context(
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
) -> Result<Value, String> {
    require_host(&webview)?;
    let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
    let registered = registry.get(&instance).ok_or("App is closed.")?;
    let scope = registered
        .root
        .parent()
        .and_then(|path| path.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("installed");
    Ok(
        json!({"appId":format!("{scope}:{}",registered.permissions.app_id), "slug":registered.permissions.app_id, "version":registered.permissions.version, "platform":"desktop"}),
    )
}

#[tauri::command]
pub async fn mini_app_device_call(
    app: AppHandle,
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    require_host(&webview)?;
    if method == "files.renderOwnedImage" {
        return document_processing::image_preview(&state, &instance, params).await;
    }
    if method == "files.listArchive" {
        return file_preview::list_archive(&state, &instance, params).await;
    }
    if let Some(feature) = unavailable_feature(&method) {
        return Err(format!(
            "{feature} aren't available in this version of Misty."
        ));
    }
    if method == "media.status" {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        if !registry.contains_key(&instance) {
            return Err("App is closed.".into());
        }
        return Ok(media::availability());
    }
    if method == "backups.status" {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        if !registry.contains_key(&instance) {
            return Err("App is closed.".into());
        }
        return Ok(
            json!({"available":false,"format":"misty-tar-v1","message":"Backups aren't available in this version of Misty."}),
        );
    }
    if method == "downloads.status" {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        if !registry.contains_key(&instance) {
            return Err("App is closed.".into());
        }
        return Ok(downloads::availability());
    }
    if matches!(
        method.as_str(),
        "files.listSavedDirectories"
            | "files.rememberDirectory"
            | "files.reopenDirectory"
            | "files.forgetDirectory"
    ) {
        #[cfg(any(target_os = "macos", windows))]
        return directory_bookmarks::execute(&state, &instance, &method, &params).await;
        #[cfg(not(any(target_os = "macos", windows)))]
        return Err("Saved folder access is not implemented on this platform yet.".into());
    }
    if matches!(
        method.as_str(),
        "files.shareDirectory" | "files.adoptDirectory" | "files.cancelDirectoryShare"
    ) {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        return directory_handoff::execute(&mut registry, &instance, &method, &params);
    }
    if method == "files.release" {
        let handle = params
            .get("handle")
            .and_then(Value::as_str)
            .ok_or("Missing file handle.")?;
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let permissions = &mut registry
            .get_mut(&instance)
            .ok_or("App is closed.")?
            .permissions;
        binary_files::release(permissions, handle);
        return Ok(Value::Null);
    }
    let required = capability(&method, &params)?;
    if method == "documents.prepare" {
        return document_processing::execute(&state, &instance, params).await;
    }
    let (epoch, mut cancellation) = {
        let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let permissions = &registry.get(&instance).ok_or("App is closed.")?.permissions;
        permissions.authorize(&required)?;
        (permissions.epoch, permissions.cancellation.subscribe())
    };
    if matches!(
        method.as_str(),
        "files.listDirectory"
            | "files.openEntry"
            | "files.createEntry"
            | "files.renameEntry"
            | "files.removeEntry"
            | "files.watchDirectory"
    ) {
        let request = {
            let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
            let permissions = &registry.get(&instance).ok_or("App is closed.")?.permissions;
            if permissions.epoch != epoch {
                return Err("Folder permission changed.".into());
            }
            directories::prepare(permissions, &method, &params)?
        };
        let pending = tokio::task::spawn_blocking(move || {
            let result = request.run();
            (request, result)
        });
        let (request, result) = tokio::select! {
            biased;
            _ = cancellation.changed() => return Err("Folder access was revoked or the App closed.".into()),
            result = pending => result.map_err(|_| "The folder operation failed.")?,
        };
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let permissions = &mut registry
            .get_mut(&instance)
            .ok_or("App is closed.")?
            .permissions;
        return request.commit(permissions, result?);
    }
    if method == "network.fetch" {
        return tokio::select! {
            biased;
            _ = cancellation.changed() => Err("Network permission was revoked or the App closed.".into()),
            result = network_fetch(&params) => result,
        };
    }
    if method == "files.openTrash" {
        {
            let (owner, epoch) = {
                let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
                file_trash::prepare(&registry.get(&instance).ok_or("App is closed.")?.permissions)?
            };
            let root = app
                .path()
                .app_data_dir()
                .map_err(|_| "App storage is unavailable.")?
                .join("app-trash");
            #[cfg(all(debug_assertions, target_os = "macos"))]
            let root = app
                .try_state::<MiniAppProbeDirectory>()
                .map(|probe| probe.0.join(".misty-app-trash"))
                .unwrap_or(root);
            let storage_owner = owner.clone();
            let directory = tokio::task::spawn_blocking(move || {
                file_trash::open_directory(&root, &storage_owner)
            })
            .await
            .map_err(|_| "Could not open App Trash.")??;
            let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
            return file_trash::commit(
                &mut registry
                    .get_mut(&instance)
                    .ok_or("App is closed.")?
                    .permissions,
                &owner,
                epoch,
                directory,
            );
        }
    }
    if method == "files.pickDirectory" {
        let (send, receive) = tokio::sync::oneshot::channel();
        let picker = app
            .dialog()
            .file()
            .set_title("Choose a folder to share with this App");
        #[cfg(all(debug_assertions, target_os = "macos"))]
        let picker = if let Some(probe) = app.try_state::<MiniAppProbeDirectory>() {
            picker.set_directory(&probe.0)
        } else {
            picker
        };
        picker.pick_folder(move |folder| {
            let _ = send.send(folder);
        });
        let path = tokio::select! {
            biased;
            _ = cancellation.changed() => return Err("Folder permission was revoked or the App closed.".into()),
            result = tokio::time::timeout(std::time::Duration::from_secs(300), receive) =>
                result.map_err(|_| "Folder selection expired.")?.map_err(|_| "Folder selection was cancelled.")?,
        };
        let Some(path) = path else {
            return Ok(Value::Null);
        };
        let path = path
            .into_path()
            .map_err(|_| "This folder location is not supported.")?;
        #[cfg(all(debug_assertions, target_os = "macos"))]
        if let Some(probe) = app.try_state::<MiniAppProbeDirectory>() {
            let expected = probe
                .0
                .canonicalize()
                .map_err(|_| "Disposable export folder is unavailable")?;
            if path
                .canonicalize()
                .map_err(|_| "Selected folder is unavailable")?
                != expected
            {
                return Err("Native probe permits only its disposable export folder.".into());
            }
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Folder")
            .to_owned();
        let directory = tokio::task::spawn_blocking(move || {
            cap_std::fs::Dir::open_ambient_dir(path, cap_std::ambient_authority())
        })
        .await
        .map_err(|_| "Folder selection failed.")?
        .map_err(|_| "The folder could not be opened.")?;
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let permissions = &mut registry
            .get_mut(&instance)
            .ok_or("App is closed.")?
            .permissions;
        permissions.authorize(&required)?;
        if permissions.epoch != epoch {
            return Err("Permission changed during folder selection.".into());
        }
        if permissions.folders.len() >= 32 {
            return Err("Close and reopen the App before choosing more folders.".into());
        }
        let handle = uuid::Uuid::new_v4().to_string();
        permissions.folders.insert(
            handle.clone(),
            file_jobs::FolderGrant {
                released: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                directory: std::sync::Arc::new(directory),
                name: name.clone(),
                writable: params.get("write") == Some(&Value::Bool(true)),
            },
        );
        return Ok(json!({"handle":handle,"name":name}));
    }
    if matches!(
        method.as_str(),
        "files.stat" | "files.watchStatus" | "files.watchClose"
    ) {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let permissions = &mut registry
            .get_mut(&instance)
            .ok_or("App is closed.")?
            .permissions;
        permissions.authorize(&required)?;
        if permissions.epoch != epoch {
            return Err("App permission changed.".into());
        }
        return file_observation::execute(permissions, &method, &params);
    }
    #[cfg(target_os = "macos")]
    if method.starts_with("files.tree") {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let p = &mut registry
            .get_mut(&instance)
            .ok_or("App is closed.")?
            .permissions;
        if p.epoch != epoch {
            return Err("App permission changed.".into());
        }
        return tree_drafts::execute(p, &method, &params);
    }
    if method.starts_with("files.transfer") {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let permissions = &mut registry
            .get_mut(&instance)
            .ok_or("App is closed.")?
            .permissions;
        permissions.authorize(&required)?;
        if permissions.epoch != epoch {
            return Err("App permission changed.".into());
        }
        return file_transfers::execute(permissions, &method, &params);
    }
    if method.starts_with("downloads.") {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let permissions = &mut registry
            .get_mut(&instance)
            .ok_or("App is closed.")?
            .permissions;
        permissions.authorize(&required)?;
        if permissions.epoch != epoch {
            return Err("App permission changed.".into());
        }
        return downloads::execute(permissions, &method, &params);
    }
    if method == "files.pick" || method == "files.pickMany" {
        let (send, receive) = tokio::sync::oneshot::channel();
        let picker = app
            .dialog()
            .file()
            .set_title("Choose files to share with this App");
        if method == "files.pickMany" {
            picker.pick_files(move |files| {
                let _ = send.send(files);
            });
        } else {
            picker.pick_file(move |file| {
                let _ = send.send(file.map(|file| vec![file]));
            });
        }
        let paths = tokio::select! {
            biased;
            _ = cancellation.changed() => return Err("File permission was revoked or the App closed.".into()),
            result = tokio::time::timeout(std::time::Duration::from_secs(300), receive) =>
                result.map_err(|_| "File selection expired.")?.map_err(|_| "File selection was cancelled.")?,
        };
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let permissions = &mut registry
            .get_mut(&instance)
            .ok_or("App is closed.")?
            .permissions;
        permissions.authorize(&required)?;
        if permissions.epoch != epoch {
            return Err("Permission changed during file selection.".into());
        }
        let paths = paths.unwrap_or_default();
        if paths.len() > 64 || paths.len() + permissions.files.len() > 128 {
            return Err(
                "Choose up to 64 files and release earlier selections before choosing more.".into(),
            );
        }
        let mut selected = Vec::new();
        let mut results = Vec::new();
        for path in paths {
            let path = path
                .into_path()
                .map_err(|_| "This file location is not supported.")?;
            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("File")
                .to_owned();
            let writable =
                method == "files.pick" && params.get("write") == Some(&Value::Bool(true));
            let mut options = fs::OpenOptions::new();
            options.read(true).write(writable);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.custom_flags(libc::O_NONBLOCK);
            }
            let file = options
                .open(path)
                .map_err(|_| "Could not open the chosen file.")?;
            let metadata = file
                .metadata()
                .map_err(|_| "File information is unavailable.")?;
            if !metadata.is_file() {
                return Err("Choose regular files only.".into());
            }
            let handle = uuid::Uuid::new_v4().to_string();
            results.push(json!({"handle":handle,"name":name,"bytes":metadata.len()}));
            selected.push((handle, FileGrant { file, writable }));
        }
        permissions.files.extend(selected);
        return Ok(if method == "files.pickMany" {
            json!(results)
        } else {
            results.into_iter().next().unwrap_or(Value::Null)
        });
    }
    if method.starts_with("media.convert") {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let permissions = &mut registry
            .get_mut(&instance)
            .ok_or("App is closed.")?
            .permissions;
        permissions.authorize(&required)?;
        if permissions.epoch != epoch {
            return Err("App permission changed.".into());
        }
        return media::execute(permissions, &method, &params);
    }
    if binary_files::supports(&method) {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        let permissions = &mut registry
            .get_mut(&instance)
            .ok_or("App is closed.")?
            .permissions;
        permissions.authorize(&required)?;
        if permissions.epoch != epoch {
            return Err("App permission changed.".into());
        }
        return binary_files::execute(permissions, &method, &params);
    }
    // These short operations hold the authorization lock through the access;
    // revocation takes effect before the next operation can begin.
    let registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
    let permissions = &registry.get(&instance).ok_or("App is closed.")?.permissions;
    permissions.authorize(&required)?;
    if permissions.epoch != epoch {
        return Err("App permission changed.".into());
    }
    match method.as_str() {
        "clipboard.readText" => {
            let text = arboard::Clipboard::new()
                .map_err(|e| e.to_string())?
                .get_text()
                .map_err(|e| e.to_string())?;
            if text.len() > 262_144 {
                return Err("Clipboard text exceeds 256 KB.".into());
            }
            Ok(json!({"text":text}))
        }
        "clipboard.writeText" => {
            let text = bounded_text(&params)?;
            arboard::Clipboard::new()
                .map_err(|e| e.to_string())?
                .set_text(text)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "clipboard.writeImage" => {
            let image = clipboard::decode_png(&params)?;
            arboard::Clipboard::new()
                .map_err(|_| "The clipboard is unavailable.")?
                .set_image(image)
                .map_err(|_| "The image could not be copied.")?;
            Ok(Value::Null)
        }
        "clipboard.readImage" => {
            let image = match arboard::Clipboard::new()
                .map_err(|_| "The clipboard is unavailable.")?
                .get_image()
            {
                Ok(image) => image,
                Err(arboard::Error::ContentNotAvailable) => return Ok(Value::Null),
                Err(_) => return Err("The clipboard image could not be read.".into()),
            };
            clipboard::encode_png(image)
        }
        "files.openExternal" => file_open::execute(permissions, &params),
        // Source descriptors and paths remain in the compiled Host adapter. This
        // device handshake applies the same native revocable grant before access.
        "files.sources.list"
        | "files.sources.open"
        | "terminal.authorize"
        | "connections.authorize" => Ok(Value::Null),
        "files.readText" | "files.writeText" => text_files::execute(permissions, &method, &params),
        _ => Err("This device operation is not implemented on this platform yet.".into()),
    }
}
fn bounded_text(params: &Value) -> Result<String, String> {
    let text = params
        .get("text")
        .and_then(Value::as_str)
        .ok_or("Missing text.")?;
    if text.len() > 262_144 {
        return Err("Text is limited to 256 KB.".into());
    }
    Ok(text.into())
}

fn public_address(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_multicast()
                && !ip.is_unspecified()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && a != 0
                && a < 224
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 198 && (b == 18 || b == 19))
        }
        std::net::IpAddr::V6(ip) => {
            let first = ip.segments()[0];
            // Global unicast only; deny mapped/private/transition addresses.
            (first & 0xe000) == 0x2000
                && first != 0x2002
                && !(first == 0x2001 && (ip.segments()[1] == 0 || ip.segments()[1] == 0xdb8))
        }
    }
}
async fn network_fetch(params: &Value) -> Result<Value, String> {
    let url = url::Url::parse(
        params
            .get("url")
            .and_then(Value::as_str)
            .ok_or("Missing URL.")?,
    )
    .map_err(|_| "Invalid URL.")?;
    origin(url.as_str())?;
    let host = url.host_str().ok_or("Missing network host.")?;
    let port = url.port_or_known_default().ok_or("Invalid port.")?;
    let addresses: Vec<_> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| "Network host could not be resolved.")?
        .collect();
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|address| !public_address(address.ip()))
    {
        return Err(
            "App network requests cannot access local or private network addresses.".into(),
        );
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(std::time::Duration::from_secs(20))
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|e| e.to_string())?;
    let method = params
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET");
    if !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].contains(&method) {
        return Err("Unsupported network method.".into());
    }
    let mut request = client.request(method.parse().map_err(|_| "Invalid method.")?, url);
    if let Some(headers) = params.get("headers") {
        let headers = headers.as_object().ok_or("Invalid request headers.")?;
        if headers.len() > 40 {
            return Err("Too many request headers.".into());
        }
        for (name, value) in headers {
            if [
                "cookie",
                "host",
                "origin",
                "referer",
                "proxy-authorization",
                "connection",
                "content-length",
                "transfer-encoding",
            ]
            .contains(&name.to_ascii_lowercase().as_str())
            {
                return Err("This request header is not allowed.".into());
            }
            let value = value
                .as_str()
                .filter(|s| s.len() <= 8192)
                .ok_or("Invalid header value.")?;
            request = request.header(name, value);
        }
    }
    if let Some(body) = params.get("body").filter(|body| !body.is_null()) {
        let body = if let Some(text) = body.as_str() {
            text.as_bytes().to_vec()
        } else {
            serde_json::from_value::<Vec<u8>>(
                body.get("$mistyBytes")
                    .cloned()
                    .ok_or("Invalid request body.")?,
            )
            .map_err(|_| "Invalid binary body.")?
        };
        if body.len() > 262_144 {
            return Err("Request body exceeds 256 KB.".into());
        }
        request = request.body(body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "The App network request failed.")?;
    let status = response.status().as_u16();
    let headers: Vec<_> = response
        .headers()
        .iter()
        .filter(|(name, _)| name.as_str() != "set-cookie")
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_owned(), value.to_owned()))
        })
        .collect();
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Response could not be read.")?
    {
        if body.len() + chunk.len() > 131_072 {
            return Err("Response exceeds 128 KB. Use a paged endpoint.".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(json!({"status":status,"headers":headers,"body":{"$mistyBytes":body}}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn permissions_require_declaration_and_explicit_grant() {
        let mut permissions = PermissionSet::from_document(
            "app",
            &json!({"runtime_capabilities":["files.read", "clipboard.read"]}),
            None,
        )
        .unwrap();
        assert!(permissions.authorize("files.read").is_err());
        assert!(permissions.decide("files.write", true).is_err());
        permissions.decide("files.read", true).unwrap();
        assert!(permissions.authorize("files.read").is_ok());
        permissions.files.insert(
            "file".into(),
            FileGrant {
                file: tempfile::tempfile().unwrap(),
                writable: false,
            },
        );
        permissions.decide("files.read", false).unwrap();
        assert!(permissions.files.is_empty());
        assert!(permissions.authorize("files.read").is_err());
        assert_eq!(permissions.epoch, 1);
        assert!(permissions.denied.contains("files.read"));
    }

    #[test]
    fn clipboard_images_require_the_declared_revocable_write_grant() {
        let document = json!({"runtime_capabilities":["clipboard.write"]});
        let mut permissions = PermissionSet::from_document("journal", &document, None).unwrap();
        let required = capability("clipboard.writeImage", &json!({})).unwrap();
        assert_eq!(required, "clipboard.write");
        assert!(permissions.authorize(&required).is_err());
        permissions.decide(&required, true).unwrap();
        assert!(permissions.authorize(&required).is_ok());
        permissions.decide(&required, false).unwrap();
        assert!(permissions.authorize(&required).is_err());
        let limited = PermissionSet::from_document("journal", &document, Some(&[])).unwrap();
        assert!(limited.declaration(&required).is_err());
        let read = capability("clipboard.readImage", &json!({})).unwrap();
        assert_eq!(read, "clipboard.read");
        assert!(permissions.declaration(&read).is_err());
    }

    #[test]
    fn appearance_operations_require_the_declared_revocable_grant() {
        let document = json!({"runtime_capabilities":["appearance.write"]});
        let mut permissions = PermissionSet::from_document("themes", &document, None).unwrap();
        for method in [
            "appearance.preview",
            "appearance.apply",
            "appearance.preset",
            "appearance.revert",
        ] {
            let required = capability(method, &json!({})).unwrap();
            assert_eq!(required, "appearance.write");
            assert!(permissions.authorize(&required).is_err());
        }
        permissions.decide("appearance.write", true).unwrap();
        assert!(permissions.authorize("appearance.write").is_ok());
        permissions.decide("appearance.write", false).unwrap();
        assert!(permissions.authorize("appearance.write").is_err());
        assert!(capability("appearance.execute", &json!({})).is_err());
        let limited = PermissionSet::from_document("themes", &document, Some(&[])).unwrap();
        assert!(limited.declaration("appearance.write").is_err());
    }

    #[tokio::test]
    async fn revocation_and_close_cancel_pending_permission_leases() {
        let mut permissions = PermissionSet::from_document("app", &json!({"runtime_capabilities":["network.fetch"], "runtime_network_origins":["https://example.com"]}), None).unwrap();
        permissions
            .decide("network.fetch@https://example.com", true)
            .unwrap();
        let mut lease = permissions.cancellation.subscribe();
        permissions
            .decide("network.fetch@https://example.com", false)
            .unwrap();
        assert!(lease.changed().await.is_ok());
        drop(permissions);
        assert!(lease.changed().await.is_err());
    }
    #[test]
    fn server_scope_limit_and_network_origins_cannot_be_expanded() {
        let permissions = PermissionSet::from_document(
            "app",
            &json!({"runtime_capabilities":["files.read","files.write"]}),
            Some(&["files.read".into()]),
        )
        .unwrap();
        assert!(permissions.declaration("files.write").is_err());
        let mut permissions = PermissionSet::from_document("app", &json!({"runtime_capabilities":["network.fetch"],"runtime_network_origins":["https://example.com"]}), None).unwrap();
        permissions
            .decide("network.fetch@https://example.com", true)
            .unwrap();
        assert!(permissions
            .authorize("network.fetch@https://another.com")
            .is_err());
        assert!(origin("http://localhost").is_err());
        assert!(origin("https://user:password@example.com").is_err());
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
        ] {
            assert!(!public_address(ip.parse().unwrap()));
        }
        assert!(public_address("8.8.8.8".parse().unwrap()));
    }
}

/// Duplicate a read-only temporary file between two live views of the same
/// Space installation. Package RPCs cannot choose either native instance.
#[tauri::command]
pub fn mini_app_duplicate_file_grant(
    webview: Webview,
    state: State<'_, MiniAppState>,
    source_instance: String,
    target_instance: String,
    handle: String,
) -> Result<Value, String> {
    require_host(&webview)?;
    let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
    let (file, owner, app, version) = {
        let p = &registry
            .get(&source_instance)
            .ok_or("Source view closed.")?
            .permissions;
        p.authorize("files.read")?;
        if !p.account_owned || p.native_owner.is_none() {
            return Err("A Space app is required.".into());
        }
        let source = p
            .files
            .get(&handle)
            .ok_or("Source file grant is unavailable.")?;
        if source.writable {
            return Err("Only read-only files may be handed to another view.".into());
        }
        (
            source
                .file
                .try_clone()
                .map_err(|_| "Could not duplicate the owned file.")?,
            p.native_owner.clone(),
            p.app_id.clone(),
            p.version.clone(),
        )
    };
    let p = &mut registry
        .get_mut(&target_instance)
        .ok_or("Target view closed.")?
        .permissions;
    p.authorize("files.read")?;
    if !p.account_owned || p.native_owner != owner || p.app_id != app || p.version != version {
        return Err("File grants cannot cross accounts, Spaces, apps, or releases.".into());
    }
    if p.files.len() >= 256 {
        return Err("Close a file before opening another.".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    p.files.insert(
        id.clone(),
        FileGrant {
            file,
            writable: false,
        },
    );
    Ok(json!({"handle": id}))
}

#[cfg(test)]
mod builtin_tests {
    use super::*;

    #[test]
    fn builtin_workers_have_only_their_required_scopes() {
        let files = PermissionSet::builtin("files", "documents").unwrap();
        assert!(files.authorize("files.read").is_ok());
        assert!(files.authorize("files.write").is_err());
        assert!(files.authorize("connections.read").is_err());
        assert!(files.authorize("terminal.execute").is_err());
        let devices = PermissionSet::builtin("files", "devices").unwrap();
        assert!(devices.authorize("connections.read").is_ok());
        assert!(devices.files.is_empty());
        assert!(devices.folders.is_empty());
        assert!(PermissionSet::builtin("library", "devices").is_err());
        assert!(PermissionSet::builtin("../../custom", "documents").is_err());
    }
}
