//! Go encodes `[]byte` as standard base64; mirror that on the wire.
use super::*;
use serde::{Deserializer, Serializer};

pub fn serialize<S: Serializer>(v: &[u8], s: S) -> std::result::Result<S::Ok, S::Error> {
    s.serialize_str(&STANDARD.encode(v))
}
pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Vec<u8>, D::Error> {
    let s = String::deserialize(d)?;
    STANDARD.decode(s).map_err(serde::de::Error::custom)
}
pub mod option {
    use super::*;
    pub fn serialize<S: Serializer>(
        v: &Option<Vec<u8>>,
        s: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        match v {
            Some(v) => s.serialize_str(&STANDARD.encode(v)),
            None => s.serialize_none(),
        }
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(
        d: D,
    ) -> std::result::Result<Option<Vec<u8>>, D::Error> {
        Option::<String>::deserialize(d)?
            .map(|s| STANDARD.decode(s).map_err(serde::de::Error::custom))
            .transpose()
    }
}
pub mod list {
    use super::*;
    pub fn serialize<S: Serializer>(v: &[Vec<u8>], s: S) -> std::result::Result<S::Ok, S::Error> {
        s.collect_seq(v.iter().map(|b| STANDARD.encode(b)))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(
        d: D,
    ) -> std::result::Result<Vec<Vec<u8>>, D::Error> {
        Vec::<String>::deserialize(d)?
            .into_iter()
            .map(|s| STANDARD.decode(s).map_err(serde::de::Error::custom))
            .collect()
    }
}
