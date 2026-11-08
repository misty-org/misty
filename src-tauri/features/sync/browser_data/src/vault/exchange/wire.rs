//! The frames and records that cross the connection, exactly as the server sends and reads them.
use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

/// Base64 in JSON, which is how Go encodes `[]byte`.
pub(crate) mod b64 {
    use super::*;
    pub fn serialize<S: serde::Serializer>(bytes: &[u8], out: S) -> Result2<S::Ok, S::Error> {
        out.serialize_str(&STANDARD.encode(bytes))
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(input: D) -> Result2<Vec<u8>, D::Error> {
        let text = String::deserialize(input)?;
        STANDARD.decode(text).map_err(serde::de::Error::custom)
    }
    type Result2<T, E> = std::result::Result<T, E>;
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct WireWrite {
    pub scope: String,
    pub key: String,
    pub base_version: u64,
    #[serde(with = "b64")]
    pub sealed: Vec<u8>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub deleted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u64>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientFrame {
    Pull {
        request_id: String,
        after: u64,
    },
    Push {
        request_id: String,
        writes: Vec<WireWrite>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct WireRecord {
    pub scope: String,
    pub key: String,
    pub version: u64,
    #[serde(with = "b64")]
    pub sealed: Vec<u8>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
pub struct WirePage {
    #[serde(default)]
    pub records: Vec<WireRecord>,
    pub cursor: u64,
    pub head: u64,
    #[serde(default)]
    pub more: bool,
    #[serde(default)]
    pub reset: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct WireResult {
    pub scope: String,
    pub key: String,
    pub applied: bool,
    pub version: u64,
    #[serde(default)]
    pub current: Option<WireRecord>,
}

/// One frame from the server. A type this version doesn't know is `Unknown`, and ignored: a newer
/// server never breaks an older client.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerFrame {
    Records {
        #[serde(default)]
        request_id: String,
        page: WirePage,
    },
    Pushed {
        #[serde(default)]
        request_id: String,
        results: Vec<WireResult>,
    },
    Changed,
    SessionsChanged,
    VaultKeyChanged,
    VaultGone,
    Error {
        #[serde(default)]
        request_id: String,
        code: String,
        #[serde(default)]
        retry_after_ms: Option<u64>,
    },
    BatchPolicy {
        policy: WirePolicy,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct WirePolicy {
    #[serde(default)]
    pub lanes: HashMap<String, WireLane>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
pub struct WireLane {
    pub quiet_ms: u64,
    pub max_wait_ms: u64,
    pub max_edits: u64,
}
