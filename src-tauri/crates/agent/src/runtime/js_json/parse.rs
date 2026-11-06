//! `JSON.parse`. A parser of its own because `serde_json` without `float_roundtrip` can land a long
//! number one step off from the nearest double, turning it on would change the whole app, and text
//! rebuilt from a parsed value has to read as Node wrote it.
use super::{into_object, JsValue};

/// The deepest nesting read. Past this `JSON.parse` would still work, but a tool result doesn't get
/// here, and a stack overflow can't be caught.
const MAX_DEPTH: usize = 512;

struct Parser<'a> {
    text: &'a str,
    bytes: &'a [u8],
    at: usize,
}

pub(super) fn parse(text: &str) -> Option<JsValue> {
    let mut parser = Parser { text, bytes: text.as_bytes(), at: 0 };
    parser.skip_space();
    let value = parser.value(0)?;
    parser.skip_space();
    (parser.at == parser.bytes.len()).then_some(value)
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn skip_space(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.at += 1;
        }
    }

    fn eat(&mut self, word: &str) -> Option<()> {
        self.bytes[self.at..].starts_with(word.as_bytes()).then(|| self.at += word.len())
    }

    fn value(&mut self, depth: usize) -> Option<JsValue> {
        if depth > MAX_DEPTH {
            return None;
        }
        match self.peek()? {
            b'{' => self.object(depth),
            b'[' => self.array(depth),
            b'"' => self.string().map(JsValue::String),
            b't' => self.eat("true").map(|()| JsValue::Bool(true)),
            b'f' => self.eat("false").map(|()| JsValue::Bool(false)),
            b'n' => self.eat("null").map(|()| JsValue::Null),
            _ => self.number(),
        }
    }

    fn object(&mut self, depth: usize) -> Option<JsValue> {
        self.at += 1;
        let mut entries = Vec::new();
        self.skip_space();
        if self.peek()? == b'}' {
            self.at += 1;
            return Some(into_object(entries));
        }
        loop {
            self.skip_space();
            if self.peek()? != b'"' {
                return None;
            }
            let key = self.string()?;
            self.skip_space();
            self.eat(":")?;
            self.skip_space();
            entries.push((key, self.value(depth + 1)?));
            self.skip_space();
            match self.peek()? {
                b',' => self.at += 1,
                b'}' => {
                    self.at += 1;
                    return Some(into_object(entries));
                }
                _ => return None,
            }
        }
    }

    fn array(&mut self, depth: usize) -> Option<JsValue> {
        self.at += 1;
        let mut items = Vec::new();
        self.skip_space();
        if self.peek()? == b']' {
            self.at += 1;
            return Some(JsValue::Array(items));
        }
        loop {
            self.skip_space();
            items.push(self.value(depth + 1)?);
            self.skip_space();
            match self.peek()? {
                b',' => self.at += 1,
                b']' => {
                    self.at += 1;
                    return Some(JsValue::Array(items));
                }
                _ => return None,
            }
        }
    }

    fn digits(&mut self) -> usize {
        let start = self.at;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.at += 1;
        }
        self.at - start
    }

    fn number(&mut self) -> Option<JsValue> {
        let start = self.at;
        if self.peek()? == b'-' {
            self.at += 1;
        }
        if self.peek()? == b'0' {
            self.at += 1;
        } else if self.digits() == 0 {
            return None;
        }
        if self.peek() == Some(b'.') {
            self.at += 1;
            if self.digits() == 0 {
                return None;
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.at += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.at += 1;
            }
            if self.digits() == 0 {
                return None;
            }
        }
        self.text[start..self.at].parse().ok().map(JsValue::Number)
    }

    fn hex_unit(&mut self) -> Option<u16> {
        let digits = self.text.get(self.at..self.at + 4)?;
        if !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        self.at += 4;
        u16::from_str_radix(digits, 16).ok()
    }

    fn string(&mut self) -> Option<String> {
        self.at += 1;
        let mut out = String::new();
        // A run of \u escapes, which may pair into one character.
        let mut units: Vec<u16> = Vec::new();
        loop {
            let start = self.at;
            while !matches!(self.peek()?, b'"' | b'\\' | 0..=0x1F) {
                self.at += 1;
            }
            if self.at > start {
                out.push_str(&String::from_utf16_lossy(&units));
                units.clear();
                out.push_str(&self.text[start..self.at]);
            }
            let byte = self.peek()?;
            self.at += 1;
            match byte {
                b'"' => {
                    // A lone surrogate can't be held in a Rust string, so it reads as U+FFFD.
                    out.push_str(&String::from_utf16_lossy(&units));
                    return Some(out);
                }
                b'\\' => {
                    let escape = self.peek()?;
                    self.at += 1;
                    if escape == b'u' {
                        units.push(self.hex_unit()?);
                        continue;
                    }
                    out.push_str(&String::from_utf16_lossy(&units));
                    units.clear();
                    out.push(match escape {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{C}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        _ => return None,
                    });
                }
                _ => return None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> Option<String> {
        parse(text).map(|value| value.stringify())
    }

    #[test]
    fn reads_what_json_parse_reads() {
        assert_eq!(read(" { \"a\" : [ 1 , { } , [ ] , \"x\" ] } "), Some(r#"{"a":[1,{},[],"x"]}"#.to_owned()));
        assert_eq!(read("-0.5e1"), Some("-5".to_owned()));
        assert_eq!(read(r#""é😀\u00e9\ud83d\ude00\n""#), Some("\"é😀é😀\\n\"".to_owned()));
        assert_eq!(read(r#""\ud83dA""#), Some("\"\u{FFFD}A\"".to_owned()));
    }

    #[test]
    fn numbers_land_on_the_nearest_double() {
        assert_eq!(read("0.30000000000000004"), Some("0.30000000000000004".to_owned()));
        assert_eq!(read("37.77492950000001"), Some("37.77492950000001".to_owned()));
        assert_eq!(read("123456789012345680000"), Some("123456789012345680000".to_owned()));
    }

    #[test]
    fn refuses_what_json_parse_refuses() {
        for text in ["", "{", "[1,]", "{\"a\":1,}", "01", "1.", ".5", "+1", "1e", "tru", "\"a", "\"\\x\"", "\"\n\"", "1 2", "{a:1}", "[1 2]", "\"\\u12\""] {
            assert_eq!(read(text), None, "{text}");
        }
    }

    #[test]
    fn very_deep_text_is_refused_instead_of_overflowing_the_stack() {
        assert_eq!(read(&"[".repeat(100_000)), None);
    }
}
