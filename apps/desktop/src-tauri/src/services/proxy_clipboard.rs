use std::{
    io::{BufRead, BufReader},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use reqwest::blocking::Client;
use serde_json::json;

use crate::core::clipboard::{
    ClipboardCache, ClipboardImageBlobCacheKey, ClipboardPayload, ClipboardPayloadKind,
    ClipboardService, SharedClipboardClient,
};

#[derive(Debug)]
pub struct ProxyClipboardClient {
    client: Client,
    device_id: String,
    device_name: String,
    proxy_url: Option<String>,
    running: AtomicBool,
}

impl ProxyClipboardClient {
    pub fn new(proxy_url: Option<String>, device_id: String, device_name: String) -> Arc<Self> {
        Arc::new(Self {
            client: Client::new(),
            device_id,
            device_name,
            proxy_url,
            running: AtomicBool::new(false),
        })
    }

    pub fn start(self: &Arc<Self>, clipboard: Arc<ClipboardService>) {
        if self.proxy_url.is_none() || self.running.swap(true, Ordering::AcqRel) {
            return;
        }
        let client = Arc::clone(self);
        thread::spawn(move || {
            let _ = client.register_device();
            client.stream_loop(clipboard);
        });
    }

    fn register_device(&self) -> bool {
        let Some(url) = self.endpoint("/api/clipboard/register") else {
            return false;
        };
        self.client
            .post(url)
            .json(&json!({
                "device_id": self.device_id,
                "device_name": self.device_name,
            }))
            .send()
            .is_ok_and(|response| response.status().is_success())
    }

    fn stream_loop(&self, clipboard: Arc<ClipboardService>) {
        while self.running.load(Ordering::Acquire) {
            let Some(url) = self.endpoint(&format!(
                "/api/clipboard/stream?device_id={}",
                url_encode(&self.device_id)
            )) else {
                return;
            };
            match self.client.get(url).send() {
                Ok(response) if response.status().is_success() => {
                    let reader = BufReader::new(response);
                    let mut event_name = String::new();
                    for line in reader.lines() {
                        if !self.running.load(Ordering::Acquire) {
                            return;
                        }
                        let Ok(line) = line else {
                            break;
                        };
                        if let Some(event) = line.strip_prefix("event:") {
                            event_name = event.trim().to_owned();
                        } else if let Some(data) = line.strip_prefix("data:") {
                            if event_name == "clipboard" {
                                if let Ok(payload) =
                                    serde_json::from_str::<ClipboardPayload>(data.trim())
                                {
                                    clipboard.accept_remote_payload(payload);
                                }
                            }
                            event_name.clear();
                        }
                    }
                }
                _ => {}
            }
            thread::sleep(Duration::from_millis(1000));
        }
    }

    fn endpoint(&self, path: &str) -> Option<String> {
        let base = self.proxy_url.as_ref()?.trim_end_matches('/');
        Some(format!("{base}{path}"))
    }

    fn upload_image_blob(&self, image: &mut crate::core::clipboard::ClipboardImage) -> bool {
        if image.bytes.is_empty() || !image.blob_id.is_empty() {
            return true;
        }
        let Some(url) = self.endpoint("/api/clipboard/blobs") else {
            return false;
        };
        let content_type = if image.mime_type.is_empty() {
            "application/octet-stream"
        } else {
            image.mime_type.as_str()
        };
        let mut request = self
            .client
            .post(url)
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .body(image.bytes.clone());
        if !image.checksum.is_empty() {
            request = request.header("X-Misty-Blob-Checksum", image.checksum.clone());
        }
        let Ok(response) = request.send() else {
            return false;
        };
        if !response.status().is_success() {
            return false;
        }
        let Ok(value) = response.json::<serde_json::Value>() else {
            return false;
        };
        image.blob_id = value
            .get("blob_id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if let Some(mime_type) = value.get("mime_type").and_then(serde_json::Value::as_str) {
            image.mime_type = mime_type.to_owned();
        }
        if let Some(size_bytes) = value.get("size_bytes").and_then(serde_json::Value::as_u64) {
            image.size_bytes = size_bytes;
        } else if image.size_bytes == 0 {
            image.size_bytes = image.bytes.len() as u64;
        }
        if let Some(checksum) = value.get("checksum").and_then(serde_json::Value::as_str) {
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
        let Some(url) = self.endpoint(&format!(
            "/api/clipboard/blobs/{}",
            url_encode(&image.blob_id)
        )) else {
            return false;
        };
        let Ok(response) = self.client.get(url).send() else {
            return false;
        };
        if !response.status().is_success() {
            return false;
        }
        let Ok(bytes) = response.bytes() else {
            return false;
        };
        image.bytes = bytes.to_vec();
        if image.size_bytes == 0 {
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
        let Some(url) = self.endpoint("/api/clipboard/publish") else {
            return false;
        };
        let mut payload = payload.clone();
        for image in &mut payload.images {
            if !self.upload_image_blob(image) {
                return false;
            }
        }
        self.client
            .post(url)
            .json(&payload)
            .send()
            .is_ok_and(|response| response.status().is_success())
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

fn url_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}
