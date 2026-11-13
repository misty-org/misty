// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Key names and chords for the keyboard action: "cmd+shift+t" into held modifiers and a key.

use enigo::Key;

fn named_key(name: &str) -> Option<Key> {
    let key = match name {
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "esc" | "escape" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "space" => Key::Space,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "capslock" => Key::CapsLock,
        "cmd" | "command" | "meta" | "super" | "win" => Key::Meta,
        "ctrl" | "control" => Key::Control,
        "alt" | "option" => Key::Alt,
        "shift" => Key::Shift,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        single => {
            let mut chars = single.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Key::Unicode(c),
                _ => return None,
            }
        }
    };
    Some(key)
}

/// Parse "cmd+shift+t" into held modifiers + the final key. A lone modifier
/// name ("alt") is itself a pressable key.
pub(crate) fn parse_key_chord(chord: &str) -> Result<(Vec<Key>, Key), String> {
    let parts: Vec<&str> = chord
        .split('+')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();
    let (last, head) = parts
        .split_last()
        .ok_or_else(|| "empty key chord".to_string())?;
    let mut modifiers = Vec::new();
    for part in head {
        match part.to_ascii_lowercase().as_str() {
            "cmd" | "command" | "meta" | "super" | "win" => modifiers.push(Key::Meta),
            "ctrl" | "control" => modifiers.push(Key::Control),
            "alt" | "option" => modifiers.push(Key::Alt),
            "shift" => modifiers.push(Key::Shift),
            other => {
                return Err(format!(
                    "'{other}' is not a modifier; only cmd/ctrl/alt/shift may precede the final key"
                ))
            }
        }
    }
    let key =
        named_key(&last.to_ascii_lowercase()).ok_or_else(|| format!("unknown key '{last}'"))?;
    Ok((modifiers, key))
}
