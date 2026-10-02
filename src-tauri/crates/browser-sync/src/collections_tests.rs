use serde_json::json;

use super::*;
use crate::document::entities::Kind;

fn scope() -> VaultScope {
    VaultScope {
        deployment: "https://sync.example.test".into(),
        account_id: "account".into(),
        vault_id: "01951d32-40ac-7000-8000-000000000001".into(),
    }
}

fn bookmark(id: &str, title: &str) -> ViewRecord {
    ViewRecord {
        kind: Kind::Bookmark,
        id: id.into(),
        fields: serde_json::from_value(json!({"title": title})).unwrap(),
    }
}

#[test]
fn a_record_opens_only_under_the_key_and_version_it_was_sealed_for() {
    let root = VaultRoot::generate();
    let scope = scope();
    let record = bookmark("b1", "Docs");
    let key = record_key(&root, &scope, BOOKMARKS, "b1").unwrap();
    assert_eq!(key.len(), 64);
    assert_ne!(key, record_key(&root, &scope, TAB_GROUPS, "b1").unwrap());
    let sealed = seal(&root, &scope, BOOKMARKS, 3, &record).unwrap();
    let resealed = seal(&root, &scope, BOOKMARKS, 3, &record).unwrap();
    assert_ne!(&sealed[..12], &resealed[..12]);
    assert!(open(&root, &scope, BOOKMARKS, &key, 3, &resealed).unwrap() == record);
    assert!(open(&root, &scope, BOOKMARKS, &key, 3, &sealed).unwrap() == record);
    // Replayed as an older version, or filed under another record: rejected.
    assert!(open(&root, &scope, BOOKMARKS, &key, 2, &sealed).is_err());
    let other = record_key(&root, &scope, BOOKMARKS, "b2").unwrap();
    assert!(open(&root, &scope, BOOKMARKS, &other, 3, &sealed).is_err());
    assert_ne!(key, record_key(&root, &scope, HISTORY, "b1").unwrap());
    assert!(record_key(&root, &scope, "unknown", "b1").is_err());
}

#[test]
fn pending_writes_show_immediately_and_settle_on_the_servers_answer() {
    let mut c = Collection::default();
    c.pulled("k1".into(), 1, Some(bookmark("b1", "Docs")));
    c.write("k1".into(), Some(bookmark("b1", "Renamed")));
    c.write("k2".into(), Some(bookmark("b2", "New")));
    let titles: Vec<_> = c.view().iter().map(|r| r.fields["title"].clone()).collect();
    assert_eq!(titles, [json!("Renamed"), json!("New")]);
    let out = c.outgoing();
    assert_eq!(
        out.iter().map(|w| w.base_version).collect::<Vec<_>>(),
        [1, 0]
    );

    // k1 lost to another device's edit at version 2: retried on it.
    c.answered(
        "k1",
        false,
        2,
        Some(Confirmed {
            version: 2,
            record: Some(bookmark("b1", "Theirs")),
        }),
    );
    assert_eq!(c.outgoing()[0].base_version, 2);
    // k2 applied.
    c.answered("k2", true, 1, None);
    assert!(c.pending.get("k2").is_none());
    assert_eq!(c.confirmed["k2"].version, 1);
}

#[test]
fn an_edit_never_recreates_a_record_another_device_deleted() {
    let mut c = Collection::default();
    c.pulled("k1".into(), 1, Some(bookmark("b1", "Docs")));
    c.write("k1".into(), Some(bookmark("b1", "Renamed")));
    // Deleted elsewhere before this edit reached the server.
    c.pulled("k1".into(), 2, None);
    assert!(c.pending.is_empty());
    assert!(c.view().is_empty());
    assert!(c.deleted("k1"));
}

#[test]
fn tab_groups_validate_and_route_to_their_collection() {
    use crate::document::entities::validate;
    use crate::workspace::model::collection_of;
    let fields = |v: serde_json::Value| serde_json::from_value(v).unwrap();
    assert!(validate(
        Kind::TabGroup,
        &fields(json!({"name": "Work", "color": "blue", "order": 0, "layout_ids": ["l1"]}))
    )
    .is_ok());
    assert!(validate(
        Kind::TabGroup,
        &fields(json!({"name": "Work", "color": "violet", "order": 0, "layout_ids": []}))
    )
    .is_err());
    assert!(validate(
        Kind::SavedTabGroup,
        &fields(json!({"name": "Trip", "color": "gray", "order": 1, "layouts": "[]"}))
    )
    .is_ok());
    assert!(validate(
        Kind::SavedTabGroup,
        &fields(json!({"name": "Trip", "color": "gray", "order": 1, "layouts": "{}"}))
    )
    .is_err());
    // Open groups live in the device's workspace; saved ones in their collection.
    assert_eq!(collection_of(Kind::TabGroup), None);
    assert_eq!(collection_of(Kind::SavedTabGroup), Some(TAB_GROUPS));
    assert_eq!(collection_of(Kind::Bookmark), Some(BOOKMARKS));
}
