//! Changes a paired device makes to this device's files. The connection layer
//! has already checked the ticket and this device's consent; everything here
//! stays inside the shared roots and never replaces an existing item. The
//! requesting device resolves conflicts before it asks.

use std::{
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc},
};

use crate::{
    domain::{
        connected_devices::{PeerEntry, PeerRequest, PeerResponse},
        explorer::{
            ClipboardOperation, CreateItemKind, CreateItemRequest, DeleteItemsRequest, PasteItem,
            PasteItemsRequest, RenameItemRequest,
        },
    },
    error::{ApiError, ApiResult},
    infra::{
        explorer::ExplorerService,
        peer_files::{PeerRootRegistry, PeerVirtualPath},
    },
};

/// Applies every change except `WriteFile`, which streams its content first.
pub async fn apply_change(
    roots: &PeerRootRegistry,
    explorer: &ExplorerService,
    device_id: &str,
    request: PeerRequest,
) -> ApiResult<PeerResponse> {
    let cancellation = Arc::new(AtomicBool::new(false));
    match request {
        PeerRequest::CreateItem {
            directory,
            name,
            folder,
        } => {
            let parent = PeerVirtualPath::parse(&directory)?;
            let local = roots.new_child(&parent.root_id, &parent.relative_path, &name)?;
            ensure_vacant(&local)?;
            explorer
                .create_item_with_cancellation(
                    CreateItemRequest {
                        directory: local_text(local.parent())?,
                        name: name.clone(),
                        kind: if folder {
                            CreateItemKind::Folder
                        } else {
                            CreateItemKind::File
                        },
                    },
                    cancellation,
                )
                .await?;
            stat_child(roots, device_id, &parent, &name)
        }
        PeerRequest::RenameItem { path, new_name } => {
            let source = PeerVirtualPath::parse(&path)?;
            let local = roots.resolve_item(&source.root_id, &source.relative_path)?;
            let parent = parent_of(&source)?;
            let destination = roots.new_child(&parent.root_id, &parent.relative_path, &new_name)?;
            if destination != local {
                ensure_vacant(&destination)?;
            }
            explorer
                .rename_item_with_cancellation(
                    RenameItemRequest {
                        path: local_text(Some(&local))?,
                        new_name: new_name.clone(),
                        source_is_directory: Some(local.is_dir()),
                    },
                    cancellation,
                )
                .await?;
            stat_child(roots, device_id, &parent, &new_name)
        }
        PeerRequest::TransferItem {
            path,
            destination_directory,
            name,
            keep_source,
        } => {
            let source = PeerVirtualPath::parse(&path)?;
            let target = PeerVirtualPath::parse(&destination_directory)?;
            let local = roots.resolve_item(&source.root_id, &source.relative_path)?;
            let destination = roots.new_child(&target.root_id, &target.relative_path, &name)?;
            ensure_vacant(&destination)?;
            if local.is_dir() && destination.starts_with(&local) {
                return Err(ApiError::Message(
                    "A folder cannot be copied or moved into itself.".to_owned(),
                ));
            }
            explorer
                .paste_items_with_cancellation(
                    PasteItemsRequest {
                        sources: vec![PasteItem {
                            path: local_text(Some(&local))?,
                            is_directory: local.is_dir(),
                            size_bytes: None,
                            remote_modified: None,
                        }],
                        destination_directory: local_text(destination.parent())?,
                        operation: if keep_source {
                            ClipboardOperation::Copy
                        } else {
                            ClipboardOperation::Move
                        },
                        target_name: Some(name.clone()),
                    },
                    cancellation,
                )
                .await?;
            stat_child(roots, device_id, &target, &name)
        }
        PeerRequest::DeleteItem { path, permanent } => {
            let source = PeerVirtualPath::parse(&path)?;
            let local = roots.resolve_item(&source.root_id, &source.relative_path)?;
            explorer
                .delete_items_with_cancellation(
                    DeleteItemsRequest {
                        paths: vec![local_text(Some(&local))?],
                        permanent,
                    },
                    cancellation,
                )
                .await?;
            Ok(PeerResponse::Deleted)
        }
        _ => Err(ApiError::Message(
            "This request does not change files.".to_owned(),
        )),
    }
}

/// Where an incoming file is staged and where it lands once complete.
pub struct PreparedUpload {
    pub staging: PathBuf,
    pub destination: PathBuf,
    parent: PeerVirtualPath,
    name: String,
}

pub fn prepare_upload(
    roots: &PeerRootRegistry,
    directory: &str,
    name: &str,
) -> ApiResult<PreparedUpload> {
    let parent = PeerVirtualPath::parse(directory)?;
    let destination = roots.new_child(&parent.root_id, &parent.relative_path, name)?;
    ensure_vacant(&destination)?;
    // Staged beside the destination so the final rename stays on one volume.
    let staging = destination.with_file_name(format!(
        ".{name}.misty-incoming-{}",
        uuid::Uuid::new_v4().simple()
    ));
    Ok(PreparedUpload {
        staging,
        destination,
        parent,
        name: name.to_owned(),
    })
}

pub async fn finish_upload(
    roots: &PeerRootRegistry,
    device_id: &str,
    upload: PreparedUpload,
) -> ApiResult<PeerResponse> {
    // A plain rename would silently replace an item created meanwhile.
    if let Err(error) = ensure_vacant(&upload.destination) {
        let _ = tokio::fs::remove_file(&upload.staging).await;
        return Err(error);
    }
    tokio::fs::rename(&upload.staging, &upload.destination)
        .await
        .map_err(|error| ApiError::Message(format!("Could not save the received file: {error}")))?;
    stat_child(roots, device_id, &upload.parent, &upload.name)
}

fn ensure_vacant(path: &Path) -> ApiResult<()> {
    if std::fs::symlink_metadata(path).is_ok() {
        return Err(ApiError::Message(format!(
            "An item named {} already exists.",
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default()
        )));
    }
    Ok(())
}

fn parent_of(path: &PeerVirtualPath) -> ApiResult<PeerVirtualPath> {
    let parent = path
        .parent()?
        .ok_or_else(|| ApiError::Message("A shared root cannot be changed.".to_owned()))?;
    PeerVirtualPath::parse(&parent)
}

fn stat_child(
    roots: &PeerRootRegistry,
    device_id: &str,
    parent: &PeerVirtualPath,
    name: &str,
) -> ApiResult<PeerResponse> {
    let entry: PeerEntry =
        roots.stat(device_id, &parent.root_id, &parent.relative_path.join(name))?;
    Ok(PeerResponse::Stat { entry })
}

fn local_text(path: Option<&Path>) -> ApiResult<String> {
    path.and_then(|path| path.to_str())
        .map(str::to_owned)
        .ok_or_else(|| ApiError::Message("This path cannot be changed remotely.".to_owned()))
}
