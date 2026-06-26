use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde_json::{json, Value};

use crate::core::clipboard::{
    ClipboardCache, ClipboardImageBlobCacheKey, ClipboardPayload, ClipboardPayloadKind,
    ClipboardService, SharedClipboardClient,
};
use crate::services::proxy_runtime::{ProxyRuntimeMode, ProxyRuntimeService};

pub struct ProxyClipboardClient {
    device_id: String,
    device_name: String,
    proxy_runtime: Option<ProxyRuntimeService>,
    running: AtomicBool,
}

impl ProxyClipboardClient {
    pub fn new(
        proxy_url: Option<String>,
        proxy_runtime: Option<ProxyRuntimeService>,
        device_id: String,
        device_name: String,
    ) -> Arc<Self> {
        let _ = proxy_url;
        Arc::new(Self {
            device_id,
            device_name,
            proxy_runtime,
            running: AtomicBool::new(false),
        })
    }

    pub fn start(self: &Arc<Self>, clipboard: Arc<ClipboardService>) {
        if !self.uses_embedded() {
            return;
        }
        if self.running.swap(true, Ordering::AcqRel) {
            return;
        }
        let client = Arc::clone(self);
        thread::spawn(move || {
            let _ = client.register_device();
            client.poll_latest_loop(clipboard);
        });
    }

    fn register_device(&self) -> bool {
        self.invoke_embedded(
            "clipboard.register",
            json!({
                "device_id": self.device_id,
                "device_name": self.device_name,
            }),
        )
        .is_some()
    }

    fn poll_latest_loop(&self, clipboard: Arc<ClipboardService>) {
        let mut last_payload_id = String::new();
        while self.running.load(Ordering::Acquire) {
            if let Some(value) = self.invoke_embedded("clipboard.latest", json!({})) {
                if !value.is_null() {
                    if let Ok(payload) = serde_json::from_value::<ClipboardPayload>(value) {
                        let is_new = !payload.payload_id.is_empty()
                            && payload.payload_id != last_payload_id
                            && payload.source_device_id != self.device_id;
                        if is_new {
                            last_payload_id = payload.payload_id.clone();
                            clipboard.accept_remote_payload(payload);
                        }
                    }
                }
            }
            thread::sleep(Duration::from_millis(1000));
        }
    }

    fn uses_embedded(&self) -> bool {
        self.proxy_runtime
            .as_ref()
            .is_some_and(|runtime| runtime.snapshot().mode == ProxyRuntimeMode::Embedded)
    }

    fn invoke_embedded(&self, method: &str, params: Value) -> Option<Value> {
        self.proxy_runtime
            .as_ref()?
            .invoke_embedded(method, params)
            .ok()
    }

    fn upload_image_blob(&self, image: &mut crate::core::clipboard::ClipboardImage) -> bool {
        if image.bytes.is_empty() || !image.blob_id.is_empty() {
            return true;
        }
        let Some(value) = self.invoke_embedded(
            "clipboard.blob.put",
            json!({
                "mime_type": if image.mime_type.is_empty() {
                    "application/octet-stream"
                } else {
                    image.mime_type.as_str()
                },
                "bytes_base64": BASE64_STANDARD.encode(&image.bytes),
            }),
        ) else {
            return false;
        };
        image.blob_id = value
            .get("blob_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if let Some(mime_type) = value.get("mime_type").and_then(Value::as_str) {
            image.mime_type = mime_type.to_owned();
        }
        if let Some(size_bytes) = value.get("size_bytes").and_then(Value::as_u64) {
            image.size_bytes = size_bytes;
        } else if image.size_bytes == 0 {
            image.size_bytes = image.bytes.len() as u64;
        }
        if let Some(checksum) = value.get("checksum").and_then(Value::as_str) {
            image.checksum = checksum.to_owned();
        }
        !image.blob_id.is_empty()
    }

    fn download_image_blob(&self, image: &mut crate::core::clipboard::ClipboardImage) -> bool {
        if !image.bytes.is_empty() {
            return true;
        }
        if image.blob_id.is_empty() {
            return false;
        }
        let cache_key = ClipboardImageBlobCacheKey {
            blob_id: image.blob_id.clone(),
            checksum: image.checksum.clone(),
            size_bytes: image.size_bytes,
            mime_type: image.mime_type.clone(),
        };
        let mut cache = ClipboardCache::new(ClipboardCache::default_root());
        if let Some(bytes) = cache.lookup_image_blob(&cache_key) {
            image.bytes = bytes;
            if image.size_bytes == 0 {
                image.size_bytes = image.bytes.len() as u64;
            }
            return !image.bytes.is_empty();
        }
        let Some(value) = self.invoke_embedded(
            "clipboard.blob.get",
            json!({
                "blob_id": image.blob_id.clone(),
            }),
        ) else {
            return false;
        };
        let Some(encoded) = value.get("bytes_base64").and_then(Value::as_str) else {
            return false;
        };
        let Ok(bytes) = BASE64_STANDARD.decode(encoded) else {
            return false;
        };
        image.bytes = bytes;
        if let Some(mime_type) = value.get("mime_type").and_then(Value::as_str) {
            image.mime_type = mime_type.to_owned();
        }
        if let Some(checksum) = value.get("checksum").and_then(Value::as_str) {
            image.checksum = checksum.to_owned();
        }
        if let Some(size_bytes) = value.get("size_bytes").and_then(Value::as_u64) {
            image.size_bytes = size_bytes;
        } else if image.size_bytes == 0 {
            image.size_bytes = image.bytes.len() as u64;
        }
        let _ = cache.store_image_blob(&cache_key, &image.bytes);
        !image.bytes.is_empty()
    }
}

impl SharedClipboardClient for ProxyClipboardClient {
    fn publish(&self, payload: &ClipboardPayload) -> bool {
        if payload.empty() {
            return false;
        }
        let mut payload = payload.clone();
        for image in &mut payload.images {
            if !self.upload_image_blob(image) {
                return false;
            }
        }
        self.invoke_embedded(
            "clipboard.publish",
            json!({
                "payload": payload,
                "include_self": false,
            }),
        )
        .is_some()
    }

    fn hydrate_payload(&self, payload: &mut ClipboardPayload) -> bool {
        if payload.kind != ClipboardPayloadKind::Image {
            return true;
        }
        payload
            .images
            .iter_mut()
            .all(|image| self.download_image_blob(image))
    }
}
