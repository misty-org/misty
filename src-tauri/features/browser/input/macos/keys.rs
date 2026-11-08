//! Key names the agent sends, as the physical key and the characters a Mac keyboard gives them.

/// One key press: Carbon virtual key code, characters, and the characters without modifiers.
pub(super) struct KeySpec {
    pub code: u16,
    pub characters: String,
    pub unmodified: String,
    /// Whether Shift is implied (an upper-case letter or shifted symbol).
    pub shift: bool,
}

/// US ANSI key codes by position: the code of a key is its index in this string.
const ANSI_KEYS: &str = "asdfhgzxcv§bqweryt123465=97-80]ou[ip\rlj'k;\\,/nm.\t `";

const SHIFTED: [(&str, &str); 21] = [
    ("!", "1"),
    ("@", "2"),
    ("#", "3"),
    ("$", "4"),
    ("%", "5"),
    ("^", "6"),
    ("&", "7"),
    ("*", "8"),
    ("(", "9"),
    (")", "0"),
    ("_", "-"),
    ("+", "="),
    ("{", "["),
    ("}", "]"),
    ("|", "\\"),
    ("\"", "'"),
    (":", ";"),
    ("<", ","),
    (">", "."),
    ("?", "/"),
    ("~", "`"),
];

fn special(key: &str) -> Option<(u16, &'static str)> {
    // kVK_Return, kVK_Escape, kVK_Tab, kVK_Delete, kVK_ForwardDelete, the arrows, Home, End,
    // PageUp, PageDown, kVK_Space.
    Some(match key {
        "Enter" => (0x24, "\r"),
        "Escape" => (0x35, "\u{1b}"),
        "Tab" => (0x30, "\t"),
        "Backspace" => (0x33, "\u{7f}"),
        "Delete" => (0x75, "\u{F728}"),
        "ArrowLeft" => (0x7B, "\u{F702}"),
        "ArrowRight" => (0x7C, "\u{F703}"),
        "ArrowUp" => (0x7E, "\u{F700}"),
        "ArrowDown" => (0x7D, "\u{F701}"),
        "Home" => (0x73, "\u{F729}"),
        "End" => (0x77, "\u{F72B}"),
        "PageUp" => (0x74, "\u{F72C}"),
        "PageDown" => (0x79, "\u{F72D}"),
        "Space" => (0x31, " "),
        _ => return None,
    })
}

/// The key for `name`, or none when the keyboard has no such key.
pub(super) fn key_spec(name: &str) -> Option<KeySpec> {
    if let Some((code, characters)) = special(name) {
        return Some(KeySpec {
            code,
            characters: characters.to_owned(),
            unmodified: characters.to_lowercase(),
            shift: false,
        });
    }
    let mut base = name.to_lowercase();
    if let Some((_, plain)) = SHIFTED.iter().find(|(shifted, _)| *shifted == name) {
        base = (*plain).to_owned();
    }
    // Positions count UTF-16 units, as the key codes do.
    let keys: Vec<u16> = ANSI_KEYS.encode_utf16().collect();
    let wanted: Vec<u16> = base.encode_utf16().collect();
    let position = keys
        .windows(wanted.len().max(1))
        .position(|part| part == wanted);
    if name.encode_utf16().count() == 1 && !wanted.is_empty() {
        let code = position? as u16;
        return Some(KeySpec {
            code,
            characters: name.to_owned(),
            shift: base != name,
            unmodified: base,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::key_spec;

    #[test]
    fn letters_symbols_and_named_keys_map_to_ansi_codes() {
        assert_eq!(key_spec("r").unwrap().code, 15);
        let capital = key_spec("A").unwrap();
        assert_eq!(
            (capital.code, capital.shift, capital.unmodified.as_str()),
            (0, true, "a")
        );
        let bang = key_spec("!").unwrap();
        assert_eq!((bang.code, bang.shift), (18, true));
        assert_eq!(key_spec("Enter").unwrap().code, 0x24);
        assert!(key_spec("F13").is_none());
        assert!(key_spec("é").is_none());
    }
}
