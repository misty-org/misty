//! JSON kept as text, with its keys in their original order. Key order must not change between
//! turns, or providers can't reuse their prompt cache. `serde_json::Value` would sort the keys, and
//! its `preserve_order` feature would turn on for the whole app, where signed payloads depend on
//! sorted keys. `RawValue` alone can't pass through the tagged enums the prompt is made of, so
//! reading goes through a visitor that writes the text itself.
use std::fmt;

use serde::{
    de::{self, Deserialize, DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor},
    Serialize, Serializer,
};
use serde_json::value::RawValue;

#[derive(Clone, Debug)]
pub struct RawJson(Box<RawValue>);

impl RawJson {
    /// Takes JSON text as it is, or fails if it isn't valid JSON.
    pub fn from_text(text: String) -> Result<Self, serde_json::Error> {
        RawValue::from_string(text).map(Self)
    }

    /// An empty object, which the model gets when its own input couldn't be read.
    pub fn empty_object() -> Self {
        Self::from_text("{}".to_owned()).expect("an empty object is valid JSON")
    }

    pub fn get(&self) -> &str {
        self.0.get()
    }
}

impl Serialize for RawJson {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for RawJson {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut text = String::new();
        JsonText(&mut text).deserialize(deserializer)?;
        Self::from_text(text).map_err(de::Error::custom)
    }
}

/// Appends one JSON value to the text as it's read.
struct JsonText<'a>(&'a mut String);

impl<'de> DeserializeSeed<'de> for JsonText<'_> {
    type Value = ();

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        deserializer.deserialize_any(self)
    }
}

fn number<T: fmt::Display>(text: &mut String, value: T) {
    text.push_str(&value.to_string());
}

fn quoted<E: de::Error>(text: &mut String, value: &str) -> Result<(), E> {
    text.push_str(&serde_json::to_string(value).map_err(E::custom)?);
    Ok(())
}

impl<'de> Visitor<'de> for JsonText<'_> {
    type Value = ();

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("any JSON value")
    }

    fn visit_bool<E>(self, value: bool) -> Result<(), E> {
        self.0.push_str(if value { "true" } else { "false" });
        Ok(())
    }

    fn visit_i64<E>(self, value: i64) -> Result<(), E> {
        number(self.0, value);
        Ok(())
    }

    fn visit_u64<E>(self, value: u64) -> Result<(), E> {
        number(self.0, value);
        Ok(())
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<(), E> {
        // JSON has no NaN or infinity, so they can't arrive from a real document.
        self.0.push_str(&serde_json::to_string(&value).map_err(E::custom)?);
        Ok(())
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<(), E> {
        quoted(self.0, value)
    }

    fn visit_unit<E>(self) -> Result<(), E> {
        self.0.push_str("null");
        Ok(())
    }

    fn visit_none<E>(self) -> Result<(), E> {
        self.0.push_str("null");
        Ok(())
    }

    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<(), D::Error> {
        deserializer.deserialize_any(self)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        self.0.push('[');
        let mut first = true;
        loop {
            let mark = self.0.len();
            if !first {
                self.0.push(',');
            }
            if seq.next_element_seed(JsonText(self.0))?.is_none() {
                self.0.truncate(mark);
                break;
            }
            first = false;
        }
        self.0.push(']');
        Ok(())
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        self.0.push('{');
        let mut first = true;
        while let Some(key) = map.next_key::<String>()? {
            if !first {
                self.0.push(',');
            }
            first = false;
            quoted::<A::Error>(self.0, &key)?;
            self.0.push(':');
            map.next_value_seed(JsonText(self.0))?;
        }
        self.0.push('}');
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize, Serialize)]
    #[serde(tag = "type")]
    enum Tagged {
        Holder { input: RawJson },
    }

    #[test]
    fn key_order_survives_a_tagged_enum() {
        let text = r#"{"type":"Holder","input":{"z":1,"a":[true,null,{"y":"é\n","b":1.5}],"m":{}}}"#;
        let Tagged::Holder { input } = serde_json::from_str(text).unwrap();
        assert_eq!(input.get(), r#"{"z":1,"a":[true,null,{"y":"é\n","b":1.5}],"m":{}}"#);
    }

    #[test]
    fn writing_keeps_the_text() {
        let raw = RawJson::from_text(r#"{"z":1,"a":2}"#.to_owned()).unwrap();
        assert_eq!(serde_json::to_string(&raw).unwrap(), r#"{"z":1,"a":2}"#);
        assert!(RawJson::from_text("{nope".to_owned()).is_err());
    }
}
