//! CDP's descriptions of mouse events, modifiers and keys.
use super::*;

pub(super) fn mouse(kind: &str, x: f64, y: f64, button: &str, buttons: u8, clicks: u64) -> Value {
    json!({
        "type": kind,
        "x": x,
        "y": y,
        "button": button,
        "buttons": buttons,
        "clickCount": clicks,
    })
}

/// CDP's modifier bits: Alt 1, Control 2, Meta 4, Shift 8.
pub(super) fn modifier_bits(modifiers: &Value) -> u8 {
    modifiers.as_array().map_or(0, |list| {
        list.iter().fold(0, |bits, value| {
            bits | match value.as_str() {
                Some("Alt") => 1,
                Some("Control") => 2,
                Some("Meta") => 4,
                Some("Shift") => 8,
                _ => 0,
            }
        })
    })
}

/// A key as CDP describes it: its `key`, physical `code`, Windows virtual-key
/// code, the text it types, and whether it needs Shift on a US layout.
pub(super) struct Key {
    pub(super) key: String,
    pub(super) code: String,
    pub(super) virtual_key: u32,
    pub(super) text: Option<String>,
}

pub(super) fn key(name: &str) -> Option<Key> {
    let special = |key: &str, code: &str, virtual_key: u32, text: Option<&str>| Key {
        key: key.into(),
        code: code.into(),
        virtual_key,
        text: text.map(str::to_owned),
    };
    Some(match name {
        "Enter" => special("Enter", "Enter", 13, Some("\r")),
        "Escape" => special("Escape", "Escape", 27, None),
        "Tab" => special("Tab", "Tab", 9, None),
        "Backspace" => special("Backspace", "Backspace", 8, None),
        "Delete" => special("Delete", "Delete", 46, None),
        "ArrowLeft" => special("ArrowLeft", "ArrowLeft", 37, None),
        "ArrowUp" => special("ArrowUp", "ArrowUp", 38, None),
        "ArrowRight" => special("ArrowRight", "ArrowRight", 39, None),
        "ArrowDown" => special("ArrowDown", "ArrowDown", 40, None),
        "Home" => special("Home", "Home", 36, None),
        "End" => special("End", "End", 35, None),
        "PageUp" => special("PageUp", "PageUp", 33, None),
        "PageDown" => special("PageDown", "PageDown", 34, None),
        "Space" => special(" ", "Space", 32, Some(" ")),
        _ => return printable(name),
    })
}

/// A single printable ASCII character on a US layout.
pub(super) fn printable(name: &str) -> Option<Key> {
    let &[byte] = name.as_bytes() else {
        return None;
    };
    let character = byte as char;
    // Shifted punctuation types through its unshifted key.
    const SHIFTED: &str = r#"!@#$%^&*()_+{}|:"<>?~"#;
    const BASE: &str = r#"1234567890-=[]\;',./`"#;
    let base = SHIFTED
        .find(character)
        .and_then(|index| BASE.chars().nth(index))
        .unwrap_or(character.to_ascii_lowercase());
    let (code, virtual_key) = match base {
        'a'..='z' => (
            format!("Key{}", base.to_ascii_uppercase()),
            base.to_ascii_uppercase() as u32,
        ),
        '0'..='9' => (format!("Digit{base}"), base as u32),
        ';' => ("Semicolon".into(), 186),
        '=' => ("Equal".into(), 187),
        ',' => ("Comma".into(), 188),
        '-' => ("Minus".into(), 189),
        '.' => ("Period".into(), 190),
        '/' => ("Slash".into(), 191),
        '`' => ("Backquote".into(), 192),
        '[' => ("BracketLeft".into(), 219),
        '\\' => ("Backslash".into(), 220),
        ']' => ("BracketRight".into(), 221),
        '\'' => ("Quote".into(), 222),
        _ => return None,
    };
    Some(Key {
        key: name.to_owned(),
        code,
        virtual_key,
        text: Some(name.to_owned()),
    })
}

/// The editing command a select-all or undo shortcut runs in an editable
/// field, so it acts on the page's own editor, as WebKit's does.
pub(super) fn editing_command(name: &str, bits: u8) -> Option<&'static str> {
    match name.to_ascii_lowercase().as_str() {
        "a" => Some("selectAll"),
        "z" if bits & 8 != 0 => Some("redo"),
        "z" => Some("undo"),
        _ => None,
    }
}
