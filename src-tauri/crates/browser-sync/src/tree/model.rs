//! Maps workspace records onto tree nodes.
//!
//! Hierarchy: device tree root → window → layout (owns its split tree and
//! pane IDs) → tab. Shared tree root → group → website. Tabs keep their pane
//! in `placement`; panes are not separate nodes because the split tree is a
//! single layout field. A record whose parent is missing hangs off the root,
//! matching the existing orphaned-tab/website handling.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::document::{
    entities::{self, Kind},
    Change, Resume, ViewRecord,
};

/// Encrypted node payload. The server never sees which variant a node is.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "node", rename_all = "snake_case", deny_unknown_fields)]
pub enum NodeBody {
    Root {
        tree_version: u64,
        #[serde(with = "super::protocol::b64")]
        merkle_root: Vec<u8>,
        resume: Option<Resume>,
    },
    Record {
        kind: Kind,
        id: String,
        fields: crate::document::entities::Fields,
    },
}

/// Record IDs are renderer-chosen strings; node IDs must be UUIDs. Derive one
/// deterministically so every client names a record's node identically.
pub fn node_id(tree_id: &str, kind: Kind, record_id: &str) -> String {
    let digest = Sha256::digest(
        serde_json::to_vec(&("misty.sync.node-id.v2", tree_id, kind, record_id)).expect("static encoding"),
    );
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80; // version 8: custom, name-derived
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    uuid::Uuid::from_bytes(bytes).to_string()
}

fn field<'a>(record: &'a ViewRecord, name: &str) -> Option<&'a str> {
    record.fields.get(name)?.as_str()
}

fn parent_record(record: &ViewRecord) -> Option<(Kind, String)> {
    match record.kind {
        Kind::Layout => Some((Kind::Window, field(record, "window_id")?.to_owned())),
        Kind::Tab => Some((
            Kind::Layout,
            record.fields.get("placement")?.get("layout_id")?.as_str()?.to_owned(),
        )),
        Kind::Website => Some((Kind::Group, field(record, "group_id")?.to_owned())),
        Kind::Window | Kind::Group => None,
    }
}

pub fn belongs_to_shared(kind: Kind) -> bool {
    matches!(kind, Kind::Group | Kind::Website)
}

/// Assigns each record its node ID and parent node ID within one tree.
pub fn place(tree_id: &str, records: &[ViewRecord]) -> BTreeMap<String, (Option<String>, ViewRecord)> {
    let present: BTreeMap<(Kind, &str), String> = records
        .iter()
        .map(|r| ((r.kind, r.id.as_str()), node_id(tree_id, r.kind, &r.id)))
        .collect();
    records
        .iter()
        .map(|r| {
            let parent = parent_record(r)
                .and_then(|(kind, id)| present.get(&(kind, id.as_str())).cloned())
                .unwrap_or_else(|| tree_id.to_owned());
            (node_id(tree_id, r.kind, &r.id), (Some(parent), r.clone()))
        })
        .collect()
}

/// Replays local changes onto the latest verified records. Changes are
/// idempotent: a create never overwrites, a patch of a missing record and a
/// delete of a missing record are no-ops.
pub fn rebase(records: &[ViewRecord], changes: &[Change]) -> crate::Result<Vec<ViewRecord>> {
    let mut by_key: BTreeMap<(Kind, String), ViewRecord> =
        records.iter().map(|r| ((r.kind, r.id.clone()), r.clone())).collect();
    for change in changes {
        match change {
            Change::Create { kind, id, fields } => {
                entities::validate(*kind, fields)?;
                by_key
                    .entry((*kind, id.clone()))
                    .or_insert_with(|| ViewRecord { kind: *kind, id: id.clone(), fields: fields.clone() });
            }
            Change::Patch { kind, id, fields } => {
                if let Some(record) = by_key.get_mut(&(*kind, id.clone())) {
                    let mut merged = record.fields.clone();
                    merged.extend(fields.clone());
                    entities::validate(*kind, &merged)?;
                    record.fields = merged;
                }
            }
            Change::Delete { kind, id } => {
                by_key.remove(&(*kind, id.clone()));
            }
        }
    }
    Ok(by_key.into_values().collect())
}

pub fn change_kind(change: &Change) -> Kind {
    match change {
        Change::Create { kind, .. } | Change::Patch { kind, .. } | Change::Delete { kind, .. } => *kind,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn record(kind: Kind, id: &str, fields: serde_json::Value) -> ViewRecord {
        ViewRecord { kind, id: id.into(), fields: serde_json::from_value(fields).unwrap() }
    }

    #[test]
    fn places_records_under_their_parents_or_the_root() {
        let tree = "01951d32-40ac-7000-8000-000000000002";
        let records = vec![
            record(Kind::Window, "w", json!({"title": "", "order": 0})),
            record(Kind::Layout, "l", json!({"window_id": "w"})),
            record(Kind::Tab, "t", json!({"placement": {"layout_id": "l", "pane_id": "p", "order": 0}})),
            record(Kind::Tab, "orphan", json!({"placement": {"layout_id": "gone", "pane_id": "p", "order": 0}})),
        ];
        let placed = place(tree, &records);
        let id = |k, r| node_id(tree, k, r);
        assert_eq!(placed[&id(Kind::Window, "w")].0.as_deref(), Some(tree));
        assert_eq!(placed[&id(Kind::Layout, "l")].0, Some(id(Kind::Window, "w")));
        assert_eq!(placed[&id(Kind::Tab, "t")].0, Some(id(Kind::Layout, "l")));
        assert_eq!(placed[&id(Kind::Tab, "orphan")].0.as_deref(), Some(tree));
        assert!(uuid::Uuid::parse_str(&id(Kind::Tab, "t")).is_ok());
        assert_ne!(id(Kind::Tab, "t"), node_id("01951d32-40ac-7000-8000-000000000009", Kind::Tab, "t"));
    }
}
