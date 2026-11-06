//! One origin's localStorage as records, `<origin>#<n>`, and back. The whole origin travels
//! together: every part of a copy carries the same edit time, and a copy only counts once all its
//! parts are here.
use misty_browser_sync::document::{entities::Kind, ViewRecord};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub(super) const LOCAL_STORAGE: &str = "local_storage";
/// About this much JSON goes in one record.
pub(super) const PART_BYTES: usize = 128 << 10;
/// Over this much JSON, a site's localStorage doesn't sync.
pub(super) const ORIGIN_BYTES: usize = 8 << 20;
const MAX_PARTS: usize = 256;
/// A value too big for one part travels in pieces, each under a key no real key starts with.
const PIECE: &str = "\u{0}misty-piece\u{0}";

pub(super) type Items = BTreeMap<String, String>;

/// The origin doesn't fit, or holds what can't be carried. Reported by site, and cookies go on.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct TooLarge;

/// A whole copy of an origin.
pub(super) struct OriginCopy {
    pub edited_at: u64,
    pub parts: usize,
    pub items: Items,
}

pub(super) fn part_id(origin: &str, part: usize) -> String {
    format!("{origin}#{part}")
}

/// A hash of what an origin holds, whichever computer it came from.
pub(super) fn items_hash(items: &Items) -> String {
    let mut hash = Sha256::new();
    for (key, value) in items {
        hash.update((key.len() as u64).to_le_bytes());
        hash.update(key);
        hash.update((value.len() as u64).to_le_bytes());
        hash.update(value);
    }
    hex::encode(hash.finalize())
}

/// How long a character is once it's in JSON.
fn json_char(c: char) -> usize {
    match c {
        '"' | '\\' | '\u{8}' | '\u{c}' | '\n' | '\r' | '\t' => 2,
        c if (c as u32) < 0x20 => 6,
        c => c.len_utf8(),
    }
}

fn json_len(text: &str) -> usize {
    text.chars().map(json_char).sum::<usize>() + 2
}

/// Cuts text into pieces of at most `budget` bytes of JSON, on character boundaries.
fn pieces(text: &str, budget: usize) -> Vec<&str> {
    let mut out = Vec::new();
    let (mut start, mut size) = (0, 0);
    for (at, c) in text.char_indices() {
        let length = json_char(c);
        if size + length > budget && at > start {
            out.push(&text[start..at]);
            start = at;
            size = 0;
        }
        size += length;
    }
    out.push(&text[start..]);
    out
}

/// Splits an origin into its records. `Err` when it is over the cap.
pub(super) fn split(
    origin: &str,
    items: &Items,
    edited_at: u64,
) -> Result<Vec<(String, Option<ViewRecord>)>, TooLarge> {
    let mut total = 0;
    let mut parts: Vec<serde_json::Map<String, Value>> = Vec::new();
    let mut current = serde_json::Map::new();
    let mut size = 0;
    let mut add = |key: String, value: &str, parts: &mut Vec<_>| {
        let length = json_len(&key) + json_len(value) + 2;
        if size + length > PART_BYTES && !current.is_empty() {
            parts.push(std::mem::take(&mut current));
            size = 0;
        }
        size += length;
        current.insert(key, json!(value));
    };
    for (key, value) in items {
        // A real key that looks like a piece couldn't be told apart from one.
        if key.starts_with(PIECE) || json_len(key) > PART_BYTES / 2 {
            return Err(TooLarge);
        }
        total += json_len(key) + json_len(value) + 2;
        if total > ORIGIN_BYTES {
            return Err(TooLarge);
        }
        let room = PART_BYTES - json_len(key) - PIECE.len() * 2 - 64;
        if json_len(value) <= room {
            add(key.clone(), value, &mut parts);
            continue;
        }
        let cut = pieces(value, room);
        for (index, piece) in cut.iter().enumerate() {
            let name = format!("{PIECE}{index}\u{0}{}\u{0}{key}", cut.len());
            add(name, piece, &mut parts);
        }
    }
    // An origin that was emptied still has one part, saying so.
    if !current.is_empty() || parts.is_empty() {
        parts.push(current);
    }
    if parts.len() > MAX_PARTS {
        return Err(TooLarge);
    }
    let count = parts.len();
    Ok(parts
        .into_iter()
        .enumerate()
        .map(|(part, items)| {
            let id = part_id(origin, part);
            let record = ViewRecord {
                kind: Kind::SiteStorage,
                id: id.clone(),
                fields: BTreeMap::from([
                    ("origin".to_owned(), json!(origin)),
                    ("part".to_owned(), json!(part)),
                    ("parts".to_owned(), json!(count)),
                    ("edited_at".to_owned(), json!(edited_at)),
                    ("items".to_owned(), Value::Object(items)),
                ]),
            };
            (id, Some(record))
        })
        .collect())
}

struct Part<'a> {
    origin: &'a str,
    part: usize,
    parts: usize,
    edited_at: u64,
    items: &'a serde_json::Map<String, Value>,
}

fn read_part(record: &ViewRecord) -> Option<Part<'_>> {
    if record.kind != Kind::SiteStorage {
        return None;
    }
    let part = Part {
        origin: record.fields.get("origin")?.as_str()?,
        part: usize::try_from(record.fields.get("part")?.as_u64()?).ok()?,
        parts: usize::try_from(record.fields.get("parts")?.as_u64()?).ok()?,
        edited_at: record.fields.get("edited_at")?.as_u64()?,
        items: record.fields.get("items")?.as_object()?,
    };
    (part.part < part.parts
        && part.parts <= MAX_PARTS
        && record.id == part_id(part.origin, part.part))
    .then_some(part)
}

/// Puts one copy's parts back together. `None` when one is missing.
fn join(parts: &[&Part<'_>]) -> Option<Items> {
    let mut items = Items::new();
    let mut cut: BTreeMap<&str, (usize, BTreeMap<usize, &str>)> = BTreeMap::new();
    for part in parts {
        for (key, value) in part.items {
            let value = value.as_str()?;
            match key.strip_prefix(PIECE) {
                None => {
                    items.insert(key.clone(), value.to_owned());
                }
                Some(piece) => {
                    let mut fields = piece.splitn(3, '\u{0}');
                    let index: usize = fields.next()?.parse().ok()?;
                    let count: usize = fields.next()?.parse().ok()?;
                    let (total, found) = cut.entry(fields.next()?).or_default();
                    *total = count;
                    found.insert(index, value);
                }
            }
        }
    }
    for (key, (total, found)) in cut {
        if found.len() != total {
            return None;
        }
        items.insert(key.to_owned(), found.into_values().collect());
    }
    Some(items)
}

/// The newest whole copy of each origin in a list of records. Parts of a copy still arriving, or of
/// an older one, are left for later.
pub(super) fn assemble(records: &[ViewRecord]) -> BTreeMap<String, OriginCopy> {
    let mut copies: BTreeMap<(&str, u64, usize), Vec<Part<'_>>> = BTreeMap::new();
    for part in records.iter().filter_map(read_part) {
        copies
            .entry((part.origin, part.edited_at, part.parts))
            .or_default()
            .push(part);
    }
    let mut out: BTreeMap<String, OriginCopy> = BTreeMap::new();
    // Oldest first, so a newer whole copy replaces an older one.
    for ((origin, edited_at, parts), found) in copies {
        let mut numbers: Vec<_> = found.iter().collect();
        numbers.sort_by_key(|part| part.part);
        let whole = numbers.len() == parts
            && numbers
                .iter()
                .enumerate()
                .all(|(index, part)| part.part == index);
        if !whole {
            continue;
        }
        if let Some(items) = join(&numbers) {
            out.insert(
                origin.to_owned(),
                OriginCopy {
                    edited_at,
                    parts,
                    items,
                },
            );
        }
    }
    out
}

/// What this store last held for an origin.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) struct Known {
    pub edited_at: u64,
    pub hash: String,
    pub stamp: String,
    /// Over the cap: it doesn't sync, in either direction.
    #[serde(default)]
    pub over: bool,
}

/// Whether a copy in the records still has to reach this store.
pub(super) fn is_pending(known: Option<&Known>, copy: &OriginCopy) -> bool {
    match known {
        None => true,
        Some(known) if known.over => false,
        Some(known) => match copy.edited_at.cmp(&known.edited_at) {
            std::cmp::Ordering::Greater => true,
            std::cmp::Ordering::Less => false,
            // Two computers first read this origin at once: the record is what they share.
            std::cmp::Ordering::Equal => items_hash(&copy.items) != known.hash,
        },
    }
}

/// What to do about an origin read from a page.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Decision {
    /// It's what this store already has.
    Same,
    /// It matches the copy in the records, which this store hadn't noted yet.
    Adopt(u64),
    /// This store is new to the origin and the records have another copy: that copy wins.
    Yield,
    /// A new copy, from here.
    Upload(u64),
}

/// `record` is the edit time and hash of the copy in the records.
pub(super) fn decide(
    known: Option<&Known>,
    record: Option<(u64, &str)>,
    hash: &str,
    empty: bool,
    now_ms: u64,
) -> Decision {
    match (known, record) {
        (Some(known), _) if !known.over && known.hash == hash => Decision::Same,
        (None, Some((edited_at, theirs))) if theirs == hash => Decision::Adopt(edited_at),
        (None, Some(_)) => Decision::Yield,
        // Most sites have nothing, and nothing needs no record.
        (None, None) if empty => Decision::Same,
        // What it already held: anything from elsewhere wins over it.
        (None, None) => Decision::Upload(0),
        (Some(known), record) => {
            let newest = known
                .edited_at
                .max(record.map_or(0, |(edited_at, _)| edited_at));
            Decision::Upload(now_ms.max(newest + 1))
        }
    }
}
