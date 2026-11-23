use serde_json::Value;

use super::super::{js_json::JsValue, text::js_len};
use super::failure::CallError;

pub(super) fn checked<T>(read: impl FnOnce() -> Option<T>) -> Result<T, CallError> {
    read().ok_or_else(CallError::invalid)
}

pub(super) fn object(value: &JsValue) -> Option<&JsValue> {
    value.is_object().then_some(value)
}

pub(super) fn string(value: Option<&JsValue>, max: usize) -> Option<&str> {
    value?.as_str().filter(|text| js_len(text) <= max)
}

pub(super) fn array(value: Option<&JsValue>, min: usize, max: usize) -> Option<&[JsValue]> {
    value?
        .as_array()
        .filter(|items| items.len() >= min && items.len() <= max)
}

pub(super) fn number(value: Option<&JsValue>) -> Option<f64> {
    match value? {
        JsValue::Number(number) if number.is_finite() => Some(*number),
        _ => None,
    }
}

const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

pub(super) fn integer(value: Option<&JsValue>, min: f64, max: f64) -> Option<f64> {
    number(value).filter(|number| {
        number.fract() == 0.0 && number.abs() <= MAX_SAFE && *number >= min && *number <= max
    })
}

pub(super) fn optional<'a, T>(
    value: Option<&'a JsValue>,
    read: impl FnOnce(Option<&'a JsValue>) -> Option<T>,
) -> Option<Option<T>> {
    match value {
        None => Some(None),
        Some(_) => read(value).map(Some),
    }
}

pub(super) fn is_base64_text(text: &str) -> bool {
    let data = text.trim_end_matches('=');
    text.len() - data.len() <= 2
        && data
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/')
}

pub(crate) fn node_base64(text: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(text.len() / 4 * 3 + 3);
    let (mut bits, mut held) = (0u32, 0u32);
    for byte in text.bytes() {
        let sextet = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            _ => continue,
        };
        bits = (bits << 6 | u32::from(sextet)) & 0xFFFF;
        held += 6;
        if held >= 8 {
            held -= 8;
            bytes.push((bits >> held) as u8);
        }
    }
    bytes
}

pub(crate) fn number_value(number: f64) -> Value {
    if number.fract() == 0.0 && number.abs() <= MAX_SAFE {
        return Value::from(number as i64);
    }
    serde_json::Number::from_f64(number).map_or(Value::Null, Value::Number)
}

pub(super) fn picked(fields: Vec<(&str, Option<JsValue>)>) -> JsValue {
    JsValue::Object(
        fields
            .into_iter()
            .filter_map(|(key, value)| Some((key.to_owned(), value?)))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    #[test]
    fn base64_reads_as_node_reads_it() {
        for (text, expected) in [
            ("YQ==", "61"),
            ("YQ", "61"),
            ("YQ==YQ==", "61"),
            ("Y Q = =", "61"),
            ("Y-_w", "63eff0"),
            ("Y", ""),
            ("YWI", "6162"),
            ("a!b@c#d", "69b71d"),
            ("", ""),
            ("====", ""),
            ("YWJj=ZGVm", "616263"),
            ("YQ=Z", "61"),
        ] {
            assert_eq!(hex(&node_base64(text)), expected, "{text}");
        }
    }

    #[test]
    fn base64_text_is_only_the_alphabet_and_padding() {
        assert!(is_base64_text(""));
        assert!(is_base64_text("YQ=="));
        assert!(!is_base64_text("YQ==="));
        assert!(!is_base64_text("YQ==\n"));
        assert!(!is_base64_text("Y-_w"));
    }

    #[test]
    fn numbers_follow_zod() {
        let parse = |text: &str| JsValue::parse(text).unwrap();
        assert_eq!(integer(Some(&parse("3.0")), 0.0, 9.0), Some(3.0));
        assert_eq!(integer(Some(&parse("3.5")), 0.0, 9.0), None);
        assert_eq!(integer(Some(&parse("9007199254740992")), 0.0, 1e300), None);
        assert_eq!(number(Some(&parse("1e999"))), None);
        assert_eq!(number(Some(&parse("\"1\""))), None);
        assert_eq!(number_value(12.0), Value::from(12));
        assert_eq!(number_value(12.5), Value::from(12.5));
    }

    #[test]
    fn optional_refuses_null() {
        let null = JsValue::Null;
        assert_eq!(optional(None, |value| string(value, 2)), Some(None));
        assert_eq!(optional(Some(&null), |value| string(value, 2)), None);
    }
}
