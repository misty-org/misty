use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardPayloadKind {
    #[default]
    Empty,
    Text,
    Html,
    Image,
    FileRefs,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardOrigin {
    LocalSystem,
    #[default]
    LocalMisty,
    RemoteShared,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClipboardFileRef {
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub local_path: String,
    #[serde(default)]
    pub remote_name: String,
    #[serde(default)]
    pub remote_path: String,
    #[serde(default)]
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClipboardImage {
    #[serde(default = "default_image_mime_type")]
    pub mime_type: String,
    #[serde(default)]
    pub blob_id: String,
    #[serde(default)]
    pub checksum: String,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub width: i32,
    #[serde(default)]
    pub height: i32,
    #[serde(skip)]
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClipboardPayload {
    #[serde(default)]
    pub kind: ClipboardPayloadKind,
    #[serde(default)]
    pub origin: ClipboardOrigin,
    #[serde(default)]
    pub payload_id: String,
    #[serde(default)]
    pub source_device_id: String,
    #[serde(default)]
    pub source_device_name: String,
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub created_unix_ms: i64,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub html: String,
    #[serde(default)]
    pub file_refs: Vec<ClipboardFileRef>,
    #[serde(default)]
    pub images: Vec<ClipboardImage>,
}

impl ClipboardPayload {
    pub fn empty(&self) -> bool {
        match self.kind {
            ClipboardPayloadKind::Text => self.text.is_empty(),
            ClipboardPayloadKind::Html => self.html.is_empty() && self.text.is_empty(),
            ClipboardPayloadKind::Image => self.images.is_empty(),
            ClipboardPayloadKind::FileRefs => self.file_refs.is_empty(),
            ClipboardPayloadKind::Empty => {
                self.text.is_empty()
                    && self.html.is_empty()
                    && self.file_refs.is_empty()
                    && self.images.is_empty()
            }
        }
    }
}

impl Default for ClipboardImage {
    fn default() -> Self {
        Self {
            mime_type: default_image_mime_type(),
            blob_id: String::new(),
            checksum: String::new(),
            size_bytes: 0,
            width: 0,
            height: 0,
            bytes: Vec::new(),
        }
    }
}

fn default_image_mime_type() -> String {
    "image/png".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_empty_semantics_match_native() {
        let mut payload = ClipboardPayload {
            kind: ClipboardPayloadKind::Html,
            text: "fallback".into(),
            ..ClipboardPayload::default()
        };
        assert!(!payload.empty());
        payload.text.clear();
        assert!(payload.empty());
        payload.kind = ClipboardPayloadKind::FileRefs;
        payload.text = "ignored".into();
        assert!(payload.empty());
    }

    #[test]
    fn wire_format_uses_native_snake_case_fields() {
        let payload = ClipboardPayload {
            kind: ClipboardPayloadKind::FileRefs,
            file_refs: vec![ClipboardFileRef {
                display_name: "report.pdf".into(),
                remote_name: "drive".into(),
                remote_path: "/report.pdf".into(),
                ..ClipboardFileRef::default()
            }],
            ..ClipboardPayload::default()
        };
        let json = serde_json::to_value(payload).expect("serialize clipboard payload");
        assert_eq!(json["kind"], "file_refs");
        assert_eq!(json["file_refs"][0]["remote_name"], "drive");
    }
}
