//! Command output the model can afford: the start and the end of what a
//! command printed, with the middle dropped and terminal escapes removed.
use std::collections::VecDeque;

/// Keeps the first `head` bytes and the last `tail` bytes of a stream.
pub struct Capped {
    head: Vec<u8>,
    tail: VecDeque<u8>,
    head_limit: usize,
    tail_limit: usize,
    total: usize,
}

impl Capped {
    pub fn new(head_limit: usize, tail_limit: usize) -> Self {
        Self {
            head: Vec::new(),
            tail: VecDeque::new(),
            head_limit,
            tail_limit,
            total: 0,
        }
    }

    pub fn push(&mut self, bytes: &[u8]) {
        self.total += bytes.len();
        let room = self.head_limit.saturating_sub(self.head.len());
        let (to_head, rest) = bytes.split_at(room.min(bytes.len()));
        self.head.extend_from_slice(to_head);
        for byte in rest {
            if self.tail.len() == self.tail_limit {
                self.tail.pop_front();
            }
            self.tail.push_back(*byte);
        }
    }

    pub fn total(&self) -> usize {
        self.total
    }

    /// The kept text. When bytes were dropped, says how many.
    pub fn render(&self) -> String {
        let kept = self.head.len() + self.tail.len();
        let head = clean(&self.head);
        if self.tail.is_empty() {
            return head;
        }
        let tail: Vec<u8> = self.tail.iter().copied().collect();
        let tail = clean(&tail);
        if kept >= self.total {
            return format!("{head}{tail}");
        }
        format!(
            "{head}\n… [{} bytes of output omitted] …\n{tail}",
            self.total - kept
        )
    }
}

/// Lossy UTF-8 with ANSI escape sequences and carriage-return redraws removed.
pub fn clean(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    while let Some(&next) = chars.peek() {
                        chars.next();
                        if ('@'..='~').contains(&next) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    while let Some(next) = chars.next() {
                        if next == '\u{7}' {
                            break;
                        }
                        if next == '\u{1b}' {
                            chars.next();
                            break;
                        }
                    }
                }
                _ => {
                    chars.next();
                }
            }
            continue;
        }
        out.push(c);
    }
    // Progress bars redraw a line with \r; keep only the final state.
    out.split('\n')
        .map(|line| line.rsplit('\r').find(|part| !part.is_empty()).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_head_and_tail() {
        let mut capped = Capped::new(4, 4);
        capped.push(b"0123456789");
        assert_eq!(capped.render(), "0123\n… [2 bytes of output omitted] …\n6789");
        let mut short = Capped::new(4, 4);
        short.push(b"012345");
        assert_eq!(short.render(), "012345");
    }

    #[test]
    fn strips_escapes_and_redraws() {
        assert_eq!(clean(b"\x1b[32mok\x1b[0m\r\n10%\r50%\r100%"), "ok\n100%");
    }
}
