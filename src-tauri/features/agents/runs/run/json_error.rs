//! V8's words for `JSON.parse` of text it can't read. A tool call cut off mid-JSON goes back to the
//! model with these, so it knows where its input broke. A scan of the grammar in V8's own order,
//! because `JsValue::parse` only says whether text parsed.
const CONTEXT: usize = 10;

enum Fault {
    End,
    Token(usize),
    Number(usize),
    String(usize),
    At(&'static str, usize),
}

struct Scan {
    units: Vec<u16>,
    at: usize,
}

const QUOTE: u16 = b'"' as u16;

fn ascii(unit: u16) -> char {
    char::from_u32(u32::from(unit)).unwrap_or('\u{FFFD}')
}

impl Scan {
    fn peek(&self) -> Option<char> {
        self.units.get(self.at).copied().map(ascii)
    }

    fn skip_space(&mut self) {
        while matches!(self.peek(), Some(' ' | '\t' | '\n' | '\r')) {
            self.at += 1;
        }
    }

    /// A token where something else was needed: V8's reason when it has one, or the token itself.
    fn unexpected(&self, reason: Option<&'static str>) -> Fault {
        if let Some(reason) = reason {
            return Fault::At(reason, self.at);
        }
        let Some(found) = self.peek() else {
            return Fault::End;
        };
        match found {
            '"' => Fault::String(self.at),
            '-' | '0'..='9' => Fault::Number(self.at),
            _ => Fault::Token(self.at),
        }
    }

    fn string(&mut self) -> Result<(), Fault> {
        self.at += 1;
        loop {
            let Some(unit) = self.units.get(self.at).copied() else {
                return Err(Fault::At("Unterminated string in JSON", self.at));
            };
            if unit == QUOTE {
                self.at += 1;
                return Ok(());
            }
            if unit < 0x20 {
                return Err(Fault::At("Bad control character in string literal in JSON", self.at));
            }
            self.at += 1;
            if unit == u16::from(b'\\') {
                match self.peek() {
                    None => return Err(Fault::At("Unterminated string in JSON", self.at)),
                    Some('"' | '\\' | '/' | 'b' | 'f' | 'n' | 'r' | 't') => self.at += 1,
                    Some('u') => {
                        self.at += 1;
                        for _ in 0..4 {
                            match self.peek() {
                                Some(digit) if digit.is_ascii_hexdigit() => self.at += 1,
                                None => return Err(Fault::At("Unterminated string in JSON", self.at)),
                                _ => return Err(Fault::At("Bad Unicode escape in JSON", self.at)),
                            }
                        }
                    }
                    Some(_) => return Err(Fault::At("Bad escaped character in JSON", self.at)),
                }
            }
        }
    }

    fn digits(&mut self) -> bool {
        let start = self.at;
        while matches!(self.peek(), Some('0'..='9')) {
            self.at += 1;
        }
        self.at > start
    }

    fn number(&mut self) -> Result<(), Fault> {
        if self.peek() == Some('-') {
            self.at += 1;
            if !matches!(self.peek(), Some('0'..='9')) {
                return Err(Fault::At("No number after minus sign in JSON", self.at));
            }
        }
        if self.peek() == Some('0') {
            self.at += 1;
            if matches!(self.peek(), Some('0'..='9')) {
                return Err(Fault::Number(self.at));
            }
        } else {
            self.digits();
        }
        if self.peek() == Some('.') {
            self.at += 1;
            if !self.digits() {
                return Err(Fault::At("Unterminated fractional number in JSON", self.at));
            }
        }
        if matches!(self.peek(), Some('e' | 'E')) {
            self.at += 1;
            if matches!(self.peek(), Some('+' | '-')) {
                self.at += 1;
            }
            if !self.digits() {
                return Err(Fault::At("Exponent part is missing a number in JSON", self.at));
            }
        }
        Ok(())
    }

    fn literal(&mut self, word: &str) -> Result<(), Fault> {
        for expected in word.chars() {
            match self.peek() {
                Some(found) if found == expected => self.at += 1,
                None => return Err(Fault::End),
                Some(_) => return Err(Fault::Token(self.at)),
            }
        }
        Ok(())
    }

    fn property(&mut self) -> Result<(), Fault> {
        self.string()?;
        self.skip_space();
        if self.peek() != Some(':') {
            return Err(self.unexpected(Some("Expected ':' after property name in JSON")));
        }
        self.at += 1;
        self.value()
    }

    fn object(&mut self) -> Result<(), Fault> {
        self.at += 1;
        self.skip_space();
        match self.peek() {
            Some('}') => {
                self.at += 1;
                return Ok(());
            }
            Some('"') => self.property()?,
            _ => return Err(self.unexpected(Some("Expected property name or '}' in JSON"))),
        }
        loop {
            self.skip_space();
            match self.peek() {
                Some('}') => {
                    self.at += 1;
                    return Ok(());
                }
                Some(',') => {
                    self.at += 1;
                    self.skip_space();
                    if self.peek() != Some('"') {
                        return Err(self.unexpected(Some("Expected double-quoted property name in JSON")));
                    }
                    self.property()?;
                }
                _ => return Err(self.unexpected(Some("Expected ',' or '}' after property value in JSON"))),
            }
        }
    }

    fn array(&mut self) -> Result<(), Fault> {
        self.at += 1;
        self.skip_space();
        if self.peek() == Some(']') {
            self.at += 1;
            return Ok(());
        }
        loop {
            self.value()?;
            self.skip_space();
            match self.peek() {
                Some(']') => {
                    self.at += 1;
                    return Ok(());
                }
                Some(',') => self.at += 1,
                _ => return Err(self.unexpected(Some("Expected ',' or ']' after array element in JSON"))),
            }
        }
    }

    fn value(&mut self) -> Result<(), Fault> {
        self.skip_space();
        match self.peek() {
            Some('"') => self.string(),
            Some('{') => self.object(),
            Some('[') => self.array(),
            Some('-' | '0'..='9') => self.number(),
            Some('t') => self.literal("true"),
            Some('f') => self.literal("false"),
            Some('n') => self.literal("null"),
            _ => Err(self.unexpected(None)),
        }
    }
}

/// `at` as V8 writes a position.
fn position(units: &[u16], at: usize) -> String {
    let before = &units[..at.min(units.len())];
    let line = before.iter().filter(|unit| **unit == u16::from(b'\n')).count() + 1;
    let column = at - before.iter().rposition(|unit| *unit == u16::from(b'\n')).map_or(0, |index| index + 1) + 1;
    format!("at position {at} (line {line} column {column})")
}

fn token_message(units: &[u16], at: usize) -> String {
    let token = String::from_utf16_lossy(&units[at..at + 1]);
    let text = |from: usize, to: usize| String::from_utf16_lossy(&units[from..to.min(units.len())]);
    let length = units.len();
    if length <= CONTEXT * 2 {
        return format!("Unexpected token '{token}', \"{}\" is not valid JSON", text(0, length));
    }
    if at < CONTEXT {
        format!("Unexpected token '{token}', \"{}\"... is not valid JSON", text(0, at + CONTEXT))
    } else if at < length - CONTEXT {
        format!("Unexpected token '{token}', ...\"{}\"... is not valid JSON", text(at - CONTEXT, at + CONTEXT))
    } else {
        format!("Unexpected token '{token}', ...\"{}\" is not valid JSON", text(at - CONTEXT, length))
    }
}

/// The message `JSON.parse(text)` throws, for text that doesn't parse.
pub(super) fn json_syntax_error(text: &str) -> String {
    if matches!(text, "undefined" | "NaN" | "Infinity" | "[object Object]") {
        return format!("\"{text}\" is not valid JSON");
    }
    let mut scan = Scan { units: text.encode_utf16().collect(), at: 0 };
    let scanned = scan.value().and_then(|()| {
        scan.skip_space();
        if scan.peek().is_some() {
            return Err(Fault::At("Unexpected non-whitespace character after JSON", scan.at));
        }
        Ok(())
    });
    let units = &scan.units;
    match scanned {
        Err(Fault::Token(at)) => token_message(units, at),
        Err(Fault::Number(at)) => format!("Unexpected number in JSON {}", position(units, at)),
        Err(Fault::String(at)) => format!("Unexpected string in JSON {}", position(units, at)),
        Err(Fault::At(reason, at)) => format!("{reason} {}", position(units, at)),
        // Text that reads fine holds a forbidden key instead (`secureJsonParse`).
        Err(Fault::End) => "Unexpected end of JSON input".to_owned(),
        Ok(()) => "Object contains forbidden prototype property".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Each message as Node gave it (`JSON.parse`), run by hand when this was ported.
    const NODE: &str = include_str!("../tests/fixtures/run_parity/v8_json_errors.json");

    #[test]
    fn says_what_v8_says() {
        let cases: Vec<(String, Option<String>)> = serde_json::from_str(NODE).unwrap();
        assert!(cases.len() > 30);
        for (text, message) in cases {
            if let Some(message) = message {
                assert_eq!(json_syntax_error(&text), message, "for {text:?}");
            }
        }
    }
}
