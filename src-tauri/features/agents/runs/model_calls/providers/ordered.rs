//! JSON with its keys in their written order, for the places a client has to look inside a tool
//! schema or call input and write it back. `serde_json::Value` would sort the keys (`raw_json.rs`).
use std::fmt;

use serde::{
    de::{Deserialize, Deserializer, MapAccess, SeqAccess, Visitor},
    ser::{Serialize, SerializeMap, SerializeSeq, Serializer},
};
use serde_json::Number;

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Ordered {
    Null,
    Bool(bool),
    Number(Number),
    String(String),
    Array(Vec<Ordered>),
    Object(Vec<(String, Ordered)>),
}

impl Ordered {
    pub(crate) fn from_text(text: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(text)
    }

    /// The same text `JSON.stringify` writes.
    pub(crate) fn to_text(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    pub(crate) fn get(&self, key: &str) -> Option<&Ordered> {
        match self {
            Self::Object(fields) => fields.iter().find(|(name, _)| name == key).map(|(_, value)| value),
            _ => None,
        }
    }

    /// The value of a key, unless it is missing or null, which is how the SDK's `!= null` reads.
    pub(crate) fn present(&self, key: &str) -> Option<&Ordered> {
        self.get(key).filter(|value| !matches!(value, Self::Null))
    }

    pub(crate) fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(text) => Some(text),
            _ => None,
        }
    }

    /// Adds a key, or replaces it in place, as assigning to a JavaScript object does.
    pub(crate) fn set(fields: &mut Vec<(String, Ordered)>, key: &str, value: Ordered) {
        match fields.iter_mut().find(|(name, _)| name == key) {
            Some((_, slot)) => *slot = value,
            None => fields.push((key.to_owned(), value)),
        }
    }
}

impl Serialize for Ordered {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Null => serializer.serialize_unit(),
            Self::Bool(value) => serializer.serialize_bool(*value),
            Self::Number(value) => match value.as_f64().filter(|_| value.is_f64()) {
                // JavaScript has one number type, so `1.0` comes back out as `1`.
                Some(float) if float.fract() == 0.0 && float.abs() < 9_007_199_254_740_992.0 => {
                    serializer.serialize_i64(float as i64)
                }
                _ => value.serialize(serializer),
            },
            Self::String(value) => serializer.serialize_str(value),
            Self::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(item)?;
                }
                seq.end()
            }
            Self::Object(fields) => {
                let mut map = serializer.serialize_map(Some(fields.len()))?;
                for (name, value) in fields {
                    map.serialize_entry(name, value)?;
                }
                map.end()
            }
        }
    }
}

struct OrderedVisitor;

impl<'de> Visitor<'de> for OrderedVisitor {
    type Value = Ordered;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("any JSON value")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Ordered, E> {
        Ok(Ordered::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Ordered, E> {
        Ok(Ordered::Number(value.into()))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Ordered, E> {
        Ok(Ordered::Number(value.into()))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Ordered, E> {
        Ok(Number::from_f64(value).map_or(Ordered::Null, Ordered::Number))
    }

    fn visit_str<E>(self, value: &str) -> Result<Ordered, E> {
        Ok(Ordered::String(value.to_owned()))
    }

    fn visit_unit<E>(self) -> Result<Ordered, E> {
        Ok(Ordered::Null)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Ordered, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element()? {
            items.push(item);
        }
        Ok(Ordered::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Ordered, A::Error> {
        let mut fields = Vec::new();
        while let Some((name, value)) = map.next_entry::<String, Ordered>()? {
            Ordered::set(&mut fields, &name, value);
        }
        Ok(Ordered::Object(fields))
    }
}

impl<'de> Deserialize<'de> for Ordered {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(OrderedVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_stay_in_order_and_numbers_read_as_javascript_writes_them() {
        let ordered = Ordered::from_text(r#"{"z":1.0,"a":[{"y":1.5,"b":null}],"m":"é\n"}"#).unwrap();
        assert_eq!(ordered.to_text(), r#"{"z":1,"a":[{"y":1.5,"b":null}],"m":"é\n"}"#);
    }

    #[test]
    fn a_repeated_key_keeps_its_place_and_the_last_value() {
        let ordered = Ordered::from_text(r#"{"a":1,"b":2,"a":3}"#).unwrap();
        assert_eq!(ordered.to_text(), r#"{"a":3,"b":2}"#);
    }
}
