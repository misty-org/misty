//! Text as the Go server wrote it. The prompt is tuned against benchmarks, so the JSON and quoted
//! strings inside it keep Go's exact form: sorted map keys and escaped `<`, `>` and `&`.
use serde_json::Value;

use crate::js_json::JsValue;

/// `truncateAgentRuntimeText`: at most `limit` characters, the last one an ellipsis when it cut.
pub(super) fn truncate_text(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_owned();
    }
    let kept: String = value.chars().take(limit.saturating_sub(1)).collect();
    format!("{}…", kept.trim())
}

/// `strings.Join(strings.Fields(value), " ")`.
pub(super) fn single_spaced(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A string as `json.Marshal` writes it.
pub(super) fn go_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '<' | '>' | '&' | '\u{2028}' | '\u{2029}' => out.push_str(&format!("\\u{:04x}", u32::from(character))),
            control if u32::from(control) < 0x20 => out.push_str(&format!("\\u{:04x}", u32::from(control))),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

/// A decoded JSON value as `json.Marshal` writes a Go `any`: numbers are doubles and keys are sorted.
pub(super) fn go_value(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(flag) => flag.to_string(),
        // Go's float format is the one JavaScript uses, so the crate's own writer matches.
        Value::Number(number) => JsValue::Number(number.as_f64().unwrap_or(0.0)).stringify(),
        Value::String(text) => go_string(text),
        Value::Array(items) => format!("[{}]", items.iter().map(go_value).collect::<Vec<_>>().join(",")),
        Value::Object(fields) => {
            let mut keys: Vec<&String> = fields.keys().collect();
            keys.sort();
            let parts: Vec<String> = keys.iter().map(|key| format!("{}:{}", go_string(key), go_value(&fields[*key]))).collect();
            format!("{{{}}}", parts.join(","))
        }
    }
}

/// A struct as `json.Marshal` writes it, its fields in the order given.
pub(super) fn go_object(fields: &[(&str, String)]) -> String {
    let parts: Vec<String> = fields.iter().map(|(name, value)| format!("{}:{value}", go_string(name))).collect();
    format!("{{{}}}", parts.join(","))
}

pub(super) fn go_array<T>(items: &[T], write: impl Fn(&T) -> String) -> String {
    format!("[{}]", items.iter().map(write).collect::<Vec<_>>().join(","))
}

/// `strconv.Quote`, which `%q` uses.
pub(super) fn go_quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{7}' => out.push_str("\\a"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{b}' => out.push_str("\\v"),
            printable if go_prints(printable) => out.push(printable),
            low if u32::from(low) < 0x20 || u32::from(low) == 0x7f => out.push_str(&format!("\\x{:02x}", u32::from(low))),
            wide if u32::from(wide) >= 0x10000 => out.push_str(&format!("\\U{:08x}", u32::from(wide))),
            other => out.push_str(&format!("\\u{:04x}", u32::from(other))),
        }
    }
    out.push('"');
    out
}

/// `unicode.IsPrint`, as near as the standard library allows: it refuses controls, spaces other than
/// ' ', format characters, private use and noncharacters. Characters Unicode hasn't assigned print
/// here and not in Go, which only reaches a title or caption holding one.
fn go_prints(character: char) -> bool {
    let code = u32::from(character);
    if character == ' ' {
        return true;
    }
    if character.is_control() || character.is_whitespace() {
        return false;
    }
    !matches!(
        code,
        0xAD | 0x600..=0x605 | 0x61C | 0x6DD | 0x70F | 0x8E2 | 0x180E | 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x206F
            | 0xD800..=0xF8FF | 0xFDD0..=0xFDEF | 0xFEFF | 0xFFF9..=0xFFFB | 0xFFFE | 0xFFFF
            | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0000..=0xE0FFF | 0xF0000..=0x10FFFF
    )
}
