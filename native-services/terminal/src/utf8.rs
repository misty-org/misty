/// Preserve split UTF-8 codepoints without recursively walking malformed output.
pub fn extract_valid_utf8(mut bytes: &[u8], carry: &mut Vec<u8>) -> String {
    let mut output = String::with_capacity(bytes.len());
    while !bytes.is_empty() {
        match std::str::from_utf8(bytes) {
            Ok(text) => {
                output.push_str(text);
                break;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                // The UTF-8 validator establishes this prefix's validity.
                output.push_str(unsafe { std::str::from_utf8_unchecked(&bytes[..valid]) });
                if let Some(length) = error.error_len() {
                    output.push('\u{fffd}');
                    bytes = &bytes[valid + length..];
                } else {
                    carry.extend_from_slice(&bytes[valid..]);
                    break;
                }
            }
        }
    }
    output
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handles_split_characters_and_long_malformed_output() {
        let mut carry = Vec::new();
        assert_eq!(extract_valid_utf8(&[b'h', 0xc3], &mut carry), "h");
        assert_eq!(carry, [0xc3]);
        carry.push(0xb1);
        assert_eq!(
            extract_valid_utf8(&std::mem::take(&mut carry), &mut carry),
            "ñ"
        );
        let text = extract_valid_utf8(&[255; 32768], &mut carry);
        assert_eq!(text.chars().count(), 32768);
        assert!(carry.is_empty());
    }
}
