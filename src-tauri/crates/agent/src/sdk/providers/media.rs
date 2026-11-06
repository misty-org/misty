//! Small rules the Anthropic and Responses clients share. Ported from `@ai-sdk/provider-utils`.
use base64::Engine;
use serde::Serializer;

use crate::sdk::{
    error::ModelError,
    media_type::{detect_in_base64, is_full, lenient_base64, top_level},
    prompt::FileData,
};

/// What `UnsupportedFunctionalityError` says.
pub(crate) fn unsupported(functionality: &str) -> ModelError {
    ModelError::Unsupported(format!("'{functionality}' functionality not supported."))
}

/// A file's full `type/subtype`, looking at its bytes when it only says `image/*`.
pub(crate) fn resolve_full_media_type(media_type: &str, data: &FileData) -> Result<String, ModelError> {
    if is_full(media_type) {
        return Ok(media_type.to_owned());
    }
    match data {
        FileData::Data { data } => detect_in_base64(data, top_level(media_type))
            .map(str::to_owned)
            .ok_or_else(|| {
                unsupported(&format!(
                    "file of media type \"{media_type}\" must specify subtype since it could not be auto-detected"
                ))
            }),
        FileData::Url { .. } => Err(unsupported(&format!(
            "file of media type \"{media_type}\" must specify subtype since it is not passed as inline bytes"
        ))),
    }
}

/// Base64 text as a string, for a text file sent inline.
pub(crate) fn decode_text(data: &str) -> String {
    lenient_base64()
        .decode(data)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

/// JavaScript's `trim`, which also removes a byte order mark and leaves U+0085 alone.
pub(crate) fn js_trim(text: &str) -> &str {
    let space = |c: char| {
        matches!(
            c,
            '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}'
                | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
        )
    };
    text.trim_matches(space)
}

/// Writes a number as JavaScript does, so a temperature of `1.0` is `1`.
pub(crate) fn js_number<S: Serializer>(value: &Option<f64>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(value) if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 => {
            serializer.serialize_i64(*value as i64)
        }
        Some(value) => serializer.serialize_f64(*value),
        None => serializer.serialize_none(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_types_resolve_from_bytes_only_when_they_must() {
        let png = FileData::Data { data: "iVBORw0KGgo=".into() };
        assert_eq!(resolve_full_media_type("image/jpeg", &png).unwrap(), "image/jpeg");
        assert_eq!(resolve_full_media_type("image/*", &png).unwrap(), "image/png");
        assert_eq!(resolve_full_media_type("image", &png).unwrap(), "image/png");
        assert!(resolve_full_media_type("image/*", &FileData::Url { url: "https://a".into() }).is_err());
        assert!(resolve_full_media_type("image/*", &FileData::Data { data: "aGVsbG8=".into() }).is_err());
    }

    #[test]
    fn trimming_matches_javascript() {
        assert_eq!(js_trim("\u{feff} a b\n\t"), "a b");
        assert_eq!(js_trim("\u{85}a"), "\u{85}a");
    }
}
