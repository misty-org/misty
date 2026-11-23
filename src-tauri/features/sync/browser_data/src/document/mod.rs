pub mod entities;

use serde::{Deserialize, Serialize};

use entities::{Fields, Kind};

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewRecord {
    pub kind: Kind,
    pub id: String,
    pub fields: Fields,
}
