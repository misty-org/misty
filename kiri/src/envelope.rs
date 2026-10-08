use crate::KiriError;
use serde::Deserialize;
use serde_json::Value;

pub const PROTOCOL_VERSION: u8 = 1;

/// Largest serialized `args` a page may send. Capabilities that move bulk
/// data (files, media) will need their own channel rather than a bigger limit.
pub const MAX_ARGS_BYTES: usize = 16 * 1024;

const MAX_NAME_LEN: usize = 64;

/// One page call: `Kiri.call(cap, method, args)` on the page side.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub v: u8,
    pub cap: String,
    pub method: String,
    #[serde(default)]
    pub args: Value,
}

impl Request {
    /// Checks the envelope before anything routes on it. Everything in it is
    /// page-controlled.
    pub fn validate(&self) -> Result<(), KiriError> {
        if self.v != PROTOCOL_VERSION {
            return Err(KiriError::not_supported(format!(
                "Kiri protocol version {} is not supported.",
                self.v
            )));
        }
        if !valid_name(&self.cap) || !valid_name(&self.method) {
            return Err(KiriError::type_error("Invalid capability or method name."));
        }
        let size = serde_json::to_vec(&self.args).map_or(usize::MAX, |bytes| bytes.len());
        if size > MAX_ARGS_BYTES {
            return Err(KiriError::type_error("Arguments are too large."));
        }
        Ok(())
    }
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_LEN
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(value: Value) -> Result<Request, serde_json::Error> {
        serde_json::from_value(value)
    }

    #[test]
    fn accepts_a_well_formed_call() {
        let call = request(json!({ "v": 1, "cap": "media", "method": "state", "args": { "audible": true } })).unwrap();
        assert!(call.validate().is_ok());
    }

    #[test]
    fn args_default_to_null() {
        let call = request(json!({ "v": 1, "cap": "media", "method": "state" })).unwrap();
        assert_eq!(call.args, Value::Null);
    }

    #[test]
    fn rejects_unknown_fields_and_malformed_envelopes() {
        assert!(request(json!({ "v": 1, "cap": "media", "method": "state", "origin": "https://bank.example" })).is_err());
        assert!(request(json!({ "v": 1, "cap": 7, "method": "state" })).is_err());
        assert!(request(json!({ "cap": "media", "method": "state" })).is_err());
    }

    #[test]
    fn rejects_other_versions_and_odd_names() {
        let wrong_version = request(json!({ "v": 2, "cap": "media", "method": "state" })).unwrap();
        assert_eq!(wrong_version.validate().unwrap_err().name, "NotSupportedError");
        for (cap, method) in [("", "state"), ("Media", "state"), ("media", "__proto__"), ("media/../x", "state")] {
            let call = request(json!({ "v": 1, "cap": cap, "method": method })).unwrap();
            assert_eq!(call.validate().unwrap_err().name, "TypeError", "{cap}.{method}");
        }
        let long = "a".repeat(MAX_NAME_LEN + 1);
        let call = request(json!({ "v": 1, "cap": long, "method": "state" })).unwrap();
        assert!(call.validate().is_err());
    }

    #[test]
    fn rejects_oversized_args() {
        let call = request(json!({ "v": 1, "cap": "media", "method": "state", "args": "x".repeat(MAX_ARGS_BYTES) })).unwrap();
        assert_eq!(call.validate().unwrap_err().name, "TypeError");
    }
}
