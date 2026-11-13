use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Error, Result};

pub type Fields = BTreeMap<String, Value>;

/// Record kinds. Serialized names are the stored ones and never change. A row of a kind this
/// version no longer has can't be read, and is skipped where records are listed.
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// One tab strip entry of a profile, with its splits and views. Its fields belong to the
    /// renderer, which has to read them back: anything it adds later is kept as it is.
    OpenTab,
}

impl Kind {
    pub fn key(self, id: &str) -> Result<String> {
        if !valid_id(id) || id.starts_with("recovery:") {
            return Err(Error::Invalid);
        }
        // Stored key prefixes; see `Kind`.
        let kind = match self {
            Self::OpenTab => "open_tab",
        };
        Ok(format!("{kind}/{id}"))
    }
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'-' | b'_' | b'.'))
}

/// Checks a record's fields for its kind.
pub fn validate(kind: Kind, _fields: &Fields) -> Result<()> {
    match kind {
        // Their shape is the client's own business: a record that can't be read is ignored by what
        // reads it, and nothing here can hold up the others.
        Kind::OpenTab => Ok(()),
    }
}
