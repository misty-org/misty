//! Signed device records as JSON arrays led by their domain string
//! Records travel as their exact signed bytes;
//! nothing here re-serializes a record it verifies.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;

mod policy;
pub use policy::{DevicePolicy, RunGrant, SharedFolder};

/// A signed device record as its exact signed bytes (base64) and signature.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignedRecord {
    pub payload: String,
    pub signature: String,
}

impl SignedRecord {
    pub fn new(payload: &[u8], signature: String) -> Self {
        Self {
            payload: STANDARD.encode(payload),
            signature,
        }
    }

    pub fn bytes(&self) -> Option<Vec<u8>> {
        STANDARD
            .decode(&self.payload)
            .ok()
            .filter(|bytes| bytes.len() <= 65536)
    }

    /// The decoded fields after the domain, when the domain matches.
    fn fields(&self, domain: &str) -> Option<(Vec<u8>, Vec<Value>)> {
        let bytes = self.bytes()?;
        let mut fields: Vec<Value> = serde_json::from_slice(&bytes).ok()?;
        if fields.first()?.as_str()? != domain {
            return None;
        }
        fields.remove(0);
        Some((bytes, fields))
    }
}

/// A server's id is a hyphenated UUID; this computer's own (`agents::storage::device_id`) is its
/// simple form.
pub fn valid_device_id(value: &str) -> bool {
    matches!(value.len(), 39 | 43)
        && value.starts_with("device_")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

#[cfg(test)]
mod tests;
