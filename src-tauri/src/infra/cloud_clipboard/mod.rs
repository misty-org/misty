//! The cloud clipboard (docs/design/clipboard/BRIEF.md): clips travel between
//! this account's admitted devices through a Cloudflare Worker, sealed with a
//! key derived from the vault root. The Worker, R2 and Misty's server only ever
//! see ciphertext. The Misty API's only part is a short ticket for this device.
#![cfg(desktop)]

mod connection;
mod files;
mod transfer;
mod wire;

use connection::*;
use files::*;
use transfer::*;
use wire::*;

use std::{
    io::Write as _,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::{SinkExt, StreamExt};
use misty_browser_sync::{
    crypto::ClipboardKey,
    transport::{open_device_socket, SocketMessage},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::domain::clipboard::{
    ClipboardFileRef, ClipboardImage, ClipboardPayload, ClipboardPayloadKind, SharedClipboardClient,
};
use crate::infra::{device_http::DeviceHttp, device_identity::DeviceIdentity, device_trust};

/// The Worker's limit for one clip, and so the most this device uploads at once.
const MAX_CLIP_BYTES: u64 = 25 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 1024 * 1024;
const MAX_HISTORY: usize = 20;
const MAX_SOCKET_FRAME: usize = 8 * 1024 * 1024;
const KEEPALIVE: Duration = Duration::from_secs(30);
/// Received files stay in the clipboard cache this long, like the clips themselves.
const RECEIVED_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);
pub const HISTORY_EVENT: &str = "misty://clipboard-history";

/// One clip in the popover and in Kura's sidebar. Contains only what this
/// device could already paste.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSummary {
    pub clip_id: String,
    pub device_id: String,
    pub device_name: String,
    pub from_this_device: bool,
    pub kind: ClipboardPayloadKind,
    pub preview: String,
    pub file_names: Vec<String>,
    pub size: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloudStatus {
    /// Clipboard is off in this device's policy, or the device is not added.
    #[default]
    Off,
    /// The vault is locked here, so there is no key to seal clips with.
    Locked,
    Connecting,
    Ready,
    /// The Worker or the ticket route is unreachable; the LAN path still works.
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudClipboardView {
    pub status: CloudStatus,
    pub clips: Vec<ClipSummary>,
}

pub(super) type ClipHandler = Arc<dyn Fn(ClipboardPayload) + Send + Sync>;
/// A file read for upload: its name, whether it is a zipped folder, its bytes.
pub(super) type ReadFile = (String, bool, Vec<u8>);

#[derive(Clone, Default)]
pub struct CloudClipboard {
    inner: Arc<Inner>,
}

struct Inner {
    generation: AtomicU64,
    changes: tokio::sync::broadcast::Sender<()>,
    session: RwLock<Option<Arc<Session>>>,
    status: Mutex<CloudStatus>,
    history: Mutex<Vec<(ClipSummary, Manifest)>>,
    handler: RwLock<Option<ClipHandler>>,
    app: RwLock<Option<AppHandle>>,
    cache_dir: RwLock<PathBuf>,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            generation: AtomicU64::new(0),
            changes: tokio::sync::broadcast::channel(16).0,
            session: RwLock::default(),
            status: Mutex::default(),
            history: Mutex::default(),
            handler: RwLock::default(),
            app: RwLock::default(),
            cache_dir: RwLock::default(),
        }
    }
}

pub struct CloudStart {
    pub app: AppHandle,
    pub api_base: String,
    pub account_id: String,
    pub local_device_id: String,
    pub server_device_id: String,
    pub device_name: String,
    pub cache_dir: PathBuf,
}

impl CloudClipboard {
    /// Called with every clip that arrives from another device.
    pub fn set_handler(&self, handler: ClipHandler) {
        if let Ok(mut slot) = self.inner.handler.write() {
            *slot = Some(handler);
        }
    }

    /// Starts (or restarts) the connection for this device. It keeps running
    /// until `stop` and follows the device's policy and vault state.
    pub fn start(&self, start: CloudStart) {
        let generation = self.inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut app) = self.inner.app.write() {
            *app = Some(start.app.clone());
        }
        if let Ok(mut dir) = self.inner.cache_dir.write() {
            *dir = start.cache_dir.join("cloud-clipboard");
        }
        let inner = self.inner.clone();
        tauri::async_runtime::spawn(async move { run(inner, generation, start).await });
    }

    pub fn stop(&self) {
        self.inner.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut session) = self.inner.session.write() {
            *session = None;
        }
        if let Ok(mut history) = self.inner.history.lock() {
            history.clear();
        }
        self.inner.set_status(CloudStatus::Off);
    }

    /// Fires whenever the clip list or the status changes.
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<()> {
        self.inner.changes.subscribe()
    }

    pub fn view(&self) -> CloudClipboardView {
        CloudClipboardView {
            status: *self.inner.status.lock().expect("cloud clipboard status"),
            clips: self
                .inner
                .history
                .lock()
                .map(|history| history.iter().map(|(summary, _)| summary.clone()).collect())
                .unwrap_or_default(),
        }
    }

    /// Opens a clip into a payload this device can paste, downloading and
    /// decrypting its parts. Files land in the clipboard cache.
    pub async fn open_clip(&self, clip_id: &str) -> Result<ClipboardPayload, String> {
        let (summary, manifest) = self.inner.find(clip_id)?;
        let session = self
            .inner
            .session()
            .ok_or("The shared clipboard isn't connected.")?;
        hydrate(&self.inner, &session, &summary, &manifest).await
    }

    /// Writes a clip's files into `directory` and returns their paths. Names
    /// never overwrite: an existing name gets a numbered copy.
    pub async fn save_clip_files(
        &self,
        clip_id: &str,
        directory: &Path,
    ) -> Result<Vec<PathBuf>, String> {
        let payload = self.open_clip(clip_id).await?;
        if payload.file_refs.is_empty() && payload.images.is_empty() {
            return Err("This clip has no files.".into());
        }
        std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        let mut saved = Vec::new();
        for file in &payload.file_refs {
            let target = unique_path(directory, &file.display_name);
            std::fs::copy(&file.local_path, &target).map_err(|error| error.to_string())?;
            saved.push(target);
        }
        for (index, image) in payload.images.iter().enumerate() {
            let target = unique_path(directory, &format!("Clipboard image {}.png", index + 1));
            std::fs::write(&target, &image.bytes).map_err(|error| error.to_string())?;
            saved.push(target);
        }
        Ok(saved)
    }

    /// Seals and uploads a payload copied on this device. Returns false when
    /// the cloud clipboard isn't running, so the caller can rely on the LAN.
    fn publish_async(&self, payload: ClipboardPayload) -> bool {
        let Some(session) = self.inner.session() else {
            return false;
        };
        if !device_trust::effective_policy().clipboard {
            return false;
        }
        let inner = self.inner.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = publish(&inner, &session, payload).await {
                eprintln!("cloud clipboard: {error}");
            }
        });
        true
    }
}

impl SharedClipboardClient for CloudClipboard {
    fn publish(&self, payload: &ClipboardPayload) -> bool {
        self.publish_async(payload.clone())
    }

    fn hydrate_payload(&self, _payload: &mut ClipboardPayload) -> bool {
        // Clips are opened before they reach the clipboard service.
        true
    }
}

/// Offers a copy to every path that may carry it: paired devices on the LAN
/// (text and images; files left Misty's LAN sharing) and the cloud clipboard.
pub struct SharedClipboardFanout {
    pub lan: Arc<dyn SharedClipboardClient>,
    pub cloud: CloudClipboard,
}

impl SharedClipboardClient for SharedClipboardFanout {
    fn publish(&self, payload: &ClipboardPayload) -> bool {
        let lan = payload.kind != ClipboardPayloadKind::FileRefs && self.lan.publish(payload);
        let cloud = self.cloud.publish(payload);
        lan || cloud
    }

    fn hydrate_payload(&self, payload: &mut ClipboardPayload) -> bool {
        self.lan.hydrate_payload(payload)
    }
}

impl Inner {
    fn set_status(&self, status: CloudStatus) {
        let changed = self
            .status
            .lock()
            .map(|mut current| std::mem::replace(&mut *current, status) != status)
            .unwrap_or(false);
        if changed {
            self.notify();
        }
    }

    fn notify(&self) {
        let _ = self.changes.send(());
        if let Some(app) = self.app.read().ok().and_then(|app| app.clone()) {
            let _ = app.emit(HISTORY_EVENT, ());
        }
    }

    fn session(&self) -> Option<Arc<Session>> {
        self.session.read().ok().and_then(|session| session.clone())
    }

    fn current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == generation
    }

    fn find(&self, clip_id: &str) -> Result<(ClipSummary, Manifest), String> {
        self.history
            .lock()
            .map_err(|_| "The clipboard is busy.".to_owned())?
            .iter()
            .find(|(summary, _)| summary.clip_id == clip_id)
            .map(|(summary, manifest)| (summary.clone(), manifest.clone()))
            .ok_or_else(|| "That clip expired.".to_owned())
    }

    fn remember(&self, summary: ClipSummary, manifest: Manifest) {
        if let Ok(mut history) = self.history.lock() {
            history.retain(|(existing, _)| existing.clip_id != summary.clip_id);
            history.push((summary, manifest));
            history.sort_by(|left, right| right.0.created_at.cmp(&left.0.created_at));
            history.truncate(MAX_HISTORY);
        }
        self.notify();
    }

    fn cache_dir(&self) -> PathBuf {
        self.cache_dir
            .read()
            .map(|dir| dir.clone())
            .unwrap_or_else(|_| std::env::temp_dir().join("misty-cloud-clipboard"))
    }
}
