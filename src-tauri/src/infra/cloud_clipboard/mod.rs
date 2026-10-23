//! The shared clipboard (docs/design/clipboard/BRIEF.md): what a person copies
//! reaches their account's other added devices through sync, as a small ring
//! of sealed clips. Each clip is compressed and sealed on the device with a key
//! derived from the vault root; the server only ever holds ciphertext.
#![cfg(desktop)]

mod clip;
mod ring;

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::domain::clipboard::{
    ClipboardImage, ClipboardPayload, ClipboardPayloadKind, SharedClipboardClient,
};
use crate::infra::devices::trust;
use clip::Clip;

/// Clips older than this are never shown or pasted.
const CLIP_LIFETIME_MS: i64 = 24 * 60 * 60 * 1000;
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
    /// Sync is unreachable right now.
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudClipboardView {
    pub status: CloudStatus,
    pub clips: Vec<ClipSummary>,
    /// Plain words about the last copy that could not be shared, if any.
    pub notice: Option<String>,
}

pub(super) type ClipHandler = Arc<dyn Fn(ClipboardPayload) + Send + Sync>;

#[derive(Clone, Default)]
pub struct CloudClipboard {
    inner: Arc<Inner>,
}

#[derive(Default)]
struct Inner {
    generation: AtomicU64,
    changes: Changes,
    session: RwLock<Option<Arc<ring::Session>>>,
    status: Mutex<CloudStatus>,
    notice: Mutex<Option<String>>,
    /// Open clips by ring slot, newest first.
    history: Mutex<Vec<(u8, Clip)>>,
    handler: RwLock<Option<ClipHandler>>,
    app: RwLock<Option<AppHandle>>,
}

struct Changes(tokio::sync::broadcast::Sender<()>);

impl Default for Changes {
    fn default() -> Self {
        Self(tokio::sync::broadcast::channel(16).0)
    }
}

pub struct CloudStart {
    pub app: AppHandle,
    pub account_id: String,
    /// This device's id on the server, recorded with each clip it shares.
    pub server_device_id: String,
    pub device_name: String,
}

impl CloudClipboard {
    /// Called with every clip that arrives from another device.
    pub fn set_handler(&self, handler: ClipHandler) {
        if let Ok(mut slot) = self.inner.handler.write() {
            *slot = Some(handler);
        }
    }

    /// Starts (or restarts) for this device. It keeps running until `stop`
    /// and follows the device's policy and vault state.
    pub fn start(&self, start: CloudStart) {
        let generation = self.inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut app) = self.inner.app.write() {
            *app = Some(start.app.clone());
        }
        let inner = self.inner.clone();
        tauri::async_runtime::spawn(async move { ring::run(inner, generation, start).await });
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
        self.inner.changes.0.subscribe()
    }

    pub fn view(&self) -> CloudClipboardView {
        let now = chrono::Utc::now().timestamp_millis();
        let session = self.inner.session();
        CloudClipboardView {
            status: *self.inner.status.lock().expect("cloud clipboard status"),
            clips: self
                .inner
                .history
                .lock()
                .map(|history| {
                    history
                        .iter()
                        .filter(|(_, clip)| fresh(clip, now))
                        .map(|(_, clip)| summary(clip, session.as_deref()))
                        .collect()
                })
                .unwrap_or_default(),
            notice: self
                .inner
                .notice
                .lock()
                .ok()
                .and_then(|notice| notice.clone()),
        }
    }

    /// A clip as a payload this device can paste.
    pub async fn open_clip(&self, clip_id: &str) -> Result<ClipboardPayload, String> {
        let clip = self.inner.find(clip_id)?;
        Ok(payload(&clip))
    }

    /// Writes a clip's image into `directory` and returns where it landed.
    /// Names never overwrite: an existing name gets a numbered copy.
    pub async fn save_clip_files(
        &self,
        clip_id: &str,
        directory: &Path,
    ) -> Result<Vec<PathBuf>, String> {
        let clip = self.inner.find(clip_id)?;
        let Some(image) = clip.header.image.as_ref() else {
            return Err("This clip has no files.".into());
        };
        std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        let extension = if image.mime_type == "image/jpeg" {
            "jpg"
        } else {
            "png"
        };
        let target = unique_path(directory, &format!("Clipboard image.{extension}"));
        std::fs::write(&target, &clip.image).map_err(|error| error.to_string())?;
        Ok(vec![target])
    }
}

impl SharedClipboardClient for CloudClipboard {
    fn publish(&self, payload: &ClipboardPayload) -> bool {
        let Some(session) = self.inner.session() else {
            return false;
        };
        if !trust::effective_policy().clipboard {
            return false;
        }
        let inner = self.inner.clone();
        let payload = payload.clone();
        tauri::async_runtime::spawn(async move { ring::publish(&inner, &session, payload).await });
        true
    }

    fn hydrate_payload(&self, _payload: &mut ClipboardPayload) -> bool {
        // Clips are opened before they reach the clipboard service.
        true
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

    fn set_notice(&self, notice: Option<&str>) {
        if let Ok(mut current) = self.notice.lock() {
            let notice = notice.map(str::to_owned);
            if *current != notice {
                *current = notice;
                drop(current);
                self.notify();
            }
        }
    }

    fn notify(&self) {
        let _ = self.changes.0.send(());
        if let Some(app) = self.app.read().ok().and_then(|app| app.clone()) {
            let _ = app.emit(HISTORY_EVENT, ());
        }
    }

    fn session(&self) -> Option<Arc<ring::Session>> {
        self.session.read().ok().and_then(|session| session.clone())
    }

    fn current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == generation
    }

    fn find(&self, clip_id: &str) -> Result<Clip, String> {
        let now = chrono::Utc::now().timestamp_millis();
        self.history
            .lock()
            .map_err(|_| "The clipboard is busy.".to_owned())?
            .iter()
            .map(|(_, clip)| clip)
            .find(|clip| clip.header.clip_id == clip_id && fresh(clip, now))
            .cloned()
            .ok_or_else(|| "That clip expired.".to_owned())
    }

    fn handler(&self) -> Option<ClipHandler> {
        self.handler.read().ok().and_then(|handler| handler.clone())
    }
}

fn fresh(clip: &Clip, now: i64) -> bool {
    now - clip.header.created_unix_ms < CLIP_LIFETIME_MS
}

fn summary(clip: &Clip, session: Option<&ring::Session>) -> ClipSummary {
    let header = &clip.header;
    let preview = match header.kind {
        ClipboardPayloadKind::Text | ClipboardPayloadKind::Html => {
            header.text.chars().take(200).collect()
        }
        ClipboardPayloadKind::Image => "Image".into(),
        _ => String::new(),
    };
    ClipSummary {
        clip_id: header.clip_id.clone(),
        device_id: header.device_id.clone(),
        device_name: header.device_name.clone(),
        from_this_device: session.is_some_and(|session| session.device_id == header.device_id),
        kind: header.kind,
        preview,
        file_names: header.file_names.clone(),
        size: (header.text.len() + header.html.len() + clip.image.len()) as u64,
        created_at: header.created_unix_ms,
    }
}

fn payload(clip: &Clip) -> ClipboardPayload {
    let header = &clip.header;
    ClipboardPayload {
        kind: header.kind,
        payload_id: header.clip_id.clone(),
        source_device_id: header.device_id.clone(),
        source_device_name: header.device_name.clone(),
        revision: header.revision,
        created_unix_ms: header.created_unix_ms,
        text: header.text.clone(),
        html: header.html.clone(),
        images: header
            .image
            .iter()
            .map(|image| ClipboardImage {
                mime_type: image.mime_type.clone(),
                blob_id: header.clip_id.clone(),
                checksum: String::new(),
                size_bytes: clip.image.len() as u64,
                width: image.width,
                height: image.height,
                bytes: clip.image.clone(),
            })
            .collect(),
        ..ClipboardPayload::default()
    }
}

fn unique_path(directory: &Path, name: &str) -> PathBuf {
    let candidate = directory.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_owned());
    let extension = path
        .extension()
        .map(|extension| format!(".{}", extension.to_string_lossy()))
        .unwrap_or_default();
    (2..)
        .map(|index| directory.join(format!("{stem} {index}{extension}")))
        .find(|candidate| !candidate.exists())
        .expect("an unused name")
}
