//! A clip as the popover lists it and as this device pastes or saves it.
use super::*;

pub(super) fn fresh(clip: &Clip, now: i64) -> bool {
    now - clip.header.created_unix_ms < CLIP_LIFETIME_MS
}

pub(super) fn summary(clip: &Clip, session: Option<&ring::Session>) -> ClipSummary {
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

pub(super) fn payload(clip: &Clip) -> ClipboardPayload {
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

pub(super) fn unique_path(directory: &Path, name: &str) -> PathBuf {
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
