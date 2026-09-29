//! A device's website sign-in data (cookies, local and session storage,
//! IndexedDB), sealed in slots on its tree's root node. The server accepts a
//! tree op only from the device holding that tree's lock, so exactly one
//! session ever writes a device's sign-in data.
//!
//! Data is split into units (one site's cookies, or one origin's storage
//! area), and each unit is placed by a stable hash into one of the sign-in
//! slots. Output is deterministic: unchanged data yields byte-identical
//! shards, so only shards that really changed are republished.
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::codec::{self, Padding};
use crate::{document::credentials::Area, store::BrowserObservation, Error, Result};

/// Slot kinds 1-3 belong to tabs; 4-16 (the server's maximum) hold sign-in data.
pub const FIRST_SLOT: i16 = 4;
pub const LAST_SLOT: i16 = 16;
const SHARDS: usize = (LAST_SLOT - FIRST_SLOT + 1) as usize;
/// Slots pad to power-of-two frames and the server caps a slot at 1 MiB of
/// ciphertext (frame + 28 bytes), so the largest usable frame is 512 KiB.
pub const MAX_FRAME: usize = 512 << 10;
/// Kept below the codec's 4 MiB decompression bound.
const MAX_SHARD_PLAINTEXT: usize = 3 << 20;
const ENVELOPE: usize = 32;

pub fn is_signin_slot(kind: i16) -> bool {
    (FIRST_SLOT..=LAST_SLOT).contains(&kind)
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Shard {
    version: u8,
    units: Vec<BrowserObservation>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PackReason {
    /// A single unit is larger than one slot can hold.
    TooLarge,
    /// Every slot with room was full.
    SyncLimit,
}

pub struct PackSkip {
    pub area: Area,
    /// For cookies: the domain whose cookies were skipped.
    pub cookie_domain: Option<String>,
    pub count: usize,
    pub reason: PackReason,
}

pub struct Packed {
    /// Plaintext per non-empty sign-in slot.
    pub shards: BTreeMap<i16, Vec<u8>>,
    pub digests: BTreeMap<i16, [u8; 32]>,
    pub skipped: Vec<PackSkip>,
}

struct Unit {
    key: String,
    area: Area,
    cookie_domain: Option<String>,
    count: usize,
    bytes: Vec<u8>,
}

pub fn digest(plaintext: &[u8]) -> [u8; 32] {
    Sha256::digest(plaintext).into()
}

/// Object keys sorted at every level, so serialization never depends on the
/// order an engine or `serde_json` feature produced them in.
fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort();
            Value::Object(
                keys.into_iter()
                    .map(|k| (k.clone(), canonical(&map[k])))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

fn cookie_domain(cookie: &Value) -> String {
    cookie["domain"]
        .as_str()
        .unwrap_or_default()
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

fn unit(
    key: String,
    area: Area,
    payload: Value,
    cookie_domain: Option<String>,
    count: usize,
) -> Result<Unit> {
    let bytes = serde_json::to_vec(&BrowserObservation {
        area: area.clone(),
        payload,
    })?;
    Ok(Unit {
        key,
        area,
        cookie_domain,
        count,
        bytes,
    })
}

fn expand(observations: &[BrowserObservation]) -> Result<Vec<Unit>> {
    let mut units = Vec::new();
    let mut seen = BTreeSet::new();
    for observation in observations {
        match &observation.area {
            Area::Cookies => {
                let cookies = observation.payload.as_array().ok_or(Error::Invalid)?;
                let mut groups: BTreeMap<String, Vec<(String, Value)>> = BTreeMap::new();
                for cookie in cookies {
                    let cookie = canonical(cookie);
                    groups
                        .entry(cookie_domain(&cookie))
                        .or_default()
                        .push((serde_json::to_string(&cookie)?, cookie));
                }
                for (domain, mut group) in groups {
                    group.sort_by(|a, b| a.0.cmp(&b.0));
                    let count = group.len();
                    let payload =
                        Value::Array(group.into_iter().map(|(_, cookie)| cookie).collect());
                    let key = format!("cookies/{domain}");
                    if !seen.insert(key.clone()) {
                        return Err(Error::Invalid);
                    }
                    units.push(unit(key, Area::Cookies, payload, Some(domain), count)?);
                }
            }
            area => {
                let key = format!("area/{}", serde_json::to_string(area)?);
                if !seen.insert(key.clone()) {
                    return Err(Error::Invalid);
                }
                units.push(unit(
                    key,
                    area.clone(),
                    canonical(&observation.payload),
                    None,
                    1,
                )?);
            }
        }
    }
    units.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(units)
}

fn home(key: &str) -> usize {
    let hash = Sha256::digest(key.as_bytes());
    (usize::from(hash[0]) << 8 | usize::from(hash[1])) % SHARDS
}

fn shard_bytes(units: &[&Unit]) -> Vec<u8> {
    let mut out = br#"{"version":1,"units":["#.to_vec();
    for (i, unit) in units.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        out.extend_from_slice(&unit.bytes);
    }
    out.extend_from_slice(b"]}");
    out
}

fn fits(plaintext: &[u8], digest: &[u8; 32], verified: &BTreeSet<[u8; 32]>) -> Result<bool> {
    if plaintext.len() > MAX_SHARD_PLAINTEXT {
        return Ok(false);
    }
    if verified.contains(digest) || plaintext.len() + ENVELOPE <= MAX_FRAME {
        return Ok(true);
    }
    Ok(codec::encode(plaintext, Padding::Bucket)?.len() <= MAX_FRAME)
}

fn skip(unit: &Unit, reason: PackReason) -> PackSkip {
    PackSkip {
        area: unit.area.clone(),
        cookie_domain: unit.cookie_domain.clone(),
        count: unit.count,
        reason,
    }
}

/// Splits one complete observation into sign-in shards. `verified` holds
/// digests of shards already known to fit a slot, which skips recompressing
/// unchanged data. Units that cannot fit are reported, never truncated.
pub fn pack(observations: &[BrowserObservation], verified: &BTreeSet<[u8; 32]>) -> Result<Packed> {
    let units = expand(observations)?;
    let mut skipped = Vec::new();
    let mut bins: Vec<Vec<&Unit>> = (0..SHARDS).map(|_| Vec::new()).collect();
    let mut used = [ENVELOPE; SHARDS];
    for unit in &units {
        let alone = shard_bytes(&[unit]);
        if !fits(&alone, &digest(&alone), verified)? {
            skipped.push(skip(unit, PackReason::TooLarge));
            continue;
        }
        let start = home(&unit.key);
        let slot = (0..SHARDS)
            .map(|i| (start + i) % SHARDS)
            .find(|&i| used[i] + unit.bytes.len() < MAX_SHARD_PLAINTEXT);
        match slot {
            Some(i) => {
                used[i] += unit.bytes.len() + 1;
                bins[i].push(unit);
            }
            None => skipped.push(skip(unit, PackReason::SyncLimit)),
        }
    }
    let mut shards = BTreeMap::new();
    let mut digests = BTreeMap::new();
    for (i, mut bin) in bins.into_iter().enumerate() {
        // Compression varies with content: evict the largest units until the
        // real padded frame fits. Evicted units are reported, not dropped silently.
        loop {
            if bin.is_empty() {
                break;
            }
            let plaintext = shard_bytes(&bin);
            let hash = digest(&plaintext);
            if fits(&plaintext, &hash, verified)? {
                let kind = FIRST_SLOT + i as i16;
                digests.insert(kind, hash);
                shards.insert(kind, plaintext);
                break;
            }
            let largest = (0..bin.len())
                .max_by_key(|&j| (bin[j].bytes.len(), std::cmp::Reverse(j)))
                .expect("non-empty");
            skipped.push(skip(bin.remove(largest), PackReason::SyncLimit));
        }
    }
    Ok(Packed {
        shards,
        digests,
        skipped,
    })
}

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

#[cfg(test)]
#[path = "signin_tests.rs"]
mod tests;
