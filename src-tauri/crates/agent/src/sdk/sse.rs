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

    /// Takes what's left when the stream ends. As in the event stream standard, an event with no
    /// blank line after it was never finished and doesn't count, but a last line with no newline
    /// of its own and already holding complete data is kept: some servers end that way.
    pub(crate) fn finish(&mut self) -> Vec<String> {
        let mut events = Vec::new();
        if !self.pending.is_empty() {
            let rest = std::mem::take(&mut self.pending);
            let rest = String::from_utf8_lossy(&rest);
            self.line(rest.trim_end_matches('\r'), &mut events);
        }
        if !self.data.is_empty() {
            events.push(self.data.join("\n"));
            self.data.clear();
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
    fn an_unfinished_last_event_is_still_delivered() {
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(b"data: last").is_empty());
        assert_eq!(decoder.finish(), ["last"]);
    }
}
