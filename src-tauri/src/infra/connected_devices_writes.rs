//! This device changing a paired device's files. The paired device enforces
//! its own consent; these calls only carry the request and stream content.

use super::*;
use crate::domain::connected_devices::PeerEntry;
use crate::infra::peer_files::PeerVirtualPath;

const UPLOAD_CHUNK_BYTES: usize = 256 * 1024;

impl ConnectedDevicesService {
    /// Whether the current authorization lets this device change the peer's files.
    pub fn can_write(&self, device_id: &str) -> bool {
        let Ok(guard) = self.state.read() else {
            return false;
        };
        guard
            .as_ref()
            .and_then(|state| {
                let connections = state.connections.read().ok()?;
                let peer = connections.get(device_id)?;
                Some(peer.claims.exp > unix_now() && has_permission(&peer.claims, "files:write"))
            })
            .unwrap_or(false)
    }

    /// The item at `path`, or `None` when nothing is there.
    pub async fn stat_item(&self, path: &str) -> ApiResult<Option<PeerEntry>> {
        let parsed = PeerVirtualPath::parse(path)?;
        let connection = self.authorized_connection(&parsed.device_id)?;
        let (mut send, mut receive) = connection
            .open_bi()
            .await
            .map_err(|error| ApiError::Unavailable(error.to_string()))?;
        write_request(
            &mut send,
            PeerRequest::Stat {
                path: path.to_owned(),
            },
        )
        .await?;
        let response: PeerResponseEnvelope = read_frame(&mut receive).await?;
        match response.response {
            Ok(PeerResponse::Stat { entry }) => Ok(Some(entry)),
            Ok(_) => Err(unexpected_response()),
            Err(error) if matches!(error.code, PeerErrorCode::NotFound) => Ok(None),
            Err(error) => Err(peer_error(error)),
        }
    }

    pub async fn create_item(
        &self,
        directory: &str,
        name: &str,
        folder: bool,
    ) -> ApiResult<PeerEntry> {
        let device_id = PeerVirtualPath::parse(directory)?.device_id;
        self.change(
            &device_id,
            PeerRequest::CreateItem {
                directory: directory.to_owned(),
                name: name.to_owned(),
                folder,
            },
        )
        .await
    }

    pub async fn rename_item(&self, path: &str, new_name: &str) -> ApiResult<PeerEntry> {
        let device_id = PeerVirtualPath::parse(path)?.device_id;
        self.change(
            &device_id,
            PeerRequest::RenameItem {
                path: path.to_owned(),
                new_name: new_name.to_owned(),
            },
        )
        .await
    }

    /// Copies (`keep_source`) or moves an item within one paired device.
    pub async fn transfer_item(
        &self,
        path: &str,
        destination_directory: &str,
        name: &str,
        keep_source: bool,
    ) -> ApiResult<PeerEntry> {
        let source = PeerVirtualPath::parse(path)?;
        if PeerVirtualPath::parse(destination_directory)?.device_id != source.device_id {
            return Err(ApiError::Message(
                "Items move between devices through this device.".to_owned(),
            ));
        }
        self.change(
            &source.device_id,
            PeerRequest::TransferItem {
                path: path.to_owned(),
                destination_directory: destination_directory.to_owned(),
                name: name.to_owned(),
                keep_source,
            },
        )
        .await
    }

    pub async fn delete_item(&self, path: &str, permanent: bool) -> ApiResult<()> {
        let device_id = PeerVirtualPath::parse(path)?.device_id;
        match self
            .request(
                &device_id,
                PeerRequest::DeleteItem {
                    path: path.to_owned(),
                    permanent,
                },
            )
            .await?
        {
            PeerResponse::Deleted => Ok(()),
            _ => Err(unexpected_response()),
        }
    }

    /// Sends a local file or folder into `directory` on a paired device as `name`.
    /// Links are skipped, as the local copy does for remote folders.
    pub async fn upload_tree(
        &self,
        local: &Path,
        directory: &str,
        name: &str,
        watch: TransferWatch<'_>,
    ) -> ApiResult<PeerEntry> {
        let metadata = tokio::fs::symlink_metadata(local).await.map_err(|error| {
            ApiError::Message(format!("Could not read {}: {error}", local.display()))
        })?;
        if !metadata.is_dir() {
            return self.upload_file(local, directory, name, watch).await;
        }
        let root = self.create_item(directory, name, true).await?;
        let mut pending = vec![(local.to_path_buf(), root.path.clone())];
        while let Some((local_directory, remote_directory)) = pending.pop() {
            let mut children = tokio::fs::read_dir(&local_directory)
                .await
                .map_err(|error| ApiError::Message(format!("Could not read folder: {error}")))?;
            while let Some(child) = children
                .next_entry()
                .await
                .map_err(|error| ApiError::Message(format!("Could not read folder: {error}")))?
            {
                watch.check()?;
                let child_name = child.file_name().to_string_lossy().into_owned();
                let file_type = child.file_type().await.map_err(|error| {
                    ApiError::Message(format!("Could not read folder: {error}"))
                })?;
                if file_type.is_dir() {
                    let created = self
                        .create_item(&remote_directory, &child_name, true)
                        .await?;
                    pending.push((child.path(), created.path));
                } else if file_type.is_file() {
                    self.upload_file(&child.path(), &remote_directory, &child_name, watch)
                        .await?;
                }
            }
        }
        Ok(root)
    }

    pub async fn upload_file(
        &self,
        local: &Path,
        directory: &str,
        name: &str,
        watch: TransferWatch<'_>,
    ) -> ApiResult<PeerEntry> {
        watch.check()?;
        let device_id = PeerVirtualPath::parse(directory)?.device_id;
        let mut file = tokio::fs::File::open(local).await.map_err(|error| {
            ApiError::Message(format!("Could not open {}: {error}", local.display()))
        })?;
        let size = file
            .metadata()
            .await
            .map_err(|error| {
                ApiError::Message(format!("Could not read {}: {error}", local.display()))
            })?
            .len();
        let connection = self.authorized_connection(&device_id)?;
        let (mut send, mut receive) = connection
            .open_bi()
            .await
            .map_err(|error| ApiError::Unavailable(error.to_string()))?;
        let request_id = uuid::Uuid::new_v4().to_string();
        let frame = encode_control_frame(&PeerRequestEnvelope {
            request_id: request_id.clone(),
            request: PeerRequest::WriteFile {
                directory: directory.to_owned(),
                name: name.to_owned(),
                size,
            },
        })?;
        let sent = async {
            send.write_all(&frame)
                .await
                .map_err(|error| ApiError::Unavailable(error.to_string()))?;
            let mut remaining = size;
            let mut buffer = vec![0u8; UPLOAD_CHUNK_BYTES];
            while remaining > 0 {
                watch.check()?;
                let wanted = remaining.min(buffer.len() as u64) as usize;
                let count = file.read(&mut buffer[..wanted]).await.map_err(|error| {
                    ApiError::Message(format!("Could not read the file: {error}"))
                })?;
                if count == 0 {
                    return Err(ApiError::Message(
                        "The file changed while it was being sent.".to_owned(),
                    ));
                }
                send.write_all(&buffer[..count])
                    .await
                    .map_err(|error| ApiError::Unavailable(error.to_string()))?;
                remaining -= count as u64;
                watch.advance(count as u64);
            }
            finish_stream(&mut send)
                .await
                .map_err(ApiError::Unavailable)
        }
        .await;
        // The device may refuse before reading everything (for example, a name
        // already in use). Its answer explains a failed send better than the
        // transport error does.
        let answer = read_frame::<PeerResponseEnvelope>(&mut receive).await;
        if let Err(error) = sent {
            if is_canceled(&error) {
                return Err(error);
            }
            return match answer {
                Ok(PeerResponseEnvelope {
                    response: Err(peer),
                    ..
                }) => Err(peer_error(peer)),
                _ => Err(error),
            };
        }
        let answer = answer?;
        if answer.request_id != request_id {
            return Err(ApiError::Message(
                "Peer response request ID did not match.".to_owned(),
            ));
        }
        match answer.response.map_err(peer_error)? {
            PeerResponse::Stat { entry } => Ok(entry),
            _ => Err(unexpected_response()),
        }
    }

    /// The bytes in a file or folder on a paired device, for download progress.
    pub async fn remote_tree_size(&self, path: &str) -> ApiResult<u64> {
        let Some(entry) = self.stat_item(path).await? else {
            return Err(ApiError::Message("Remote path was not found.".to_owned()));
        };
        if !matches!(
            entry.kind,
            crate::domain::connected_devices::PeerEntryKind::Directory
        ) {
            return Ok(entry.size_bytes.unwrap_or(0));
        }
        let device_id = PeerVirtualPath::parse(path)?.device_id;
        let mut total = 0;
        let mut pending = vec![path.to_owned()];
        while let Some(directory) = pending.pop() {
            let response = self
                .request(
                    &device_id,
                    PeerRequest::ListDirectory {
                        path: directory,
                        show_hidden: true,
                    },
                )
                .await?;
            let PeerResponse::Directory { entries, .. } = response else {
                return Err(unexpected_response());
            };
            for child in entries {
                match child.kind {
                    crate::domain::connected_devices::PeerEntryKind::Directory => {
                        pending.push(child.path)
                    }
                    crate::domain::connected_devices::PeerEntryKind::File => {
                        total += child.size_bytes.unwrap_or(0)
                    }
                    crate::domain::connected_devices::PeerEntryKind::Symlink => {}
                }
            }
        }
        Ok(total)
    }

    async fn change(&self, device_id: &str, request: PeerRequest) -> ApiResult<PeerEntry> {
        match self.request(device_id, request).await? {
            PeerResponse::Stat { entry } => Ok(entry),
            _ => Err(unexpected_response()),
        }
    }
}

/// The bytes in a local file or folder, for upload progress. Links are skipped,
/// as the upload skips them.
pub async fn local_tree_size(path: &Path) -> u64 {
    let mut total = 0;
    let mut pending = vec![path.to_path_buf()];
    while let Some(path) = pending.pop() {
        let Ok(metadata) = tokio::fs::symlink_metadata(&path).await else {
            continue;
        };
        if metadata.is_file() {
            total += metadata.len();
        } else if metadata.is_dir() {
            if let Ok(mut children) = tokio::fs::read_dir(&path).await {
                while let Ok(Some(child)) = children.next_entry().await {
                    pending.push(child.path());
                }
            }
        }
    }
    total
}

fn is_canceled(error: &ApiError) -> bool {
    error
        .to_string()
        .eq_ignore_ascii_case("Operation canceled.")
}

fn unexpected_response() -> ApiError {
    ApiError::Message("Peer returned an unexpected response.".to_owned())
}
