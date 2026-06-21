use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use super::{ClipboardOrigin, ClipboardPayload, ClipboardPayloadKind};
use crate::core::file_transfer::now_epoch_ms;

pub type ClipboardChangeCallback = Arc<dyn Fn(ClipboardPayload) + Send + Sync + 'static>;

pub trait NativeClipboard: Send + Sync {
    fn supported(&self) -> bool;
    fn start(&self, on_changed: Arc<dyn Fn() + Send + Sync + 'static>) -> bool;
    fn stop(&self);
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
    shared: ClipboardPayload,
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
    apply_in_flight: AtomicBool,
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
            apply_in_flight: AtomicBool::new(false),
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

    pub fn stop(&self) {
        if let Some(native) = &self.native {
            native.stop();
        }
    }

    pub fn set_device_identity(&self, device_id: String, device_name: String) {
        let mut state = self.state.lock().expect("clipboard state lock");
        state.device_id = device_id;
        state.device_name = device_name;
    }

    pub fn set_on_change(&self, callback: Option<ClipboardChangeCallback>) {
        self.state.lock().expect("clipboard state lock").on_change = callback;
    }

    pub fn current_local(&self) -> ClipboardPayload {
        self.state
            .lock()
            .expect("clipboard state lock")
            .local
            .clone()
    }

    pub fn latest_shared(&self) -> ClipboardPayload {
        self.state
            .lock()
            .expect("clipboard state lock")
            .shared
            .clone()
    }

    pub fn publish_current_to_shared(&self) -> bool {
        self.publish_payload_to_shared(&self.current_local())
    }

    pub fn publish_payload_to_shared(&self, payload: &ClipboardPayload) -> bool {
        !payload.empty()
            && self
                .shared_client
                .as_ref()
                .is_some_and(|client| client.publish(payload))
    }

    pub fn apply_shared_to_system(&self) -> bool {
        self.apply_payload_to_system(self.latest_shared())
    }

    pub fn apply_shared_to_system_async(self: &Arc<Self>) -> bool {
        if self.apply_in_flight.swap(true, Ordering::AcqRel) {
            return false;
        }
        let payload = self.latest_shared();
        if payload.empty() {
            self.apply_in_flight.store(false, Ordering::Release);
            return false;
        }
        let service = Arc::clone(self);
        std::thread::spawn(move || {
            let _ = service.apply_payload_to_system(payload);
            service.apply_in_flight.store(false, Ordering::Release);
        });
        true
    }

    pub fn accept_remote_payload(&self, mut payload: ClipboardPayload) {
        payload.origin = ClipboardOrigin::RemoteShared;
        self.set_shared_payload(payload);
    }

    pub fn set_local_misty_payload(&self, payload: ClipboardPayload) -> ClipboardPayload {
        let payload = self.finalize_payload(payload, ClipboardOrigin::LocalMisty);
        self.set_local_payload(payload.clone());
        payload
    }

    pub fn publish_local_system_payload_to_shared(&self, payload: ClipboardPayload) -> bool {
        let payload = self.finalize_payload(payload, ClipboardOrigin::LocalSystem);
        self.set_local_payload(payload.clone());
        self.publish_payload_to_shared(&payload)
    }

    pub fn make_text_payload(&self, text: String, origin: ClipboardOrigin) -> ClipboardPayload {
        let payload = ClipboardPayload {
            kind: if text.is_empty() {
                ClipboardPayloadKind::Empty
            } else {
                ClipboardPayloadKind::Text
            },
            text,
            ..ClipboardPayload::default()
        };
        self.finalize_payload(payload, origin)
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
                    "{}\t{}\t{}\t{}\n",
                    file_ref.local_path,
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
        let Some(native) = &self.native else {
            return;
        };
        let Some(payload) = native.read_payload().filter(|payload| !payload.empty()) else {
            return;
        };
        let fingerprint = Self::fingerprint_for(&payload);
        {
            let mut state = self.state.lock().expect("clipboard state lock");
            if fingerprint == state.last_seen_fingerprint {
                return;
            }
            state.last_seen_fingerprint = fingerprint;
        }
        let payload = self.finalize_payload(payload, ClipboardOrigin::LocalSystem);
        self.set_local_payload(payload);
    }

    fn apply_payload_to_system(&self, mut payload: ClipboardPayload) -> bool {
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

    fn set_shared_payload(&self, payload: ClipboardPayload) {
        let callback = {
            let mut state = self.state.lock().expect("clipboard state lock");
            state.shared = payload.clone();
            state.on_change.clone()
        };
        if let Some(callback) = callback {
            callback(payload);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finalizes_payload_with_device_revision_and_identity() {
        let service = ClipboardService::new(None, None);
        service.set_device_identity("device-a".into(), "Laptop".into());
        let first = service.make_text_payload("hello".into(), ClipboardOrigin::LocalMisty);
        let second = service.make_text_payload("world".into(), ClipboardOrigin::LocalMisty);
        assert_eq!(first.source_device_id, "device-a");
        assert_eq!(first.revision, 1);
        assert_eq!(second.revision, 2);
        assert!(first.payload_id.starts_with("device-a:1:"));
    }

    #[test]
    fn fingerprint_changes_with_binary_image_content() {
        let mut first = ClipboardPayload {
            kind: ClipboardPayloadKind::Image,
            images: vec![super::super::ClipboardImage {
                bytes: vec![1, 2, 3],
                ..super::super::ClipboardImage::default()
            }],
            ..ClipboardPayload::default()
        };
        let first_fingerprint = ClipboardService::fingerprint_for(&first);
        first.images[0].bytes[2] = 4;
        assert_ne!(first_fingerprint, ClipboardService::fingerprint_for(&first));
    }

    #[test]
    fn publishes_local_system_image_payload_to_shared_client() {
        #[derive(Default)]
        struct CaptureSharedClient {
            published: Mutex<Option<ClipboardPayload>>,
        }

        impl SharedClipboardClient for CaptureSharedClient {
            fn publish(&self, payload: &ClipboardPayload) -> bool {
                *self.published.lock().expect("published lock") = Some(payload.clone());
                true
            }

            fn hydrate_payload(&self, _payload: &mut ClipboardPayload) -> bool {
                true
            }
        }

        let client = Arc::new(CaptureSharedClient::default());
        let shared: Arc<dyn SharedClipboardClient> = client.clone();
        let service = ClipboardService::new(None, Some(shared));
        service.set_device_identity("device-a".into(), "Laptop".into());
        let ok = service.publish_local_system_payload_to_shared(ClipboardPayload {
            kind: ClipboardPayloadKind::Image,
            images: vec![super::super::ClipboardImage {
                mime_type: "image/png".into(),
                size_bytes: 3,
                width: 12,
                height: 8,
                bytes: vec![1, 2, 3],
                ..super::super::ClipboardImage::default()
            }],
            ..ClipboardPayload::default()
        });

        assert!(ok);
        let local = service.current_local();
        assert_eq!(local.origin, ClipboardOrigin::LocalSystem);
        assert_eq!(local.source_device_id, "device-a");
        assert_eq!(local.revision, 1);

        let published = client
            .published
            .lock()
            .expect("published lock")
            .clone()
            .expect("published payload");
        assert_eq!(published.origin, ClipboardOrigin::LocalSystem);
        assert_eq!(published.images[0].mime_type, "image/png");
        assert_eq!(published.images[0].width, 12);
        assert_eq!(published.images[0].height, 8);
        assert_eq!(published.images[0].bytes, vec![1, 2, 3]);
    }
}
