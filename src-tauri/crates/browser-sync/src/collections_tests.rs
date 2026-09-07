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
        &Some(bookmark("b1", "Renamed")),
        false,
        2,
        Some(Confirmed {
            version: 2,
            record: Some(bookmark("b1", "Theirs")),
        }),
    );
    assert_eq!(c.outgoing()[0].base_version, 2);
    // k2 applied.
    c.answered("k2", &Some(bookmark("b2", "New")), true, 1, None);
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

#[test]
fn extension_values_are_encrypted_in_their_own_collection() {
    let root=VaultRoot::generate(); let scope=scope();
    let fields=serde_json::from_value(json!({"extension":"fixture@misty.test","generation":"01951d32-40ac-7000-8000-000000000001","key":"setting","change":{"value":"private value"}})).unwrap();
    assert!(crate::document::entities::validate(Kind::ExtensionSyncKey,&fields).is_ok());
    assert_eq!(crate::workspace::model::collection_of(Kind::ExtensionSyncKey),Some(EXTENSION_SYNC));
    let record=ViewRecord {kind:Kind::ExtensionSyncKey,id:"fixture-key".into(),fields};
    let key=record_key(&root,&scope,EXTENSION_SYNC,&record.id).unwrap();
    let sealed=seal(&root,&scope,EXTENSION_SYNC,1,&record).unwrap();
    assert!(!sealed.windows(b"private value".len()).any(|v|v==b"private value"));
    assert!(open(&root,&scope,EXTENSION_SYNC,&key,1,&sealed).unwrap()==record);
    assert!(open(&root,&scope,BOOKMARKS,&key,1,&sealed).is_err());
}
#[test]
fn extension_removal_is_separate_from_stale_key_edits_and_new_installs() {
    let mut collection=Collection::default();
    let record=|kind,id:&str,generation:&str,change:Option<serde_json::Value>| {
        let mut fields=std::collections::BTreeMap::from([("extension".into(),json!("fixture@misty.test")),("generation".into(),json!(generation))]);
        if let Some(change)=change { fields.insert("key".into(),json!("setting")); fields.insert("change".into(),change); }
        ViewRecord {kind,id:id.into(),fields}
    };
    let generation="01951d32-40ac-7000-8000-000000000001";
    let removed=record(Kind::ExtensionRemoval,"removed",generation,None);
    assert!(crate::document::entities::validate(removed.kind,&removed.fields).is_ok());
    collection.pulled("removed".into(),1,Some(removed));
    collection.write("stale-key".into(),Some(record(Kind::ExtensionSyncKey,"old",generation,Some(json!({"value":"offline edit"})))));
    collection.write("new-key".into(),Some(record(Kind::ExtensionSyncKey,"new","01951d32-40ac-7000-8000-000000000002",Some(json!({"value":"new install"})))));
    assert!(collection.view().iter().any(|v|v.kind==Kind::ExtensionRemoval && v.fields["generation"]==generation));
    assert!(collection.view().iter().any(|v|v.fields["generation"]=="01951d32-40ac-7000-8000-000000000002"));
}

#[test]
fn deleting_a_record_the_server_never_had_sends_nothing() {
    let mut c = Collection::default();
    c.pulled("k1".into(), 1, Some(bookmark("b1", "Docs")));
    assert!(c.queue("k2".into(), Some(bookmark("b2", "New")), true));
    assert!(!c.queue("k2".into(), None, true));
    assert!(c.outgoing().is_empty());
    // A push may still land the create: the delete stays queued.
    assert!(c.queue("k3".into(), Some(bookmark("b3", "New")), true));
    assert!(c.queue("k3".into(), None, false));
    assert_eq!(c.outgoing().len(), 1);
    // A record on the server always needs its delete.
    assert!(c.queue("k1".into(), None, true));
    assert_eq!(c.outgoing().len(), 2);
}

#[test]
fn an_edit_made_while_a_push_is_in_flight_goes_next() {
    let mut c = Collection::default();
    c.pulled("k1".into(), 1, Some(bookmark("b1", "Docs")));
    c.write("k1".into(), Some(bookmark("b1", "First")));
    let sent = c.outgoing().remove(0);
    assert_eq!(sent.base_version, 1);
    // Edited again before the push is answered.
    c.write("k1".into(), Some(bookmark("b1", "Second")));
    c.answered("k1", &sent.record, true, 2, None);
    // The server holds the first edit; the second still goes, on version 2.
    assert!(c.confirmed["k1"].record == Some(bookmark("b1", "First")));
    assert_eq!(c.confirmed["k1"].version, 2);
    let out = c.outgoing();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].base_version, 2);
    assert!(out[0].record == Some(bookmark("b1", "Second")));
    assert_eq!(c.view()[0].fields["title"], json!("Second"));
    // The second push settles the record.
    c.answered("k1", &out[0].record, true, 3, None);
    assert!(c.pending.is_empty());
    assert_eq!(c.confirmed["k1"].version, 3);
}

#[test]
fn a_delete_made_while_a_create_is_in_flight_goes_next() {
    let mut c = Collection::default();
    c.loaded = true;
    assert!(c.queue("k1".into(), Some(bookmark("b1", "New")), true));
    let sent = c.outgoing().remove(0);
    // A push is in flight, so the delete is not settled away.
    assert!(c.queue("k1".into(), None, false));
    c.answered("k1", &sent.record, true, 1, None);
    let out = c.outgoing();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].base_version, 1);
    assert!(out[0].record.is_none());
    assert!(c.view().is_empty());
}

#[test]
fn an_edit_made_while_a_losing_push_is_in_flight_retries_on_the_servers_copy() {
    let mut c = Collection::default();
    c.pulled("k1".into(), 1, Some(bookmark("b1", "Docs")));
    c.write("k1".into(), Some(bookmark("b1", "First")));
    let sent = c.outgoing().remove(0);
    c.write("k1".into(), Some(bookmark("b1", "Second")));
    c.answered(
        "k1",
        &sent.record,
        false,
        2,
        Some(Confirmed {
            version: 2,
            record: Some(bookmark("b1", "Theirs")),
        }),
    );
    let out = c.outgoing();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].base_version, 2);
    assert!(out[0].record == Some(bookmark("b1", "Second")));
}
