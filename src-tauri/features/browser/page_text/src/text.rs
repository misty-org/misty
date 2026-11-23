pub fn js_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn byte_offset(text: &str, position: usize) -> usize {
    let mut units = 0;
    for (offset, character) in text.char_indices() {
        let width = character.len_utf16();
        if units + width > position {
            return offset;
        }
        units += width;
    }
    text.len()
}

pub fn js_slice(text: &str, start: usize, end: usize) -> &str {
    if start >= end {
        return "";
    }
    &text[byte_offset(text, start)..byte_offset(text, end)]
}

pub fn js_prefix(text: &str, end: usize) -> &str {
    &text[..byte_offset(text, end)]
}

pub fn js_suffix(text: &str, count: usize) -> &str {
    let length = js_len(text);
    &text[byte_offset(text, length.saturating_sub(count))..]
}

pub fn js_is_space(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\u{B}' | '\u{C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

pub fn js_trim(text: &str) -> &str {
    text.trim_matches(js_is_space)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lengths_count_utf16_units() {
        assert_eq!(js_len("abc"), 3);
        assert_eq!(js_len("é"), 1);
        assert_eq!(js_len("😀"), 2);
    }

    #[test]
    fn trimming_uses_javascripts_spaces() {
        assert_eq!(js_trim("\u{FEFF} a\u{A0}\n"), "a");
        assert_eq!(js_trim("\u{85}a"), "\u{85}a");
    }

    #[test]
    fn slices_never_split_a_character() {
        assert_eq!(js_prefix("a😀b", 2), "a");
        assert_eq!(js_prefix("a😀b", 3), "a😀");
        assert_eq!(js_prefix("éa", 1), "é");
        assert_eq!(js_prefix("abc", 99), "abc");
        assert_eq!(js_slice("hello", 1, 3), "el");
        assert_eq!(js_slice("hello", 3, 1), "");
        assert_eq!(js_suffix("hello", 2), "lo");
        assert_eq!(js_suffix("hi", 9), "hi");
    }
}
