//! JSON as JavaScript reads and writes it: `JSON.parse`, `JSON.stringify`, and the conversions the
//! TypeScript runtime leans on. Key order is kept, and numbers are doubles, so text built from a
//! value (a loop's key, a digest, a byte count against a threshold) matches what Node produced.
mod parse;

use crate::sdk::RawJson;

use super::text::{js_len, js_trim};

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum JsValue {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsValue>),
    Object(Vec<(String, JsValue)>),
}

impl JsValue {
    /// `JSON.parse(text)`, or `None` where it would throw.
    pub(crate) fn parse(text: &str) -> Option<Self> {
        parse::parse(text)
    }

    pub(crate) fn from_raw(raw: &RawJson) -> Option<Self> {
        Self::parse(raw.get())
    }

    pub(crate) fn get(&self, key: &str) -> Option<&JsValue> {
        match self {
            Self::Object(fields) => fields.iter().find(|(name, _)| name == key).map(|(_, value)| value),
            _ => None,
        }
    }

    pub(crate) fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(text) => Some(text),
            _ => None,
        }
    }

    pub(crate) fn as_array(&self) -> Option<&[JsValue]> {
        match self {
            Self::Array(items) => Some(items),
            _ => None,
        }
    }

    pub(crate) fn is_object(&self) -> bool {
        matches!(self, Self::Object(_))
    }

    /// `{ ...value, [key]: next }`: an existing key keeps its place, a new one goes last.
    pub(crate) fn with_field(&self, key: &str, next: JsValue) -> JsValue {
        let Self::Object(fields) = self else {
            return self.clone();
        };
        let mut fields = fields.clone();
        match fields.iter_mut().find(|(name, _)| name == key) {
            Some((_, slot)) => *slot = next,
            None => fields.push((key.to_owned(), next)),
        }
        Self::Object(fields)
    }

    /// `JSON.stringify(value)`.
    pub(crate) fn stringify(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut String) {
        match self {
            Self::Null => out.push_str("null"),
            Self::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
            Self::Number(value) if value.is_finite() => out.push_str(&number_text(*value)),
            Self::Number(_) => out.push_str("null"),
            Self::String(text) => push_quoted(out, text),
            Self::Array(items) => {
                out.push('[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    item.write(out);
                }
                out.push(']');
            }
            Self::Object(fields) => {
                out.push('{');
                for (index, (key, value)) in fields.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    push_quoted(out, key);
                    out.push(':');
                    value.write(out);
                }
                out.push('}');
            }
        }
    }

    /// `String(value)`.
    pub(crate) fn to_js_string(&self) -> String {
        match self {
            Self::Null => "null".to_owned(),
            Self::Bool(value) => value.to_string(),
            Self::Number(value) => number_text(*value),
            Self::String(text) => text.clone(),
            Self::Array(items) => items
                .iter()
                .map(|item| if matches!(item, Self::Null) { String::new() } else { item.to_js_string() })
                .collect::<Vec<_>>()
                .join(","),
            Self::Object(_) => "[object Object]".to_owned(),
        }
    }

    /// `Number(value)`.
    pub(crate) fn to_js_number(&self) -> f64 {
        match self {
            Self::Null => 0.0,
            Self::Bool(value) => f64::from(u8::from(*value)),
            Self::Number(value) => *value,
            Self::String(text) => string_number(text),
            Self::Array(_) => string_number(&self.to_js_string()),
            Self::Object(_) => f64::NAN,
        }
    }
}

/// `value ?? ""` then `String(...)`, for fields the runtime reads as text.
pub(crate) fn text_or_empty(value: Option<&JsValue>) -> String {
    match value {
        None | Some(JsValue::Null) => String::new(),
        Some(value) => value.to_js_string(),
    }
}

/// `Number(text)`.
fn string_number(text: &str) -> f64 {
    let text = js_trim(text);
    if text.is_empty() {
        return 0.0;
    }
    match text {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(digits) = text.strip_prefix(prefix) {
            return u64::from_str_radix(digits, radix).map_or(f64::NAN, |value| value as f64);
        }
    }
    // Rust also reads "inf" and "nan", which JavaScript doesn't.
    if !text.chars().all(|character| matches!(character, '0'..='9' | '+' | '-' | '.' | 'e' | 'E')) {
        return f64::NAN;
    }
    text.parse().unwrap_or(f64::NAN)
}

/// A zod string: `z.string().trim().min(min).max(max)`, lengths counted after the trim.
pub(crate) fn zod_string(value: &JsValue, min: usize, max: usize) -> Option<String> {
    let text = js_trim(value.as_str()?);
    let length = js_len(text);
    (length >= min && length <= max).then(|| text.to_owned())
}

/// A zod string that may be left out: `None` is an invalid value, `Some(None)` a missing one.
pub(crate) fn zod_optional_string(value: Option<&JsValue>, min: usize, max: usize) -> Option<Option<String>> {
    match value {
        None => Some(None),
        Some(value) => zod_string(value, min, max).map(Some),
    }
}

fn push_quoted(out: &mut String, text: &str) {
    // serde_json and JSON.stringify escape the same characters, and writing a string can't fail.
    out.push_str(&serde_json::to_string(text).unwrap_or_default());
}

/// `String(number)`, following the steps of ECMAScript's Number::toString.
pub(crate) fn number_text(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    if value == 0.0 {
        return "0".to_owned();
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let point = exponent.parse::<i32>().unwrap_or(0) + 1;
    let count = digits.len() as i32;
    let body = if count <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - count) as usize))
    } else if 0 < point && point <= 21 {
        format!("{}.{}", &digits[..point as usize], &digits[point as usize..])
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat(-point as usize))
    } else {
        let power = point - 1;
        let power_sign = if power < 0 { '-' } else { '+' };
        let (first, rest) = digits.split_at(1);
        let fraction = if rest.is_empty() { String::new() } else { format!(".{rest}") };
        format!("{first}{fraction}e{power_sign}{}", power.abs())
    };
    format!("{sign}{body}")
}

/// A JavaScript object's own keys come in this order: array indexes ascending, then the rest as
/// they arrived. A repeated key keeps its first place and its last value.
fn into_object(entries: Vec<(String, JsValue)>) -> JsValue {
    let mut fields: Vec<(String, JsValue)> = Vec::with_capacity(entries.len());
    for (key, value) in entries {
        match fields.iter_mut().find(|(name, _)| *name == key) {
            Some((_, slot)) => *slot = value,
            None => fields.push((key, value)),
        }
    }
    if fields.iter().any(|(key, _)| array_index(key).is_some()) {
        fields.sort_by_key(|(key, _)| array_index(key).unwrap_or(u64::MAX));
    }
    JsValue::Object(fields)
}

fn array_index(key: &str) -> Option<u64> {
    if key.is_empty() || (key.len() > 1 && key.starts_with('0')) || !key.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    key.parse::<u64>().ok().filter(|index| *index < u64::from(u32::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stringify_matches_json_stringify() {
        let parse = |text: &str| JsValue::parse(text).unwrap().stringify();
        assert_eq!(parse(r#"{ "z" : 1, "a" : [ true , null ] }"#), r#"{"z":1,"a":[true,null]}"#);
        assert_eq!(parse(r#"{"b":1,"2":1,"10":1,"a":1}"#), r#"{"2":1,"10":1,"b":1,"a":1}"#);
        assert_eq!(parse(r#"{"a":1,"b":2,"a":3}"#), r#"{"a":3,"b":2}"#);
        assert_eq!(parse(r#""\u00e9\u0001\n""#), "\"é\\u0001\\n\"");
        assert_eq!(parse("[1.0,1.5,-0,1e21,1e-7,123456789012345680000,0.000001]"), "[1,1.5,0,1e+21,1e-7,123456789012345680000,0.000001]");
        assert!(JsValue::parse("{nope").is_none());
    }

    #[test]
    fn numbers_read_as_in_javascript() {
        assert_eq!(number_text(1.5e300), "1.5e+300");
        assert_eq!(number_text(-2.0), "-2");
        assert_eq!(JsValue::parse("\"5\"").unwrap().to_js_number(), 5.0);
        assert_eq!(JsValue::parse("true").unwrap().to_js_number(), 1.0);
        assert_eq!(JsValue::parse("null").unwrap().to_js_number(), 0.0);
        assert_eq!(JsValue::parse("[7]").unwrap().to_js_number(), 7.0);
        assert!(JsValue::parse("[1,2]").unwrap().to_js_number().is_nan());
        assert!(JsValue::parse("{}").unwrap().to_js_number().is_nan());
        assert!(JsValue::parse("\"inf\"").unwrap().to_js_number().is_nan());
        assert_eq!(JsValue::parse("\"0x10\"").unwrap().to_js_number(), 16.0);
    }

    #[test]
    fn strings_read_as_in_javascript() {
        assert_eq!(JsValue::parse("[1,null,\"a\"]").unwrap().to_js_string(), "1,,a");
        assert_eq!(JsValue::parse("{}").unwrap().to_js_string(), "[object Object]");
        assert_eq!(text_or_empty(None), "");
        assert_eq!(text_or_empty(Some(&JsValue::Null)), "");
        assert_eq!(text_or_empty(JsValue::parse("{\"a\":2}").unwrap().get("a")), "2");
    }

    #[test]
    fn a_new_field_goes_last_and_an_old_one_stays_put() {
        let value = JsValue::parse(r#"{"z":1,"a":2}"#).unwrap();
        assert_eq!(value.with_field("z", JsValue::Null).stringify(), r#"{"z":null,"a":2}"#);
        assert_eq!(value.with_field("b", JsValue::Null).stringify(), r#"{"z":1,"a":2,"b":null}"#);
    }

    #[test]
    fn zod_strings_trim_before_counting() {
        let padded = JsValue::String("  ab ".to_owned());
        assert_eq!(zod_string(&padded, 1, 2).as_deref(), Some("ab"));
        assert_eq!(zod_string(&padded, 3, 9), None);
        assert_eq!(zod_string(&JsValue::Null, 0, 9), None);
        assert_eq!(zod_optional_string(None, 1, 2), Some(None));
        assert_eq!(zod_optional_string(Some(&JsValue::Null), 1, 2), None);
    }
}
