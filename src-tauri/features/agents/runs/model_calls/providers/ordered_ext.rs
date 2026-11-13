//! More ways to work with [`Ordered`], for clients that rewrite a whole schema or request body.
use serde_json::Value;

use super::ordered::Ordered;
use crate::model_calls::raw_json::RawJson;

pub(crate) trait OrderedExt: Sized {
    fn empty_object() -> Self;
    fn text(value: impl Into<String>) -> Self;
    fn from_raw(raw: &RawJson) -> Self;
    /// `object[key] = value`: an existing key keeps its place.
    fn put(&mut self, key: &str, value: Self);
    fn take(&mut self, key: &str) -> Option<Self>;
    fn as_array(&self) -> Option<&[Self]>;
    /// JavaScript's truthiness, which the SDK's checks lean on.
    fn is_truthy(&self) -> bool;
    fn to_value(&self) -> Value;
}

impl OrderedExt for Ordered {
    fn empty_object() -> Self {
        Self::Object(Vec::new())
    }

    fn text(value: impl Into<String>) -> Self {
        Self::String(value.into())
    }

    fn from_raw(raw: &RawJson) -> Self {
        // Raw JSON was valid when it was made, so reading it again can't fail.
        Self::from_text(raw.get()).unwrap_or(Self::Null)
    }

    fn put(&mut self, key: &str, value: Self) {
        if let Self::Object(fields) = self {
            Self::set(fields, key, value);
        }
    }

    fn take(&mut self, key: &str) -> Option<Self> {
        let Self::Object(fields) = self else {
            return None;
        };
        let at = fields.iter().position(|(name, _)| name == key)?;
        Some(fields.remove(at).1)
    }

    fn as_array(&self) -> Option<&[Self]> {
        match self {
            Self::Array(items) => Some(items),
            _ => None,
        }
    }

    fn is_truthy(&self) -> bool {
        match self {
            Self::Null => false,
            Self::Bool(value) => *value,
            Self::Number(number) => number.as_f64().is_some_and(|value| value != 0.0 && !value.is_nan()),
            Self::String(text) => !text.is_empty(),
            Self::Array(_) | Self::Object(_) => true,
        }
    }

    fn to_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_keep_their_order_through_editing() {
        let mut tree = Ordered::from_text(r#"{"z":1,"a":{"y":2.0,"b":[true,null]},"m":"é\n"}"#).unwrap();
        assert_eq!(tree.to_text(), r#"{"z":1,"a":{"y":2,"b":[true,null]},"m":"é\n"}"#);
        tree.put("z", Ordered::text("kept in place"));
        tree.put("new", Ordered::Null);
        tree.take("m");
        assert_eq!(tree.to_text(), r#"{"z":"kept in place","a":{"y":2,"b":[true,null]},"new":null}"#);
    }

    #[test]
    fn truthiness_matches_javascript() {
        for (text, truthy) in [("0", false), ("\"\"", false), ("null", false), ("false", false), ("1", true), ("[]", true), ("{}", true), ("\"a\"", true)] {
            assert_eq!(Ordered::from_text(text).unwrap().is_truthy(), truthy, "{text}");
        }
    }
}
