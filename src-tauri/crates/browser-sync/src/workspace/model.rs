//! Maps workspace records onto workspace nodes.
//!
//! Hierarchy: workspace root → window → tab (owns its split tree and pane
//! IDs) → view. Shared workspace root → folder → bookmark. Views keep their
//! pane in `placement`; panes are not separate nodes because the split tree is
//! a single tab field. A record whose parent is missing hangs off the root,
//! matching the existing orphaned-view/bookmark handling.
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
        #[serde(rename = "tree_version")]
        workspace_version: u64,
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
pub fn node_id(workspace_id: &str, kind: Kind, record_id: &str) -> String {
    let digest = Sha256::digest(
        serde_json::to_vec(&("misty.sync.node-id.v2", workspace_id, kind, record_id)).expect("static encoding"),
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
        Kind::Tab => Some((Kind::Window, field(record, "window_id")?.to_owned())),
        Kind::View => Some((
            Kind::Tab,
            record.fields.get("placement")?.get("layout_id")?.as_str()?.to_owned(),
        )),
        Kind::Bookmark => Some((Kind::Folder, field(record, "group_id")?.to_owned())),
        Kind::Window | Kind::Folder | Kind::TabGroup | Kind::SavedTabGroup | Kind::HistoryBatch => None,
    }
}

pub fn belongs_to_shared(kind: Kind) -> bool {
    matches!(kind, Kind::Folder | Kind::Bookmark)
}

/// The collection a record kind lives in, if it is not a workspace record.
pub fn collection_of(kind: Kind) -> Option<&'static str> {
    match kind {
        Kind::Folder | Kind::Bookmark => Some(crate::collections::BOOKMARKS),
        Kind::SavedTabGroup => Some(crate::collections::TAB_GROUPS),
        Kind::HistoryBatch => Some(crate::collections::HISTORY),
        _ => None,
    }
}

/// Assigns each record its node ID and parent node ID within one workspace.
pub fn place(workspace_id: &str, records: &[ViewRecord]) -> BTreeMap<String, (Option<String>, ViewRecord)> {
    let present: BTreeMap<(Kind, &str), String> = records
        .iter()
        .map(|r| ((r.kind, r.id.as_str()), node_id(workspace_id, r.kind, &r.id)))
        .collect();
    records
        .iter()
        .map(|r| {
            let parent = parent_record(r)
                .and_then(|(kind, id)| present.get(&(kind, id.as_str())).cloned())
                .unwrap_or_else(|| workspace_id.to_owned());
            (node_id(workspace_id, r.kind, &r.id), (Some(parent), r.clone()))
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

/// `rebase` for a queue of edits made against known workspace versions. An edit
/// never recreates a record another machine deleted after it was made, and
/// never moves a record into a parent deleted that way (the move is dropped
/// and its other fields still apply): both machines keep both outcomes
/// instead of one silently undoing the other.
pub fn rebase_batches(
    records: &[ViewRecord],
    batches: &[(u64, &[Change])],
    tombstones: &BTreeMap<(Kind, String), u64>,
) -> crate::Result<Vec<ViewRecord>> {
    let deleted_after = |kind: Kind, id: &str, base: u64| {
        tombstones
            .get(&(kind, id.to_owned()))
            .is_some_and(|version| *version > base)
    };
    let mut kept = Vec::new();
    for (base, changes) in batches {
        for change in *changes {
            match change {
                Change::Create { kind, id, .. } if deleted_after(*kind, id, *base) => {}
                Change::Patch { kind, id, fields } => {
                    let mut fields = fields.clone();
                    let parent = match kind {
                        Kind::View => fields
                            .get("placement")
                            .and_then(|p| p.get("layout_id"))
                            .and_then(|v| v.as_str())
                            .map(|id| (Kind::Tab, id.to_owned(), "placement")),
                        Kind::Tab => fields
                            .get("window_id")
                            .and_then(|v| v.as_str())
                            .map(|id| (Kind::Window, id.to_owned(), "window_id")),
                        _ => None,
                    };
                    if let Some((parent_kind, parent_id, field)) = parent {
                        if deleted_after(parent_kind, &parent_id, *base) {
                            fields.remove(field);
                        }
                    }
                    if !fields.is_empty() {
                        kept.push(Change::Patch { kind: *kind, id: id.clone(), fields });
                    }
                }
                other => kept.push(other.clone()),
            }
        }
    }
    rebase(records, &kept)
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
        let workspace = "01951d32-40ac-7000-8000-000000000002";
        let records = vec![
            record(Kind::Window, "w", json!({"title": "", "order": 0})),
            record(Kind::Tab, "l", json!({"window_id": "w"})),
            record(Kind::View, "t", json!({"placement": {"layout_id": "l", "pane_id": "p", "order": 0}})),
            record(Kind::View, "orphan", json!({"placement": {"layout_id": "gone", "pane_id": "p", "order": 0}})),
        ];
        let placed = place(workspace, &records);
        let id = |k, r| node_id(workspace, k, r);
        assert_eq!(placed[&id(Kind::Window, "w")].0.as_deref(), Some(workspace));
        assert_eq!(placed[&id(Kind::Tab, "l")].0, Some(id(Kind::Window, "w")));
        assert_eq!(placed[&id(Kind::View, "t")].0, Some(id(Kind::Tab, "l")));
        assert_eq!(placed[&id(Kind::View, "orphan")].0.as_deref(), Some(workspace));
        assert!(uuid::Uuid::parse_str(&id(Kind::View, "t")).is_ok());
        assert_ne!(id(Kind::View, "t"), node_id("01951d32-40ac-7000-8000-000000000009", Kind::View, "t"));
    }
}
