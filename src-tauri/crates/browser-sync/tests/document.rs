use misty_browser_sync::{
    document::{self, entities::Kind, Document},
    protocol::EventContext,
};
use serde_json::{json, Value};
use uuid::Uuid;

const MAC: &str = "01951d32-40ac-7000-8000-000000000001";
const WINDOWS: &str = "01951d32-40ac-7000-8000-000000000002";

fn apply(document: &Document, payload: Value, device: &str) -> Document {
    let context = EventContext {
        sequence: document.sequence + 1,
        operation_id: Uuid::new_v4().to_string(),
        device_id: device.into(),
    };
    let encoded = document::reduce(
        &document.encode().unwrap(),
        &serde_json::to_vec(&payload).unwrap(),
        &context,
    )
    .unwrap();
    serde_json::from_slice(&encoded).unwrap()
}

fn changes(changes: Value) -> Value {
    json!({"kind":"workspace","version":1,"changes":changes})
}

#[test]
fn concurrent_group_edits_merge_by_field_and_deletion_wins_over_offline_edits() {
    let initial = apply(
        &Document::default(),
        changes(json!([
            {"action":"create","kind":"group","id":"social","fields":{"label":"Social","icon":"messages","order":0,"hidden":false}}
        ])),
        MAC,
    );
    let rename = changes(
        json!([{"action":"patch","kind":"group","id":"social","fields":{"label":"Friends"}}]),
    );
    let hide =
        changes(json!([{"action":"patch","kind":"group","id":"social","fields":{"hidden":true}}]));
    let left = apply(&apply(&initial, rename.clone(), MAC), hide.clone(), WINDOWS);
    let right = apply(&apply(&initial, hide, WINDOWS), rename, MAC);
    assert_eq!(
        left.live(Kind::Group, "social").unwrap().values(),
        right.live(Kind::Group, "social").unwrap().values()
    );
    assert_eq!(
        left.live(Kind::Group, "social").unwrap().values()["label"],
        "Friends"
    );
    assert_eq!(
        left.live(Kind::Group, "social").unwrap().values()["hidden"],
        true
    );
    let last = apply(
        &left,
        changes(
            json!([{"action":"patch","kind":"group","id":"social","fields":{"label":"People"}}]),
        ),
        WINDOWS,
    );
    assert_eq!(
        last.live(Kind::Group, "social").unwrap().values()["label"],
        "People"
    );
    let deleted = apply(
        &last,
        changes(json!([{"action":"delete","kind":"group","id":"social"}])),
        WINDOWS,
    );
    let stale = apply(
        &deleted,
        changes(json!([
            {"action":"patch","kind":"group","id":"social","fields":{"label":"Offline rename"}},
            {"action":"create","kind":"group","id":"social","fields":{"label":"Social","icon":"messages","order":0,"hidden":false}}
        ])),
        MAC,
    );
    assert!(stale.live(Kind::Group, "social").is_none());
}

fn browser_tab(id: &str, pane: &str) -> Value {
    json!({"action":"create","kind":"tab","id":id,"fields":{
        "surface":"browser","title":id,"placement":{"layout_id":"layout:one","pane_id":pane,"order":0},
        "url":"https://example.test","profile_id":"a".repeat(64),"website_id":null,"tool_route":null,"agent_owned":false
    }})
}

#[test]
fn competing_split_changes_preserve_views_and_do_not_restore_deleted_windows() {
    let initial = apply(
        &Document::default(),
        changes(json!([
            {"action":"create","kind":"window","id":"window:one","fields":{"title":"Work","order":0}},
            {"action":"create","kind":"layout","id":"layout:one","fields":{"window_id":"window:one","title":"","order":0,"tree":{"type":"leaf","id":"pane:one"}}},
            browser_tab("tab:one","pane:one")
        ])),
        MAC,
    );
    let split = |pane: &str, tab: &str| {
        changes(json!([
            browser_tab(tab,pane),
            {"action":"patch","kind":"layout","id":"layout:one","fields":{"tree":{
                "type":"split","id":"split:one","direction":"horizontal","ratio":0.5,
                "first":{"type":"leaf","id":"pane:one"},"second":{"type":"leaf","id":pane}
            }}}
        ]))
    };
    let mac = apply(&initial, split("pane:two", "tab:two"), MAC);
    let merged = apply(&mac, split("pane:three", "tab:three"), WINDOWS);
    assert_eq!(merged.orphaned_tabs().unwrap(), vec!["tab:two"]);
    for tab in ["tab:one", "tab:two", "tab:three"] {
        assert!(merged.live(Kind::Tab, tab).is_some());
    }
    let closed = apply(
        &merged,
        changes(json!([{"action":"delete","kind":"window","id":"window:one"}])),
        MAC,
    );
    assert!(closed.live(Kind::Window, "window:one").is_none());
    assert_eq!(closed.orphaned_tabs().unwrap().len(), 3);
}

fn credential(updates: Value) -> Value {
    json!({"kind":"credentials","version":1,"batch":{"profile_id":"a".repeat(64),"updates":updates}})
}

#[test]
fn credential_rotation_is_atomic_and_old_offline_tokens_cannot_undo_logout() {
    let first = apply(
        &Document::default(),
        credential(json!([
            {"area":{"kind":"local_storage","origin":"https://accounts.example.test"},"base_sequence":0,"payload":{"token":"v1"}},
            {"area":{"kind":"session_storage","origin":"https://accounts.example.test","tab_id":"tab:one"},"base_sequence":0,"payload":{"nonce":"n1"}}
        ])),
        MAC,
    );
    let rotated = apply(
        &first,
        credential(json!([
            {"area":{"kind":"local_storage","origin":"https://accounts.example.test"},"base_sequence":1,"payload":{"token":"v2"}}
        ])),
        WINDOWS,
    );
    let stale = apply(
        &rotated,
        credential(json!([
            {"area":{"kind":"local_storage","origin":"https://accounts.example.test"},"base_sequence":1,"payload":{"token":"old-offline-token"}},
            {"area":{"kind":"session_storage","origin":"https://accounts.example.test","tab_id":"tab:one"},"base_sequence":1,"payload":{"nonce":"old-offline-nonce"}}
        ])),
        MAC,
    );
    assert_eq!(
        stale.sequence, 3,
        "rejected credentials still advance the committed log"
    );
    let payloads: Vec<_> = stale
        .credentials
        .values()
        .map(|v| v.payload.clone())
        .collect();
    assert!(payloads.contains(&json!({"token":"v2"})));
    assert!(
        payloads.contains(&json!({"nonce":"n1"})),
        "no part of a stale batch may apply"
    );
    assert!(stale.rejected_credentials_by_device.contains_key(MAC));
    let logout = apply(
        &stale,
        credential(json!([
            {"area":{"kind":"local_storage","origin":"https://accounts.example.test"},"base_sequence":2,"payload":{}},
            {"area":{"kind":"session_storage","origin":"https://accounts.example.test","tab_id":"tab:one"},"base_sequence":1,"payload":{}}
        ])),
        WINDOWS,
    );
    let reconnect = apply(
        &logout,
        credential(json!([
            {"area":{"kind":"local_storage","origin":"https://accounts.example.test"},"base_sequence":2,"payload":{"token":"v2"}}
        ])),
        MAC,
    );
    assert!(reconnect
        .credentials
        .values()
        .all(|v| v.payload == json!({})));
}

#[test]
fn origin_profile_and_tab_storage_remain_separate() {
    let document = apply(
        &Document::default(),
        credential(json!([
            {"area":{"kind":"local_storage","origin":"https://one.example.test"},"base_sequence":0,"payload":{"token":"one"}},
            {"area":{"kind":"local_storage","origin":"https://two.example.test"},"base_sequence":0,"payload":{"token":"two"}},
            {"area":{"kind":"session_storage","origin":"https://one.example.test","tab_id":"tab:one"},"base_sequence":0,"payload":{"token":"tab-one"}},
            {"area":{"kind":"session_storage","origin":"https://one.example.test","tab_id":"tab:two"},"base_sequence":0,"payload":{"token":"tab-two"}}
        ])),
        MAC,
    );
    assert_eq!(document.credentials.len(), 4);
    let renderer = serde_json::to_value(document.workspace_view().unwrap()).unwrap();
    assert!(renderer.get("credentials").is_none());
    assert!(
        !renderer.to_string().contains("token"),
        "credential values must never cross the workspace renderer boundary"
    );
    let mut other = credential(
        json!([{"area":{"kind":"local_storage","origin":"https://one.example.test"},"base_sequence":0,"payload":{"token":"other-profile"}}]),
    );
    other["batch"]["profile_id"] = json!("b".repeat(64));
    assert_eq!(apply(&document, other, WINDOWS).credentials.len(), 5);
}

#[test]
fn resume_records_are_owned_by_sender_and_never_become_global_focus() {
    let resume = |id: &str| {
        json!({"kind":"resume","version":1,"resume":{
            "active_window_id":id,"active_layout_id":"layout:one","focused_pane_id":"pane:one","active_tab_by_pane":{"pane:one":"tab:one"}
        }})
    };
    let mac = apply(&Document::default(), resume("window:mac"), MAC);
    let both = apply(&mac, resume("window:windows"), WINDOWS);
    assert_eq!(both.resumes[MAC].resume.active_window_id, "window:mac");
    assert_eq!(
        both.resumes[WINDOWS].resume.active_window_id,
        "window:windows"
    );
    assert!(both.records.is_empty());
}

#[test]
fn malformed_geometry_retired_surfaces_and_local_focus_fields_are_rejected() {
    for payload in [
        changes(
            json!([{"action":"create","kind":"window","id":"window:one","fields":{"title":"","order":0,"focused_pane_id":"pane:one"}}]),
        ),
        changes(
            json!([{"action":"create","kind":"layout","id":"layout:one","fields":{"window_id":"window:one","title":"","order":0,"tree":{
                "type":"split","id":"split:one","direction":"horizontal","ratio":0.5,"first":{"type":"leaf","id":"duplicate"},"second":{"type":"leaf","id":"duplicate"}
            }}}]),
        ),
        {
            let mut tab = browser_tab("tab:one", "pane:one");
            tab["fields"]["surface"] = json!("space");
            changes(json!([tab]))
        },
        credential(
            json!([{"area":{"kind":"local_storage","origin":"https://example.test/path"},"base_sequence":0,"payload":{"token":"bad-origin"}}]),
        ),
    ] {
        let context = EventContext {
            sequence: 1,
            operation_id: Uuid::new_v4().to_string(),
            device_id: MAC.into(),
        };
        assert!(document::reduce(
            &Document::default().encode().unwrap(),
            &serde_json::to_vec(&payload).unwrap(),
            &context
        )
        .is_err());
    }
}

#[test]
fn space_routes_survive_native_sync_round_trip() {
    let initial = apply(
        &Document::default(),
        changes(json!([{
            "action":"create", "kind":"tab", "id":"space-tab", "fields": {
                "surface":"space", "title":"Project planner",
                "placement":{"layout_id":"layout-a","pane_id":"pane-a","order":0},
                "url":null, "profile_id":null, "website_id":null,
                "tool_route":"/spaces/project/planner/tasks/list", "agent_owned":false
            }
        }])), MAC,
    );
    let updated = apply(&initial, changes(json!([{
        "action":"patch", "kind":"tab", "id":"space-tab",
        "fields":{"tool_route":"/spaces/project/library?collection=recent"}
    }])), WINDOWS);
    let restored: Document = serde_json::from_slice(&updated.encode().unwrap()).unwrap();
    let fields = restored.live(Kind::Tab, "space-tab").unwrap().values();
    assert_eq!(fields["surface"], "space");
    assert_eq!(fields["tool_route"], "/spaces/project/library?collection=recent");
    assert!(fields["profile_id"].is_null());
}
