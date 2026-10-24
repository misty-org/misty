//! A clip as it travels in the sync ring: a JSON header and the image bytes,
//! compressed together, then sealed to its ring slot by the caller. Every clip
//! fits one ring record, so large images shrink and long text is cut first.

use std::io::{Cursor, Read as _};

use serde::{Deserialize, Serialize};

use crate::domain::clipboard::{ClipboardImage, ClipboardPayload, ClipboardPayloadKind};

const VERSION: u32 = 2;
/// Text kept from a copy before it is compressed.
const MAX_TEXT_BYTES: usize = 1024 * 1024;
/// The most a received clip may expand to; anything larger is refused.
const MAX_OPENED_BYTES: usize = 4 * 1024 * 1024;
const COMPRESSION_LEVEL: i32 = 9;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(super) struct Header {
    pub v: u32,
    pub clip_id: String,
    pub kind: ClipboardPayloadKind,
    pub revision: u64,
    pub created_unix_ms: i64,
    pub device_id: String,
    pub device_name: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub html: String,
    #[serde(default)]
    pub image: Option<ImageMeta>,
    /// Copied files cross as their names only.
    #[serde(default)]
    pub file_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(super) struct ImageMeta {
    pub mime_type: String,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct Clip {
    pub header: Header,
    pub image: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ClipError {
    /// Nothing to share (an empty copy).
    Empty,
    /// An image too large to share even after shrinking it.
    TooLarge,
    Invalid,
}

/// Compresses a clip into a ring body.
pub(super) fn encode(clip: &Clip) -> Result<Vec<u8>, ClipError> {
    let header = serde_json::to_vec(&clip.header).map_err(|_| ClipError::Invalid)?;
    let mut plain = Vec::with_capacity(4 + header.len() + clip.image.len());
    plain.extend_from_slice(&(header.len() as u32).to_le_bytes());
    plain.extend_from_slice(&header);
    plain.extend_from_slice(&clip.image);
    zstd::bulk::compress(&plain, COMPRESSION_LEVEL).map_err(|_| ClipError::Invalid)
}

/// Opens a ring body. It never expands past `MAX_OPENED_BYTES`.
pub(super) fn decode(body: &[u8]) -> Result<Clip, ClipError> {
    let mut plain = Vec::new();
    zstd::stream::read::Decoder::new(Cursor::new(body))
        .map_err(|_| ClipError::Invalid)?
        .take(MAX_OPENED_BYTES as u64 + 1)
        .read_to_end(&mut plain)
        .map_err(|_| ClipError::Invalid)?;
    if plain.len() > MAX_OPENED_BYTES || plain.len() < 4 {
        return Err(ClipError::Invalid);
    }
    let length = u32::from_le_bytes(plain[..4].try_into().expect("four bytes")) as usize;
    let header_end = 4usize
        .checked_add(length)
        .filter(|end| *end <= plain.len())
        .ok_or(ClipError::Invalid)?;
    let header: Header =
        serde_json::from_slice(&plain[4..header_end]).map_err(|_| ClipError::Invalid)?;
    if header.v != VERSION || header.clip_id.is_empty() || header.clip_id.len() > 64 {
        return Err(ClipError::Invalid);
    }
    let image = plain[header_end..].to_vec();
    if header.image.is_some() == image.is_empty() {
        return Err(ClipError::Invalid);
    }
    Ok(Clip { header, image })
}

/// Who copied a clip, as the ring records it.
pub(super) struct Source<'a> {
    pub device_id: &'a str,
    pub device_name: &'a str,
}

/// Builds the clip for a copy, shrinking it until its body fits `capacity`.
pub(super) fn from_payload(
    payload: &ClipboardPayload,
    source: &Source<'_>,
    capacity: usize,
) -> Result<(Clip, Vec<u8>), ClipError> {
    let mut header = Header {
        v: VERSION,
        clip_id: format!("clip_{}", uuid::Uuid::new_v4().simple()),
        kind: payload.kind,
        revision: payload.revision,
        created_unix_ms: payload.created_unix_ms,
        device_id: source.device_id.to_owned(),
        device_name: source.device_name.to_owned(),
        text: truncate_utf8(&payload.text, MAX_TEXT_BYTES),
        html: truncate_utf8(&payload.html, MAX_TEXT_BYTES),
        image: None,
        file_names: Vec::new(),
    };
    match payload.kind {
        ClipboardPayloadKind::Empty => return Err(ClipError::Empty),
        ClipboardPayloadKind::FileRefs => {
            header.file_names = payload
                .file_refs
                .iter()
                .map(|file| file.display_name.clone())
                .filter(|name| !name.is_empty())
                .take(200)
                .collect();
            header.kind = ClipboardPayloadKind::Text;
            header.text = truncate_utf8(&header.file_names.join("\n"), MAX_TEXT_BYTES);
        }
        ClipboardPayloadKind::Image => {
            let image = payload
                .images
                .first()
                .filter(|image| !image.bytes.is_empty())
                .ok_or(ClipError::Empty)?;
            return fit_image(header, image, capacity);
        }
        ClipboardPayloadKind::Text | ClipboardPayloadKind::Html => {}
    }
    fit_text(header, capacity)
}

/// Long text loses its HTML first, then is halved until it fits.
fn fit_text(mut header: Header, capacity: usize) -> Result<(Clip, Vec<u8>), ClipError> {
    loop {
        let clip = Clip {
            header: header.clone(),
            image: Vec::new(),
        };
        let body = encode(&clip)?;
        if body.len() <= capacity {
            return Ok((clip, body));
        }
        if !header.html.is_empty() {
            header.html.clear();
            header.kind = ClipboardPayloadKind::Text;
        } else if header.text.len() > 16 {
            header.text = truncate_utf8(&header.text, header.text.len() / 2);
        } else {
            return Err(ClipError::TooLarge);
        }
    }
}

/// Tries the image as copied, then smaller lossless and lossy versions.
fn fit_image(
    mut header: Header,
    image: &ClipboardImage,
    capacity: usize,
) -> Result<(Clip, Vec<u8>), ClipError> {
    header.html.clear();
    let attempt = |header: &mut Header, mime: &str, width: i32, height: i32, bytes: Vec<u8>| {
        header.image = Some(ImageMeta {
            mime_type: mime.to_owned(),
            width,
            height,
        });
        let clip = Clip {
            header: header.clone(),
            image: bytes,
        };
        let body = encode(&clip).ok()?;
        (body.len() <= capacity).then_some((clip, body))
    };
    if let Some(fit) = attempt(
        &mut header,
        &image.mime_type,
        image.width,
        image.height,
        image.bytes.clone(),
    ) {
        return Ok(fit);
    }
    let decoded = image::load_from_memory(&image.bytes).map_err(|_| ClipError::TooLarge)?;
    for scale in [1.0, 0.75, 0.5, 0.35, 0.25] {
        let scaled = if scale < 1.0 {
            decoded.resize(
                ((decoded.width() as f64 * scale) as u32).max(1),
                ((decoded.height() as f64 * scale) as u32).max(1),
                image::imageops::FilterType::Triangle,
            )
        } else {
            decoded.clone()
        };
        let (width, height) = (scaled.width() as i32, scaled.height() as i32);
        if let Some(png) = encode_image(&scaled, image::ImageFormat::Png) {
            if let Some(fit) = attempt(&mut header, "image/png", width, height, png) {
                return Ok(fit);
            }
        }
        // Photos and screenshots of photos compress far better as JPEG.
        if let Some(jpeg) = encode_jpeg(&scaled) {
            if let Some(fit) = attempt(&mut header, "image/jpeg", width, height, jpeg) {
                return Ok(fit);
            }
        }
    }
    Err(ClipError::TooLarge)
}

fn encode_image(image: &image::DynamicImage, format: image::ImageFormat) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    image.write_to(&mut Cursor::new(&mut bytes), format).ok()?;
    Some(bytes)
}

fn encode_jpeg(image: &image::DynamicImage) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 82)
        .encode_image(&image.to_rgb8())
        .ok()?;
    Some(bytes)
}

pub(super) fn truncate_utf8(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_owned();
    }
    let mut end = limit;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

#[cfg(test)]
mod tests;
