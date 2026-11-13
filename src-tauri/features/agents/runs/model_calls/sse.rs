//! Server-sent events, fed in whatever pieces the network delivers.

/// Gathers bytes into complete events. Holds bytes rather than text, because a network read can
/// end in the middle of a multi-byte character.
#[derive(Default)]
pub(crate) struct SseDecoder {
    pending: Vec<u8>,
    data: Vec<String>,
}

impl SseDecoder {
    /// Takes more bytes and returns the data of every event they completed.
    pub(crate) fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            let line = String::from_utf8_lossy(&line);
            self.line(line.trim_end_matches(['\n', '\r']), &mut events);
        }
        events
    }

    fn line(&mut self, line: &str, events: &mut Vec<String>) {
        if line.is_empty() {
            if !self.data.is_empty() {
                events.push(self.data.join("\n"));
                self.data.clear();
            }
        } else if let Some(value) = line.strip_prefix("data:") {
            self.data.push(value.strip_prefix(' ').unwrap_or(value).to_owned());
        }
        // Comments (`:`), `event:`, `id:` and `retry:` lines carry nothing Misty reads.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_survive_any_split() {
        let text = "data: {\"a\":\"é\"}\n\n: comment\r\nevent: x\r\ndata: one\r\ndata: two\r\n\r\n";
        let whole = SseDecoder::default().push(text.as_bytes());
        assert_eq!(whole, ["{\"a\":\"é\"}", "one\ntwo"]);
        let mut decoder = SseDecoder::default();
        let mut split = Vec::new();
        for byte in text.as_bytes() {
            split.extend(decoder.push(&[*byte]));
        }
        assert_eq!(split, whole, "one byte at a time, even inside a character");
    }

    #[test]
    fn an_unfinished_last_event_stays_unfinished() {
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(b"data: last").is_empty());
        assert_eq!(decoder.push(b"\n\n"), ["last"]);
    }
}
