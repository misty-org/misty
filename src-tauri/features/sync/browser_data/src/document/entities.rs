use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Error, Result};

pub type Fields = BTreeMap<String, Value>;

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    OpenTab,
}

impl Kind {
    pub fn key(self, id: &str) -> Result<String> {
        if !valid_id(id) || id.starts_with("recovery:") {
            return Err(Error::Invalid);
        }
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

pub fn validate(kind: Kind, _fields: &Fields) -> Result<()> {
    match kind {
        Kind::OpenTab => Ok(()),
    }
}
