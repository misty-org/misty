//! One phrase of a live transcript, as the desktop reads it (`live/segment.ts`).
use serde::{Serialize, Serializer};

use super::super::device::zod::number_value;

/// Which capture stream a segment came from. The mic is the local person.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LiveChannel {
    Mic,
    System,
}

impl LiveChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mic => "mic",
            Self::System => "system",
        }
    }
}

/// A number as `JSON.stringify` writes it.
fn js_number<S: Serializer>(number: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    number_value(*number).serialize(serializer)
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Word {
    pub(crate) text: String,
    /// Milliseconds from the start of the stream.
    #[serde(serialize_with = "js_number")]
    pub(crate) t0: f64,
    #[serde(serialize_with = "js_number")]
    pub(crate) t1: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) speaker: Option<String>,
}

/// One phrase of a live transcript. A segment is revised in place (same `id`, higher `revision`)
/// until it is final; a final segment never changes again.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Segment {
    pub(crate) id: String,
    pub(crate) session_id: String,
    pub(crate) sequence: u64,
    pub(crate) revision: u64,
    #[serde(serialize_with = "js_number")]
    pub(crate) start_ms: f64,
    #[serde(serialize_with = "js_number")]
    pub(crate) end_ms: f64,
    pub(crate) source_language: String,
    pub(crate) target_language: String,
    pub(crate) source_text: String,
    pub(crate) translated_text: String,
    #[serde(rename = "final")]
    pub(crate) is_final: bool,
    pub(crate) state: &'static str,
    /// Provider speaker label within this channel ("1", "2", …).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) speaker: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) channel: Option<LiveChannel>,
    /// Final words with timings; absent while provisional.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) words: Option<Vec<Word>>,
}
