//! Server-sent events, decoded by hand: frames end at a blank line and only
//! their `data:` lines matter. Each frame's data is one JSON value.
use serde_json::Value;

#[derive(Default)]
pub struct SseDecoder {
    buffer: String,
}

impl SseDecoder {
    /// Adds received bytes and returns the JSON of every frame they complete.
    /// Frames that aren't JSON are skipped.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Value> {
        self.buffer
            .push_str(&String::from_utf8_lossy(bytes).replace("\r\n", "\n"));
        let mut out = Vec::new();
        while let Some(end) = self.buffer.find("\n\n") {
            let frame: String = self.buffer.drain(..end + 2).collect();
            let data = frame
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .map(|data| data.strip_prefix(' ').unwrap_or(data))
                .collect::<Vec<_>>()
                .join("\n");
            if let Ok(value) = serde_json::from_str(&data) {
                out.push(value);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_split_across_chunks_decode_once_complete() {
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(b"event: message\ndata: {\"type\":").is_empty());
        let frames =
            decoder.push(b"\"a\"}\n\n: comment\n\ndata: {\"type\":\"b\"}\r\n\r\ndata: oops\n\n");
        assert_eq!(
            frames,
            vec![
                serde_json::json!({"type": "a"}),
                serde_json::json!({"type": "b"})
            ]
        );
    }
}
