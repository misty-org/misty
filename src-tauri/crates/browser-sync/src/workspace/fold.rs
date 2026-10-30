//! Folds queued edits while they wait for their batch to publish, so a queue
//! that waits longer does not grow with every gesture. Every publish replays
//! the whole queue (`model::rebase_batches`); folding must leave that result
//! unchanged for any server state, so only these rules apply:
//!
//! - a delete supersedes every earlier change to the record;
//! - a patch after a delete is dropped (it would patch nothing);
//! - two patches made against the same version merge, unless both move the
//!   record (each move is checked against deletions separately);
//! - a second create made against the same version is dropped (the first wins).
//!
//! A create then a patch never merge: if the record already exists the create
//! does nothing and only the patch applies.
use std::collections::BTreeMap;

use crate::{
    document::{entities::Kind, Change},
    store::{Batch, Desired},
};

type Key = (Kind, String);

fn key(change: &Change) -> Key {
    match change {
        Change::Create { kind, id, .. }
        | Change::Patch { kind, id, .. }
        | Change::Delete { kind, id } => (*kind, id.clone()),
    }
}

/// The field that moves a record, checked against deleted parents on rebase.
fn move_field(kind: Kind) -> Option<&'static str> {
    match kind {
        Kind::View => Some("placement"),
        Kind::Tab => Some("window_id"),
        _ => None,
    }
}

/// Folds the queue after its first `protected` changes: an in-flight op
/// carried those, and its acknowledgment drains them by count. Returns how
/// many changes were removed.
pub fn fold(desired: &mut Desired, protected: usize) -> usize {
    let tracked: usize = desired.batches.iter().map(|b| b.len).sum();
    // Changes queued before batches were recorded have no known base.
    if tracked != desired.changes.len() {
        return 0;
    }
    let (mut start, mut first) = (0, 0);
    while first < desired.batches.len() && start < protected {
        start += desired.batches[first].len;
        first += 1;
    }
    if first == desired.batches.len() {
        return 0;
    }
    // Adjacent batches made against the same version are one batch.
    let mut groups: Vec<(u64, Vec<Option<Change>>)> = Vec::new();
    let mut at = start;
    for batch in &desired.batches[first..] {
        let changes = desired.changes[at..at + batch.len]
            .iter()
            .cloned()
            .map(Some);
        at += batch.len;
        match groups.last_mut() {
            Some((base, group)) if *base == batch.base => group.extend(changes),
            _ => groups.push((batch.base, changes.collect())),
        }
    }
    let mut removed = 0;
    // Surviving positions of each record's changes, oldest first.
    let mut seen: BTreeMap<Key, Vec<(usize, usize)>> = BTreeMap::new();
    for g in 0..groups.len() {
        for i in 0..groups[g].1.len() {
            let change = groups[g].1[i].take().expect("unvisited");
            let key = key(&change);
            let positions = seen.entry(key.clone()).or_default();
            let last = positions.last().copied();
            let keep = match (&change, last) {
                (Change::Delete { .. }, _) => {
                    for (pg, pi) in positions.drain(..) {
                        groups[pg].1[pi] = None;
                        removed += 1;
                    }
                    true
                }
                (Change::Patch { fields, .. }, Some((pg, pi))) => match &mut groups[pg].1[pi] {
                    Some(Change::Delete { .. }) => false,
                    Some(Change::Patch {
                        fields: earlier, ..
                    }) if pg == g
                        && move_field(key.0).is_none_or(|f| {
                            !(earlier.contains_key(f) && fields.contains_key(f))
                        }) =>
                    {
                        earlier.extend(fields.clone());
                        false
                    }
                    _ => true,
                },
                (Change::Create { .. }, Some((pg, pi))) => {
                    !(pg == g && matches!(groups[pg].1[pi], Some(Change::Create { .. })))
                }
                _ => true,
            };
            if keep {
                groups[g].1[i] = Some(change);
                positions.push((g, i));
            } else {
                removed += 1;
            }
        }
    }
    if removed == 0 {
        return 0;
    }
    desired.changes.truncate(start);
    desired.batches.truncate(first);
    for (base, group) in groups {
        let survivors: Vec<Change> = group.into_iter().flatten().collect();
        if !survivors.is_empty() {
            desired.batches.push(Batch {
                len: survivors.len(),
                base,
            });
            desired.changes.extend(survivors);
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::ViewRecord;
    use rand::{Rng, SeedableRng};
    use serde_json::json;

    fn fields(value: serde_json::Value) -> crate::document::entities::Fields {
        serde_json::from_value(value).unwrap()
    }

    fn window(id: &str) -> Change {
        Change::Create {
            kind: Kind::Window,
            id: id.into(),
            fields: fields(json!({"title": "", "order": 0})),
        }
    }

    fn rename(id: &str, title: &str) -> Change {
        Change::Patch {
            kind: Kind::Window,
            id: id.into(),
            fields: fields(json!({ "title": title })),
        }
    }

    fn close(id: &str) -> Change {
        Change::Delete {
            kind: Kind::Window,
            id: id.into(),
        }
    }

    fn queue(batches: Vec<(u64, Vec<Change>)>) -> Desired {
        let mut desired = Desired::default();
        for (base, changes) in batches {
            desired.push_batch(changes, base);
        }
        desired
    }

    fn rebased(
        records: &[ViewRecord],
        desired: &Desired,
        tombstones: &BTreeMap<Key, u64>,
    ) -> Option<Vec<ViewRecord>> {
        super::super::model::rebase_batches(records, &desired.batches(), tombstones).ok()
    }

    #[test]
    fn open_then_close_leaves_only_the_close() {
        // The example from the plan: tab 1 opens, tab 2 closes, tab 1 closes.
        let mut desired = queue(vec![
            (3, vec![window("one")]),
            (3, vec![close("two")]),
            (3, vec![close("one")]),
        ]);
        assert_eq!(fold(&mut desired, 0), 1);
        assert_eq!(desired.changes.len(), 2);
        assert!(desired
            .changes
            .iter()
            .all(|c| matches!(c, Change::Delete { .. })));
        assert_eq!(desired.batches, vec![Batch { len: 2, base: 3 }]);
    }

    #[test]
    fn renames_merge_but_not_across_versions_or_into_what_is_in_flight() {
        let mut desired = queue(vec![
            (1, vec![rename("w", "a")]),
            (1, vec![rename("w", "b")]),
            (2, vec![rename("w", "c")]),
            (2, vec![rename("w", "d")]),
        ]);
        // The first edit is in flight: it stays as sent. "b" was made against
        // version 1 and "c" against 2, so only "d" folds (into "c").
        assert_eq!(fold(&mut desired, 1), 1);
        assert_eq!(
            desired.batches,
            vec![
                Batch { len: 1, base: 1 },
                Batch { len: 1, base: 1 },
                Batch { len: 1, base: 2 }
            ]
        );
        assert!(
            matches!(&desired.changes[2], Change::Patch { fields, .. } if fields["title"] == "d")
        );
    }

    #[test]
    fn two_moves_of_one_view_stay_separate() {
        let mv = |layout: &str| Change::Patch {
            kind: Kind::View,
            id: "v".into(),
            fields: fields(json!({"placement": {"layout_id": layout, "pane_id": "p", "order": 0}})),
        };
        let mut desired = queue(vec![(1, vec![mv("a"), mv("b")])]);
        assert_eq!(fold(&mut desired, 0), 0);
    }

    #[test]
    fn a_folded_queue_rebases_like_the_original() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(7);
        let ids = ["a", "b", "c"];
        for _ in 0..500 {
            let mut batches = Vec::new();
            let mut base = 0;
            for _ in 0..rng.gen_range(1..8) {
                base += rng.gen_range(0..2);
                let changes = (0..rng.gen_range(1..4))
                    .map(|_| {
                        let id = ids[rng.gen_range(0..ids.len())];
                        match rng.gen_range(0..3) {
                            0 => window(id),
                            1 => rename(id, &rng.gen_range(0..9).to_string()),
                            _ => close(id),
                        }
                    })
                    .collect();
                batches.push((base, changes));
            }
            let records: Vec<ViewRecord> = ids
                .iter()
                .filter(|_| rng.gen_bool(0.5))
                .map(|id| ViewRecord {
                    kind: Kind::Window,
                    id: (*id).into(),
                    fields: fields(json!({"title": "server", "order": 0})),
                })
                .collect();
            let mut tombstones: BTreeMap<Key, u64> = BTreeMap::new();
            for id in ids {
                if rng.gen_bool(0.3) {
                    tombstones.insert((Kind::Window, id.to_owned()), rng.gen_range(0..base + 2));
                }
            }
            let original = queue(batches);
            let mut folded = original.clone();
            fold(&mut folded, 0);
            assert!(
                rebased(&records, &original, &tombstones)
                    == rebased(&records, &folded, &tombstones)
            );
        }
    }
}
