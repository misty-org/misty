use std::sync::{Arc, Mutex};

use super::{ClipboardOrigin, ClipboardPayload, ClipboardPayloadKind};
use crate::domain::clock::now_epoch_ms;

pub type ClipboardChangeCallback = Arc<dyn Fn(ClipboardPayload) + Send + Sync + 'static>;

pub trait NativeClipboard: Send + Sync {
    fn supported(&self) -> bool;
    fn start(&self, on_changed: Arc<dyn Fn() + Send + Sync + 'static>) -> bool;
    fn read_payload(&self) -> Option<ClipboardPayload>;
    fn write_payload(&self, payload: &ClipboardPayload) -> bool;
}

pub trait SharedClipboardClient: Send + Sync {
    fn publish(&self, payload: &ClipboardPayload) -> bool;
    fn hydrate_payload(&self, payload: &mut ClipboardPayload) -> bool;
}

#[derive(Default)]
struct ClipboardState {
    local: ClipboardPayload,
    last_seen_fingerprint: Vec<u8>,
    device_id: String,
    device_name: String,
    next_revision: u64,
    on_change: Option<ClipboardChangeCallback>,
}

pub struct ClipboardService {
    native: Option<Arc<dyn NativeClipboard>>,
    shared_client: Option<Arc<dyn SharedClipboardClient>>,
    state: Mutex<ClipboardState>,
}

impl ClipboardService {
    pub fn new(
        native: Option<Arc<dyn NativeClipboard>>,
        shared_client: Option<Arc<dyn SharedClipboardClient>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            native,
            shared_client,
            state: Mutex::new(ClipboardState {
                next_revision: 1,
                ..ClipboardState::default()
            }),
        })
    }

    pub fn start(self: &Arc<Self>) -> bool {
        let Some(native) = &self.native else {
            return false;
        };
        if !native.supported() {
            return false;
        }
        let service = Arc::downgrade(self);
        native.start(Arc::new(move || {
            if let Some(service) = service.upgrade() {
                service.on_native_clipboard_changed();
            }
        }))
    }

    pub fn set_device_identity(&self, device_id: String, device_name: String) {
        let mut state = self.state.lock().expect("clipboard state lock");
        state.device_id = device_id;
        state.device_name = device_name;
    }

    pub fn publish_payload_to_shared(&self, payload: &ClipboardPayload) -> bool {
        !payload.empty()
            && self
                .shared_client
                .as_ref()
                .is_some_and(|client| client.publish(payload))
    }

    pub fn finalize_payload(
        &self,
        mut payload: ClipboardPayload,
        origin: ClipboardOrigin,
    ) -> ClipboardPayload {
        payload.origin = origin;
        payload.created_unix_ms = now_epoch_ms();
        let mut state = self.state.lock().expect("clipboard state lock");
        payload.source_device_id = state.device_id.clone();
        payload.source_device_name = state.device_name.clone();
        payload.revision = state.next_revision;
        state.next_revision = state.next_revision.saturating_add(1);
        payload.payload_id = format!(
            "{}:{}:{}",
            payload.source_device_id, payload.revision, payload.created_unix_ms
        );
        payload
    }

    pub fn fingerprint_for(payload: &ClipboardPayload) -> Vec<u8> {
        let kind = match payload.kind {
            ClipboardPayloadKind::Empty => 0,
            ClipboardPayloadKind::Text => 1,
            ClipboardPayloadKind::Html => 2,
            ClipboardPayloadKind::Image => 3,
            ClipboardPayloadKind::FileRefs => 4,
        };
        let mut out = format!("{kind}\n{}\n{}\n", payload.text, payload.html).into_bytes();
        for file_ref in &payload.file_refs {
            out.extend_from_slice(
                format!(
                    "{}\t{}\t{}\t{}\t{}\t{}\n",
                    file_ref.display_name,
                    file_ref.local_path,
                    file_ref.provider_type,
                    file_ref.remote_name,
                    file_ref.remote_path,
                    i32::from(file_ref.is_dir)
                )
                .as_bytes(),
            );
        }
        for image in &payload.images {
            out.extend_from_slice(
                format!(
                    "{}\t{}\t{}\t{}\t{}x{}\t{}\n",
                    image.mime_type,
                    image.blob_id,
                    image.checksum,
                    image.size_bytes,
                    image.width,
                    image.height,
                    image.bytes.len()
                )
                .as_bytes(),
            );
            out.extend_from_slice(&image.bytes);
            out.push(b'\n');
        }
        out
    }

    fn on_native_clipboard_changed(&self) {
        let _ = self.capture_system();
    }

    /// Takes whatever is on the system clipboard into the shared buffer if it hasn't been yet,
    /// and returns it. The clipboard watcher does this on every change; invoking the shared
    /// clipboard does it again so a copy the watcher missed is never left out.
    pub fn capture_system(&self) -> Option<ClipboardPayload> {
        let native = self.native.as_ref()?;
        let payload = native.read_payload().filter(|payload| !payload.empty())?;
        let fingerprint = Self::fingerprint_for(&payload);
        {
            let mut state = self.state.lock().expect("clipboard state lock");
            if fingerprint == state.last_seen_fingerprint {
                return None;
            }
            state.last_seen_fingerprint = fingerprint;
        }
        let payload = self.finalize_payload(payload, ClipboardOrigin::LocalSystem);
        self.set_local_payload(payload.clone());
        let _ = self.publish_payload_to_shared(&payload);
        Some(payload)
    }

    pub(crate) fn apply_payload_to_system(&self, mut payload: ClipboardPayload) -> bool {
        let Some(native) = &self.native else {
            return false;
        };
        if payload.empty() {
            return false;
        }
        if let Some(shared_client) = &self.shared_client {
            if !shared_client.hydrate_payload(&mut payload) {
                return false;
            }
        }
        self.state
            .lock()
            .expect("clipboard state lock")
            .last_seen_fingerprint = Self::fingerprint_for(&payload);
        native.write_payload(&payload)
    }

    fn set_local_payload(&self, payload: ClipboardPayload) {
        let callback = {
            let mut state = self.state.lock().expect("clipboard state lock");
            state.local = payload.clone();
            state.on_change.clone()
        };
        if let Some(callback) = callback {
            callback(payload);
        }
    }
}

#[cfg(test)]
mod tests;
