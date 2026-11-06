//! A command's output, kept within what a model can use. Command output goes back to the model, so
//! it keeps the start and the end, where errors and results usually are, and drops the middle.
const HEAD_BYTES: usize = 40 * 1024;
const TAIL_BYTES: usize = 20 * 1024;

#[derive(Default)]
pub(super) struct CappedOutput {
    head: Vec<u8>,
    tail: Vec<u8>,
    dropped: bool,
}

impl CappedOutput {
    pub(super) fn push(&mut self, mut bytes: &[u8]) {
        if self.head.len() < HEAD_BYTES {
            let room = (HEAD_BYTES - self.head.len()).min(bytes.len());
            self.head.extend_from_slice(&bytes[..room]);
            bytes = &bytes[room..];
        }
        if bytes.is_empty() {
            return;
        }
        self.tail.extend_from_slice(bytes);
        if self.tail.len() > TAIL_BYTES {
            let extra = self.tail.len() - TAIL_BYTES;
            self.tail.drain(..extra);
            self.dropped = true;
        }
    }

    /// The text, and whether anything was left out.
    pub(super) fn finish(self) -> (String, bool) {
        let head = String::from_utf8_lossy(&self.head);
        if self.tail.is_empty() {
            return (head.into_owned(), false);
        }
        let tail = String::from_utf8_lossy(&self.tail);
        if self.dropped {
            return (format!("{head}\n[output cut here]\n{tail}"), true);
        }
        (format!("{head}{tail}"), false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_output_keeps_both_ends() {
        let mut output = CappedOutput::default();
        output.push(b"start");
        output.push(&vec![b'x'; HEAD_BYTES + TAIL_BYTES + 100]);
        output.push(b"end");
        let (text, cut) = output.finish();
        assert!(cut);
        assert!(text.starts_with("start") && text.ends_with("end"));
        assert!(text.contains("[output cut here]"));
        assert!(text.len() < HEAD_BYTES + TAIL_BYTES + 100);
    }

    #[test]
    fn short_output_comes_back_whole() {
        let mut output = CappedOutput::default();
        output.push(b"hello ");
        output.push(b"there");
        assert_eq!(output.finish(), ("hello there".to_owned(), false));
    }
}
