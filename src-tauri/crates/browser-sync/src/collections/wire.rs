//! Wire forms of the server's collection frames.
use serde::{Deserialize, Serialize};

use crate::workspace::protocol::b64;

#[derive(Serialize)]
pub struct Write {
    pub key: String,
    pub base_version: u64,
    /// `None` deletes.
    #[serde(with = "b64::option")]
    pub ciphertext: Option<Vec<u8>>,
}

#[derive(Deserialize)]
pub struct Record {
    pub key: String,
    pub version: u64,
    #[serde(with = "b64::option", default)]
    pub ciphertext: Option<Vec<u8>>,
}

#[derive(Deserialize)]
pub struct Listing {
    pub collection: String,
    pub records: Vec<Record>,
    pub cursor: u64,
    pub more: bool,
    pub reset: bool,
}

#[derive(Deserialize)]
pub struct Answer {
    pub key: String,
    pub applied: bool,
    pub version: u64,
    #[serde(default)]
    pub current: Option<Record>,
}
