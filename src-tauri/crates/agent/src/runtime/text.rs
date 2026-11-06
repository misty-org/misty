//! String lengths and slices as JavaScript counts them, in UTF-16 code units. Thresholds and cuts
//! ported from the TypeScript runtime depend on these counts, and a byte slice in Rust can panic in
//! the middle of a character.

/// `text.length`.
pub(crate) fn js_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// The byte offset of a UTF-16 position. A position inside a surrogate pair moves back to the start
/// of that character, so no lone surrogate is ever produced.
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

/// `text.slice(start, end)` for offsets that aren't negative.
pub(crate) fn js_slice(text: &str, start: usize, end: usize) -> &str {
    if start >= end {
        return "";
    }
    &text[byte_offset(text, start)..byte_offset(text, end)]
}

/// `text.slice(0, end)`.
pub(crate) fn js_prefix(text: &str, end: usize) -> &str {
    &text[..byte_offset(text, end)]
}

/// `text.slice(-count)`.
pub(crate) fn js_suffix(text: &str, count: usize) -> &str {
    let length = js_len(text);
    &text[byte_offset(text, length.saturating_sub(count))..]
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
