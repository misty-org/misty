//! What a record holds. Stored kind and field names never change (`entities::Kind`).
pub mod entities;

use serde::{Deserialize, Serialize};

use entities::{Fields, Kind};

/// One record as the renderer and native code see it, without its version.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewRecord {
    pub kind: Kind,
    pub id: String,
    pub fields: Fields,
}
