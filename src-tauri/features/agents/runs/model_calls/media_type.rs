//! Works out a file's type from its first bytes. Ported from the SDK's `detectMediaType`.
use base64::{
    alphabet,
    engine::{general_purpose::GeneralPurpose, DecodePaddingMode, GeneralPurposeConfig},
    Engine,
};

const SNIFF_BYTES: usize = 18;
const MAX_SIGNATURE_BYTES: usize = 12;
const MAX_ID3_TAG_BYTES: usize = 128 * 1024;

type Signature = (&'static str, &'static [Option<u8>]);

macro_rules! prefix {
    ($($byte:expr),* $(,)?) => { &[$(prefix!(@one $byte)),*] };
    (@one _) => { None };
    (@one $byte:expr) => { Some($byte) };
}

const FTYP_ANY: &[Option<u8>] = &[Some(0), Some(0), Some(0), None, Some(102), Some(116), Some(121), Some(112)];
const RIFF_WEBP: &[Option<u8>] = &[Some(82), Some(73), Some(70), Some(70), None, None, None, None, Some(87), Some(69), Some(66), Some(80)];
const RIFF_WAVE: &[Option<u8>] = &[Some(82), Some(73), Some(70), Some(70), None, None, None, None, Some(87), Some(65), Some(86), Some(69)];

const IMAGE: &[Signature] = &[
    ("image/gif", prefix![71, 73, 70]),
    ("image/png", prefix![137, 80, 78, 71]),
    ("image/jpeg", prefix![255, 216]),
    ("image/webp", RIFF_WEBP),
    ("image/bmp", prefix![66, 77]),
    ("image/tiff", prefix![73, 73, 42, 0]),
    ("image/tiff", prefix![77, 77, 0, 42]),
    ("image/avif", prefix![0, 0, 0, 32, 102, 116, 121, 112, 97, 118, 105, 102]),
    ("image/heic", prefix![0, 0, 0, 32, 102, 116, 121, 112, 104, 101, 105, 99]),
];

const DOCUMENT: &[Signature] = &[("application/pdf", prefix![37, 80, 68, 70])];

const AUDIO: &[Signature] = &[
    ("audio/mpeg", prefix![255, 251]),
    ("audio/mpeg", prefix![255, 250]),
    ("audio/mpeg", prefix![255, 243]),
    ("audio/mpeg", prefix![255, 242]),
    ("audio/mpeg", prefix![255, 227]),
    ("audio/mpeg", prefix![255, 226]),
    ("audio/wav", RIFF_WAVE),
    ("audio/ogg", prefix![79, 103, 103, 83]),
    ("audio/flac", prefix![102, 76, 97, 67]),
    ("audio/aac", prefix![64, 21, 0, 0]),
    ("audio/webm", prefix![26, 69, 223, 163]),
    ("audio/mp4", FTYP_ANY),
];

const VIDEO: &[Signature] = &[
    ("video/mp4", FTYP_ANY),
    ("video/webm", prefix![26, 69, 223, 163]),
    ("video/quicktime", prefix![0, 0, 0, 20, 102, 116, 121, 112, 113, 116]),
    ("video/x-msvideo", prefix![82, 73, 70, 70]),
];

fn table(top_level: &str) -> Option<&'static [Signature]> {
    match top_level {
        "image" => Some(IMAGE),
        "audio" => Some(AUDIO),
        "video" => Some(VIDEO),
        "application" => Some(DOCUMENT),
        _ => None,
    }
}

/// Base64 as it comes from a model or a caller, which may lack padding.
pub(crate) fn lenient_base64() -> GeneralPurpose {
    GeneralPurpose::new(
        &alphabet::STANDARD,
        GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
    )
}

fn matches(bytes: &[u8], signature: &[Option<u8>]) -> bool {
    bytes.len() >= signature.len()
        && signature
            .iter()
            .zip(bytes)
            .all(|(expected, byte)| expected.map_or(true, |expected| expected == *byte))
}

fn has_id3(bytes: &[u8]) -> bool {
    bytes.len() > 10 && &bytes[..3] == b"ID3"
}

fn without_id3(bytes: &[u8]) -> &[u8] {
    let size = bytes
        .get(6..10)
        .map(|size| {
            usize::from(size[0] & 127) << 21
                | usize::from(size[1] & 127) << 14
                | usize::from(size[2] & 127) << 7
                | usize::from(size[3] & 127)
        })
        .unwrap_or(0);
    bytes.get(size + 10..).unwrap_or(&[])
}

fn by_signature(bytes: &[u8], signatures: &[Signature]) -> Option<&'static str> {
    let bytes = if has_id3(bytes) { without_id3(bytes) } else { &bytes[..bytes.len().min(SNIFF_BYTES)] };
    signatures
        .iter()
        .find(|(_, prefix)| matches(bytes, prefix))
        .map(|(media_type, _)| *media_type)
}

/// The type of raw bytes, if a signature in that family matches.
pub(crate) fn detect_in_bytes(bytes: &[u8], top_level: &str) -> Option<&'static str> {
    by_signature(bytes, table(top_level)?)
}

/// The type of base64 data, reading only as much as a signature needs.
pub(crate) fn detect_in_base64(data: &str, top_level: &str) -> Option<&'static str> {
    let signatures = table(top_level)?;
    let decode = |bytes: usize| {
        let chars = bytes.div_ceil(3) * 4;
        let prefix: String = data.chars().take(chars).collect();
        lenient_base64().decode(prefix).ok()
    };
    let start = decode(SNIFF_BYTES)?;
    if has_id3(&start) {
        return by_signature(&decode(MAX_ID3_TAG_BYTES + MAX_SIGNATURE_BYTES)?, signatures);
    }
    by_signature(&start, signatures)
}

/// `getTopLevelMediaType`.
pub(crate) fn top_level(media_type: &str) -> &str {
    media_type.split('/').next().unwrap_or(media_type)
}

/// `isFullMediaType`: a type with a real subtype, not `image` or `image/*`.
pub(crate) fn is_full(media_type: &str) -> bool {
    media_type
        .split_once('/')
        .is_some_and(|(_, subtype)| !subtype.is_empty() && subtype != "*")
}

/// `mediaTypeToExtension`.
pub(crate) fn extension(media_type: &str) -> String {
    let lower = media_type.to_lowercase();
    let subtype = lower.split('/').nth(1).unwrap_or("");
    match subtype {
        "mpeg" => "mp3".to_owned(),
        "x-wav" => "wav".to_owned(),
        "opus" => "ogg".to_owned(),
        "mp4" | "x-m4a" => "m4a".to_owned(),
        other => other.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signatures_are_found_in_bytes_and_base64() {
        let wav = b"RIFF\x24\0\0\0WAVEfmt ";
        assert_eq!(detect_in_bytes(wav, "audio"), Some("audio/wav"));
        assert_eq!(detect_in_bytes(wav, "image"), None);
        assert_eq!(detect_in_base64("iVBORw0KGgo=", "image"), Some("image/png"));
        assert_eq!(detect_in_base64("/9j/4AAQ", "image"), Some("image/jpeg"));
        assert_eq!(detect_in_bytes(b"\x00\x00\x00\x18ftypM4A ", "audio"), Some("audio/mp4"));
        assert_eq!(detect_in_bytes(b"nothing here", "audio"), None);
        assert_eq!(detect_in_bytes(b"nothing here", "text"), None);
    }

    #[test]
    fn id3_tags_are_skipped() {
        let mut tagged = b"ID3\x04\0\0\0\0\0\x02".to_vec();
        tagged.extend_from_slice(&[0, 0]);
        tagged.extend_from_slice(&[255, 251, 0, 0]);
        assert_eq!(detect_in_bytes(&tagged, "audio"), Some("audio/mpeg"));
    }

    #[test]
    fn extensions_and_full_types() {
        assert_eq!(extension("audio/mpeg"), "mp3");
        assert_eq!(extension("audio/wav"), "wav");
        assert_eq!(extension("audio/mp4"), "m4a");
        assert!(is_full("image/png"));
        assert!(!is_full("image"));
        assert!(!is_full("image/*"));
        assert!(!is_full("image/"));
        assert_eq!(top_level("image/png"), "image");
        assert_eq!(top_level("image"), "image");
    }
}
