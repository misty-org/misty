//! Rebuilding observations from sign-in shards.
use std::collections::BTreeMap;

use serde_json::Value;

use super::Shard;
use crate::{document::credentials::Area, store::BrowserObservation, Error, Result};

/// Rebuilds one complete observation from a device's shards: exactly one
/// cookie area (possibly empty) followed by every storage area. Shards come
/// from the server, so every unit is validated before use.
pub fn unpack<'a>(shards: impl IntoIterator<Item = &'a [u8]>) -> Result<Vec<BrowserObservation>> {
    let mut cookies = Vec::new();
    let mut areas = BTreeMap::new();
    for plaintext in shards {
        let shard: Shard = serde_json::from_slice(plaintext)?;
        if shard.version != 1 {
            return Err(Error::Recovery);
        }
        for unit in shard.units {
            match unit.area {
                Area::Cookies => cookies.extend(
                    unit.payload
                        .as_array()
                        .ok_or(Error::Invalid)?
                        .iter()
                        .cloned(),
                ),
                area => {
                    area.key(&"a".repeat(64))?;
                    area.validate_payload(&unit.payload)?;
                    if areas
                        .insert(
                            serde_json::to_string(&area)?,
                            BrowserObservation {
                                area,
                                payload: unit.payload,
                            },
                        )
                        .is_some()
                    {
                        return Err(Error::Invalid);
                    }
                }
            }
        }
    }
    let cookies = Value::Array(cookies);
    Area::Cookies.validate_payload(&cookies)?;
    let mut out = vec![BrowserObservation {
        area: Area::Cookies,
        payload: cookies,
    }];
    out.extend(areas.into_values());
    Ok(out)
}
