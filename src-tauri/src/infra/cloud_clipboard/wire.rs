//! What travels to and from the clipboard Worker: the sealed manifest, blob
//! references, room events and tickets.

use super::*;

/// What a clip holds once opened. Sealed as part 0; files and images are
/// separate sealed parts named by the SHA-256 of their ciphertext.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct Manifest {
    pub(super) v: u32,
    pub(super) kind: ClipboardPayloadKind,
    pub(super) revision: u64,
    pub(super) created_unix_ms: i64,
    pub(super) device_name: String,
    #[serde(default)]
    pub(super) text: String,
    #[serde(default)]
    pub(super) html: String,
    #[serde(default)]
    pub(super) image: Option<ImagePart>,
    #[serde(default)]
    pub(super) files: Vec<FilePart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct BlobRef {
    pub(super) sha256: String,
    pub(super) part: u32,
    /// Plaintext size.
    pub(super) size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct ImagePart {
    pub(super) mime_type: String,
    pub(super) width: i32,
    pub(super) height: i32,
    pub(super) blob: BlobRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct FilePart {
    pub(super) name: String,
    /// A folder travels as one ZIP archive named after it.
    pub(super) zipped_folder: bool,
    pub(super) blob: BlobRef,
}

/// A clip as the Worker lists it.
#[derive(Debug, Clone, Deserialize)]
pub(super) struct WireClip {
    pub(super) clip_id: String,
    pub(super) device_id: String,
    pub(super) size: u64,
    pub(super) manifest: String,
    pub(super) created_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum RoomEvent {
    Clips { clips: Vec<WireClip> },
    Clip { clip: WireClip },
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct Ticket {
    pub(super) ticket: String,
    pub(super) room: String,
    pub(super) url: String,
    #[serde(skip, default = "Instant::now")]
    pub(super) fetched: Instant,
}

#[derive(Default)]
pub(super) struct Opened {
    pub(super) summary: Option<ClipSummary>,
    pub(super) manifest: Option<Manifest>,
}

pub(super) fn open_manifest(session: &Session, clip: &WireClip) -> Opened {
    let Ok(sealed) = STANDARD.decode(&clip.manifest) else {
        return Opened::default();
    };
    let Ok(plain) = session.key.open(&clip.clip_id, 0, &sealed) else {
        return Opened::default();
    };
    let Ok(manifest) = serde_json::from_slice::<Manifest>(&plain) else {
        return Opened::default();
    };
    if manifest.v != 1 {
        return Opened::default();
    }
    let preview: String = match manifest.kind {
        ClipboardPayloadKind::Text | ClipboardPayloadKind::Html => {
            manifest.text.chars().take(200).collect()
        }
        ClipboardPayloadKind::Image => "Image".into(),
        _ => String::new(),
    };
    Opened {
        summary: Some(ClipSummary {
            clip_id: clip.clip_id.clone(),
            device_id: clip.device_id.clone(),
            device_name: manifest.device_name.clone(),
            from_this_device: clip.device_id == session.server_device_id,
            kind: manifest.kind,
            preview,
            file_names: manifest
                .files
                .iter()
                .map(|file| file.name.clone())
                .collect(),
            size: clip.size,
            created_at: clip.created_at,
        }),
        manifest: Some(manifest),
    }
}
