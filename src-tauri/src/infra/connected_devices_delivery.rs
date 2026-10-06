//! Agent file delivery between the account's devices over the LAN
//! (docs/design/devices/BRIEF.md). The sending device streams the file
//! directly; the receiving device accepts it only with the run grant it
//! signed for its own inbox, checks the hash, and keeps it in Misty's
//! downloads. Only a receipt (name, size, hash) goes back to the server.

use std::path::PathBuf;
use std::time::Duration;

use super::*;
use crate::domain::connected_devices::{SignedRecord, MAX_DELIVERED_FILE_BYTES};
use crate::infra::{device_channel, device_trust};

const CHUNK_BYTES: usize = 256 * 1024;
const CONNECT_WAIT: Duration = Duration::from_secs(20);

fn refused(message: &str) -> PeerError {
    PeerError {
        code: PeerErrorCode::Revoked,
        message: message.to_owned(),
        retry_after_ms: None,
    }
}

#[cfg(test)]
static TEST_INBOX: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

#[cfg(test)]
pub(super) fn set_test_inbox(path: PathBuf) {
    let _ = TEST_INBOX.set(path);
}

/// Where delivered files land: Misty's folder in the user's downloads.
fn inbox_directory() -> Option<PathBuf> {
    #[cfg(test)]
    if let Some(path) = TEST_INBOX.get() {
        return Some(path.clone());
    }
    dirs::download_dir().map(|downloads| downloads.join("Misty"))
}

async fn unique_destination(directory: &Path, name: &str) -> PathBuf {
    let path = directory.join(name);
    if tokio::fs::metadata(&path).await.is_err() {
        return path;
    }
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem.to_owned(), format!(".{extension}")),
        _ => (name.to_owned(), String::new()),
    };
    for index in 2..1000 {
        let candidate = directory.join(format!("{stem} ({index}){extension}"));
        if tokio::fs::metadata(&candidate).await.is_err() {
            return candidate;
        }
    }
    directory.join(format!("{stem} ({}){extension}", uuid::Uuid::new_v4()))
}

pub(super) async fn receive_delivery(
    source_device_id: &str,
    grant: &SignedRecord,
    inbox_scope_id: &str,
    name: &str,
    size: u64,
    sha256: &str,
    receive: &mut TransportRecvStream,
) -> Result<PeerResponse, PeerError> {
    let own_id =
        device_trust::server_device_id().ok_or_else(|| refused("This device isn't ready."))?;
    if inbox_scope_id != format!("inbox:{own_id}") {
        return Err(refused("That inbox belongs to another device."));
    }
    // Only a grant this device signed for its own inbox lets a file arrive.
    let verified = device_trust::verify_job_grant(grant, inbox_scope_id, "files.receive", "inbox")
        .map_err(|_| refused("This device didn't ask for that file."))?;
    if verified.requester_device_id != own_id || source_device_id == own_id {
        return Err(refused("This device didn't ask for that file."));
    }
    if size == 0
        || size > MAX_DELIVERED_FILE_BYTES
        || sha256.len() != 64
        || !sha256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(refused("That file can't be delivered."));
    }
    let directory = inbox_directory().ok_or_else(|| refused("Downloads aren't available here."))?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|_| refused("Downloads aren't available here."))?;
    let name = sanitize_peer_file_name(name);
    let staging = directory.join(format!(".misty-delivery-{}", uuid::Uuid::new_v4()));
    let received = async {
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging)
            .await
            .map_err(|_| refused("Couldn't save the file."))?;
        let mut hasher = Sha256::new();
        let mut remaining = size;
        let mut buffer = vec![0u8; CHUNK_BYTES];
        while remaining > 0 {
            let count = remaining.min(buffer.len() as u64) as usize;
            receive
                .read_exact(&mut buffer[..count])
                .await
                .map_err(|_| refused("The transfer stopped early."))?;
            hasher.update(&buffer[..count]);
            file.write_all(&buffer[..count])
                .await
                .map_err(|_| refused("Couldn't save the file."))?;
            remaining -= count as u64;
        }
        file.sync_all()
            .await
            .map_err(|_| refused("Couldn't save the file."))?;
        if hex::encode(hasher.finalize()) != sha256.to_ascii_lowercase() {
            return Err(refused("The file changed on the way."));
        }
        Ok(())
    }
    .await;
    if let Err(error) = received {
        let _ = tokio::fs::remove_file(&staging).await;
        return Err(error);
    }
    let destination = unique_destination(&directory, &name).await;
    if tokio::fs::rename(&staging, &destination).await.is_err() {
        let _ = tokio::fs::remove_file(&staging).await;
        return Err(refused("Couldn't save the file."));
    }
    Ok(PeerResponse::Delivered {
        name: destination
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or(name),
        size,
        sha256: sha256.to_ascii_lowercase(),
    })
}

/// A receipt for one delivered file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryReceipt {
    pub destination_device_id: String,
    pub file_name: String,
    pub size: u64,
    pub sha256: String,
}

impl ConnectedDevicesService {
    /// Waits for a live connection to an added device, asking the control
    /// channel to introduce the two devices if needed.
    async fn connection_to(&self, device_id: &str) -> ApiResult<TransportConnection> {
        if let Ok(connection) = self.authorized_connection(device_id) {
            return Ok(connection);
        }
        let cached = device_trust::known_addresses(device_id);
        let endpoint = device_trust::current_list().and_then(|list| {
            list.admitted_key(device_id)
                .and_then(crate::infra::device_records::endpoint_of)
        });
        if let (Some(endpoint), false) = (&endpoint, cached.is_empty()) {
            let _ = self.connect_device(device_id, endpoint, cached).await;
        }
        if !self.is_connected(device_id) {
            device_channel::request_connect(device_id);
        }
        let started = std::time::Instant::now();
        while started.elapsed() < CONNECT_WAIT {
            if let Ok(connection) = self.authorized_connection(device_id) {
                return Ok(connection);
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Err(ApiError::Unavailable("destination_unreachable".to_owned()))
    }

    /// Sends one local file to another of the account's devices over the LAN.
    pub async fn deliver_file(
        &self,
        destination_device_id: &str,
        path: &Path,
        grant: SignedRecord,
        inbox_scope_id: &str,
    ) -> ApiResult<DeliveryReceipt> {
        let metadata = tokio::fs::metadata(path).await?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_DELIVERED_FILE_BYTES {
            return Err(ApiError::Message("unsupported_content".to_owned()));
        }
        let size = metadata.len();
        let mut hasher = Sha256::new();
        let mut file = tokio::fs::File::open(path).await?;
        let mut buffer = vec![0u8; CHUNK_BYTES];
        loop {
            let count = file.read(&mut buffer).await?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        let sha256 = hex::encode(hasher.finalize());
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| "file".to_owned());
        let connection = self.connection_to(destination_device_id).await?;
        let (mut send, mut receive) = connection
            .open_bi()
            .await
            .map_err(|error| ApiError::Unavailable(error.to_string()))?;
        let request_id = uuid::Uuid::new_v4().to_string();
        let frame = encode_control_frame(&PeerRequestEnvelope {
            request_id: request_id.clone(),
            request: PeerRequest::DeliverFile {
                grant,
                inbox_scope_id: inbox_scope_id.to_owned(),
                name: name.clone(),
                size,
                sha256: sha256.clone(),
            },
        })?;
        // The header, then exactly `size` bytes, then the end of the stream.
        let sent = async {
            send.write_all(&frame)
                .await
                .map_err(|error| ApiError::Unavailable(error.to_string()))?;
            let mut file = tokio::fs::File::open(path).await?;
            let mut sent = 0u64;
            while sent < size {
                let count = file.read(&mut buffer).await?;
                if count == 0 {
                    return Err(ApiError::Message(
                        "The file changed while sending.".to_owned(),
                    ));
                }
                let count = count.min((size - sent) as usize);
                send.write_all(&buffer[..count])
                    .await
                    .map_err(|error| ApiError::Unavailable(error.to_string()))?;
                sent += count as u64;
            }
            finish_stream(&mut send)
                .await
                .map_err(ApiError::Unavailable)
        }
        .await;
        let answer = read_frame::<PeerResponseEnvelope>(&mut receive).await;
        // A refusal before every byte was read explains a failed send best.
        if let (Err(error), Err(_)) = (&sent, &answer) {
            return Err(ApiError::Unavailable(error.to_string()));
        }
        let response = answer?;
        if response.request_id != request_id {
            return Err(ApiError::Message(
                "Peer response request ID did not match.".to_owned(),
            ));
        }
        match response.response {
            Ok(PeerResponse::Delivered {
                name,
                size,
                sha256: received,
            }) if received == sha256 => Ok(DeliveryReceipt {
                destination_device_id: destination_device_id.to_owned(),
                file_name: name,
                size,
                sha256: received,
            }),
            Ok(_) => Err(ApiError::Message("destination_refused".to_owned())),
            Err(_) => Err(ApiError::Message("destination_refused".to_owned())),
        }
    }

    /// Keeps the cached LAN address current on macOS, where the transport runs
    /// in its own process. A local call; nothing reaches the server.
    pub(super) fn start_address_refresher(&self) {
        let generation = self.resume_generation.fetch_add(1, Ordering::SeqCst) + 1;
        #[cfg(target_os = "macos")]
        {
            let service = self.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    if service.resume_generation.load(Ordering::SeqCst) != generation {
                        break;
                    }
                    let endpoint = service
                        .state
                        .read()
                        .ok()
                        .and_then(|guard| guard.as_ref().map(|state| state.endpoint.clone()));
                    let Some(endpoint) = endpoint else {
                        break;
                    };
                    if endpoint.is_closed() {
                        break;
                    }
                    let _ = endpoint.snapshot().await;
                }
            });
        }
        #[cfg(not(target_os = "macos"))]
        let _ = generation;
    }
}
