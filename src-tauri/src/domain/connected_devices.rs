use std::collections::HashMap;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};

pub const DEVICE_ALPN: &[u8] = b"misty-device/1";
pub const DEVICE_PROTOCOL_VERSION: &str = "misty-device/1";
// Clipboard images are deliberately capped at 10 MiB. Keep enough CBOR
// envelope headroom while retaining a hard allocation bound for every frame.
pub const MAX_CONTROL_FRAME_BYTES: usize = 12 * 1024 * 1024;
pub const MAX_TEXT_OR_HTML_BYTES: usize = 1024 * 1024;
pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_FILE_REFERENCES: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeerRequestEnvelope {
    pub request_id: String,
    pub request: PeerRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum PeerRequest {
    Hello {
        ticket: String,
    },
    /// An explicit connect: authorized by a server ticket, it also starts a
    /// local session. `session` is the token the receiver will present back.
    /// `address` is where the receiver can reach the sender in return.
    Connect {
        ticket: String,
        session: SessionOffer,
        #[serde(default)]
        address: Option<serde_json::Value>,
    },
    /// A reconnect within a local session, checked on the receiving device.
    Resume {
        device_id: String,
        token: String,
        #[serde(default)]
        address: Option<serde_json::Value>,
    },
    /// The sender ended its session with the receiver, or unpaired.
    EndSession,
    GetRoots,
    ListDirectory {
        path: String,
        show_hidden: bool,
    },
    Stat {
        path: String,
    },
    ReadLink {
        path: String,
        expected_snapshot: Option<String>,
    },
    ReadFile {
        path: String,
        offset: u64,
        length: Option<u64>,
        expected_snapshot: Option<String>,
    },
    SubscribeDirectory {
        path: String,
    },
    ClipboardOffer {
        payload: ClipboardOffer,
    },
    ClipboardFetchBlob {
        blob_id: String,
        offset: u64,
        length: Option<u64>,
    },
    OpenWorkspaceRoute {
        request: OpenWorkspaceRouteRequest,
    },
    Ping {
        nonce: u64,
    },
    // Changes need the "files:write" permission and the owner's own consent.
    // Each answers with the resulting entry, or `Deleted`.
    CreateItem {
        directory: String,
        name: String,
        folder: bool,
    },
    RenameItem {
        path: String,
        new_name: String,
    },
    /// Copy or move within the same device.
    TransferItem {
        path: String,
        destination_directory: String,
        name: String,
        keep_source: bool,
    },
    DeleteItem {
        path: String,
        permanent: bool,
    },
    /// Followed on the same stream by exactly `size` bytes of file content.
    WriteFile {
        directory: String,
        name: String,
        size: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeerResponseEnvelope {
    pub request_id: String,
    pub response: Result<PeerResponse, PeerError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum PeerResponse {
    Authorized {
        expires_at: i64,
    },
    /// Answers `Connect` and `Resume`. `session` is set for `Connect`: the token
    /// the sender presents on later reconnects. `writable` says whether the
    /// receiver currently lets the sender change its files.
    Connected {
        expires_at: i64,
        session: Option<SessionOffer>,
        writable: bool,
    },
    SessionEnded,
    Roots {
        roots: Vec<PeerRoot>,
    },
    Directory {
        path: String,
        entries: Vec<PeerEntry>,
        snapshot: String,
        /// Whether the device lets the requester change files here.
        #[serde(default)]
        writable: bool,
    },
    Stat {
        entry: PeerEntry,
    },
    Symlink {
        target: Vec<u8>,
        snapshot: String,
    },
    FileRange {
        snapshot: String,
        offset: u64,
        length: u64,
    },
    Subscribed {
        subscription_id: String,
    },
    DirectoryInvalidated {
        subscription_id: String,
        path: String,
    },
    ClipboardAccepted {
        revision: u64,
    },
    ClipboardBlob {
        blob_id: String,
        offset: u64,
        length: u64,
    },
    WorkspaceRoute {
        result: OpenWorkspaceRouteResult,
    },
    Pong {
        nonce: u64,
    },
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionOffer {
    pub token: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenWorkspaceRouteRequest {
    pub request_id: String,
    pub route: String,
    pub surface: WorkspaceRouteSurface,
    pub sent_at: String,
    pub source_device_id: String,
    pub source_device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceRouteSurface {
    Code,
    Terminal,
    Transfers,
    Files,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenWorkspaceRouteResult {
    pub request_id: String,
    pub status: OpenWorkspaceRouteStatus,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpenWorkspaceRouteStatus {
    Opened,
    Rejected,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeerRoot {
    pub id: String,
    pub name: String,
    pub kind: PeerRootKind,
    pub readonly: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PeerRootKind {
    System,
    Volume,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeerEntry {
    pub name: String,
    pub path: String,
    pub kind: PeerEntryKind,
    pub size_bytes: Option<u64>,
    pub modified_ms: Option<i64>,
    pub snapshot: String,
    pub readonly: bool,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PeerEntryKind {
    File,
    Directory,
    Symlink,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardOffer {
    pub source_endpoint_id: String,
    pub revision: u64,
    pub kind: ClipboardOfferKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ClipboardOfferKind {
    Text {
        text: String,
        html: Option<String>,
    },
    Image {
        blob_id: String,
        png_bytes: Vec<u8>,
    },
    FileReferences {
        files: Vec<PeerFileReference>,
        fallback_text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeerFileReference {
    pub device_id: String,
    pub root_id: String,
    pub relative_path: String,
    pub is_directory: bool,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PeerErrorCode {
    AuthorizationExpired,
    Revoked,
    OfflinePeer,
    ForbiddenPath,
    SourceChanged,
    MalformedRequest,
    UnsupportedVersion,
    RateLimited,
    NotFound,
    UnsupportedOperation,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeerError {
    pub code: PeerErrorCode,
    pub message: String,
    pub retry_after_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeerTicketClaims {
    pub iss: String,
    pub aud: String,
    pub jti: String,
    pub pair_id: String,
    pub source_device_id: String,
    pub source_endpoint_id: String,
    pub target_device_id: String,
    pub target_endpoint_id: String,
    pub protocol_version: String,
    pub permissions: Vec<String>,
    pub iat: i64,
    pub exp: i64,
}

pub const SPACE_DEVICE_PROTOCOL_VERSION: &str = "misty-device/2";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpacePeerTicketClaims {
    #[serde(flatten)]
    pub peer: PeerTicketClaims,
    pub space_id: String,
    pub app_id: String,
    pub installed_version: String,
    pub authority_generation: i64,
}

/// Obtained from the active installation and paired devices, never from a ticket.
pub struct SpacePeerAuthority<'a> {
    pub space_id: &'a str,
    pub installed_version: &'a str,
    pub authority_generation: i64,
    pub source_device_id: &'a str,
    pub target_device_id: &'a str,
    pub source_endpoint_id: &'a str,
    pub target_endpoint_id: &'a str,
}

#[derive(Debug, Deserialize)]
struct TicketHeader {
    alg: String,
    kid: String,
}

pub fn encode_control_frame<T: Serialize>(value: &T) -> ApiResult<Vec<u8>> {
    let mut payload = Vec::new();
    ciborium::ser::into_writer(value, &mut payload)
        .map_err(|error| ApiError::Message(format!("Could not encode peer message: {error}")))?;
    if payload.len() > MAX_CONTROL_FRAME_BYTES {
        return Err(ApiError::Message(
            "Peer control message is too large.".to_owned(),
        ));
    }
    let mut framed = Vec::with_capacity(payload.len() + 4);
    framed.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    framed.extend_from_slice(&payload);
    Ok(framed)
}

pub fn decode_control_frame<T: DeserializeOwned>(framed: &[u8]) -> ApiResult<T> {
    let length_bytes: [u8; 4] = framed
        .get(..4)
        .ok_or_else(|| ApiError::Message("Peer control message is truncated.".to_owned()))?
        .try_into()
        .map_err(|_| ApiError::Message("Peer control message is malformed.".to_owned()))?;
    let length = u32::from_be_bytes(length_bytes) as usize;
    if length > MAX_CONTROL_FRAME_BYTES || framed.len() != length + 4 {
        return Err(ApiError::Message(
            "Peer control message has an invalid length.".to_owned(),
        ));
    }
    ciborium::de::from_reader(&framed[4..])
        .map_err(|error| ApiError::Message(format!("Could not decode peer message: {error}")))
}

pub fn validate_clipboard_offer(offer: &ClipboardOffer) -> Result<(), PeerError> {
    let invalid = match &offer.kind {
        ClipboardOfferKind::Text { text, html } => {
            text.len() + html.as_ref().map_or(0, String::len) > MAX_TEXT_OR_HTML_BYTES
        }
        ClipboardOfferKind::Image { png_bytes, .. } => {
            png_bytes.len() > MAX_IMAGE_BYTES || !png_bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        }
        ClipboardOfferKind::FileReferences {
            files,
            fallback_text,
        } => {
            files.len() > MAX_FILE_REFERENCES
                || fallback_text.len() > MAX_TEXT_OR_HTML_BYTES
                || files.iter().any(|file| {
                    file.relative_path.is_empty()
                        || file.relative_path.starts_with('/')
                        || file.relative_path.starts_with('\\')
                        || file
                            .relative_path
                            .split(['/', '\\'])
                            .any(|part| part == "..")
                })
        }
    };
    if invalid {
        Err(PeerError {
            code: PeerErrorCode::MalformedRequest,
            message: "Clipboard offer exceeds Misty's safety limits.".to_owned(),
            retry_after_ms: None,
        })
    } else {
        Ok(())
    }
}

pub fn verify_peer_ticket(
    ticket: &str,
    keys: &std::collections::HashMap<String, VerifyingKey>,
    expected_source_endpoint: &str,
    expected_target_endpoint: &str,
    now_unix: i64,
    used_ticket_ids: &mut HashMap<String, i64>,
) -> ApiResult<PeerTicketClaims> {
    let claims: PeerTicketClaims = verify_signed_peer_ticket(ticket, keys)?;
    if claims.iss != "misty-api"
        || claims.aud != DEVICE_PROTOCOL_VERSION
        || claims.protocol_version != DEVICE_PROTOCOL_VERSION
        || claims.source_endpoint_id != expected_source_endpoint
        || claims.target_endpoint_id != expected_target_endpoint
        || claims.iat > now_unix.saturating_add(30)
        || claims.exp <= now_unix
        || claims
            .exp
            .checked_sub(claims.iat)
            .is_none_or(|lifetime| !(1..=300).contains(&lifetime))
        || claims.jti.is_empty()
    {
        return Err(ApiError::Message(
            "Peer ticket is expired or does not authorize this connection.".to_owned(),
        ));
    }
    used_ticket_ids.retain(|_, expires| *expires > now_unix);
    if used_ticket_ids.contains_key(&claims.jti) {
        return Err(ApiError::Message(
            "Peer ticket has already been used.".to_owned(),
        ));
    }
    used_ticket_ids.insert(claims.jti.clone(), claims.exp);
    Ok(claims)
}

fn verify_signed_peer_ticket<T: DeserializeOwned>(
    ticket: &str,
    keys: &HashMap<String, VerifyingKey>,
) -> ApiResult<T> {
    if ticket.len() > 16384 {
        return Err(ApiError::Message("Peer ticket exceeds its limit.".into()));
    }
    let parts: Vec<&str> = ticket.split('.').collect();
    if parts.len() != 3 {
        return Err(ApiError::Message("Peer ticket is malformed.".to_owned()));
    }
    let header: TicketHeader = decode_jwt_part(parts[0])?;
    if header.alg != "EdDSA" {
        return Err(ApiError::Message(
            "Peer ticket uses an unsupported signature.".to_owned(),
        ));
    }
    let key = keys
        .get(&header.kid)
        .ok_or_else(|| ApiError::Message("Peer ticket was signed by an unknown key.".to_owned()))?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(parts[2])
        .map_err(|_| ApiError::Message("Peer ticket signature is malformed.".to_owned()))?;
    if URL_SAFE_NO_PAD.encode(&signature_bytes) != parts[2] {
        return Err(ApiError::Message(
            "Peer ticket signature is malformed.".to_owned(),
        ));
    }
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| ApiError::Message("Peer ticket signature is malformed.".to_owned()))?;
    key.verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
        .map_err(|_| ApiError::Message("Peer ticket signature is invalid.".to_owned()))?;
    decode_jwt_part(parts[1])
}

pub fn verify_space_peer_ticket(
    ticket: &str,
    keys: &HashMap<String, VerifyingKey>,
    expected: &SpacePeerAuthority<'_>,
    now_unix: i64,
    used_ticket_ids: &mut HashMap<String, i64>,
) -> ApiResult<SpacePeerTicketClaims> {
    let claims: SpacePeerTicketClaims = verify_signed_peer_ticket(ticket, keys)?;
    let peer = &claims.peer;
    if expected.space_id.is_empty()
        || expected.installed_version.is_empty()
        || expected.authority_generation < 1
        || claims.space_id != expected.space_id
        || claims.app_id != "files"
        || claims.installed_version != expected.installed_version
        || claims.authority_generation != expected.authority_generation
        || peer.iss != "misty-api"
        || peer.aud != SPACE_DEVICE_PROTOCOL_VERSION
        || peer.protocol_version != SPACE_DEVICE_PROTOCOL_VERSION
        || peer.source_device_id != expected.source_device_id
        || peer.target_device_id != expected.target_device_id
        || peer.source_endpoint_id != expected.source_endpoint_id
        || peer.target_endpoint_id != expected.target_endpoint_id
        || peer.source_device_id.is_empty()
        || peer.target_device_id.is_empty()
        || peer.source_device_id == peer.target_device_id
        || peer.source_endpoint_id.is_empty()
        || peer.target_endpoint_id.is_empty()
        || peer.pair_id.is_empty()
        || peer.jti.is_empty()
        || peer.iat > now_unix.saturating_add(30)
        || peer.exp <= now_unix
        || peer
            .exp
            .checked_sub(peer.iat)
            .is_none_or(|lifetime| !(1..=300).contains(&lifetime))
        || !peer
            .permissions
            .iter()
            .any(|permission| permission == "files:read")
        || peer.permissions.iter().any(|permission| {
            !matches!(
                permission.as_str(),
                "roots:read" | "files:read" | "directories:subscribe"
            )
        })
    {
        return Err(ApiError::Message(
            "Peer ticket does not authorize this Space installation and device pair.".into(),
        ));
    }
    used_ticket_ids.retain(|_, expires| *expires > now_unix);
    if used_ticket_ids.contains_key(&peer.jti) {
        return Err(ApiError::Message(
            "Peer ticket has already been used.".into(),
        ));
    }
    used_ticket_ids.insert(peer.jti.clone(), peer.exp);
    Ok(claims)
}

fn decode_jwt_part<T: DeserializeOwned>(value: &str) -> ApiResult<T> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| ApiError::Message("Peer ticket is malformed.".to_owned()))?;
    serde_json::from_slice(&bytes).map_err(ApiError::from)
}

#[cfg(test)]
#[path = "connected_devices_tests.rs"]
mod tests;
