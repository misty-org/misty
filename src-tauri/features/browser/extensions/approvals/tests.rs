use super::*;
use crate::browser::extensions::catalog::{CatalogEntry, Store};
use serde_json::json;

fn set(values: &[&str]) -> BTreeSet<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}
fn list(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}
fn review(permissions: &[&str], hosts: &[&str]) -> Review {
    Review {
        token: "token".into(),
        entry: CatalogEntry {
            id: "ddkjiahejlhfcafbddmgiahcphecmpfh".into(),
            store: Store::Chrome,
            guid: "ddkjiahejlhfcafbddmgiahcphecmpfh".into(),
            slug: String::new(),
            name: "Fixture".into(),
            summary: String::new(),
            description: String::new(),
            authors: Vec::new(),
            icon_url: String::new(),
            version: "1".into(),
            users: 0,
            rating: 0.0,
            source_url: String::new(),
            download_url: String::new(),
            digest: "sha256:0".into(),
        },
        permissions: list(permissions),
        hosts: list(hosts),
        optional_permissions: Vec::new(),
        optional_hosts: Vec::new(),
        findings: Vec::new(),
        blocked: false,
        private_allowed: true,
        has_options: false,
        manifest_version: 3,
        added_permissions: Vec::new(),
        added_hosts: Vec::new(),
    }
}
fn installation(permissions: &[&str], hosts: &[&str], private_access: bool) -> Installation {
    Installation {
        id: "ddkjiahejlhfcafbddmgiahcphecmpfh".into(),
        guid: "ddkjiahejlhfcafbddmgiahcphecmpfh".into(),
        generation: "01951d32-40ac-7000-8000-000000000001".into(),
        name: "Fixture".into(),
        installed: true,
        enabled: true,
        private_access,
        agent_access: false,
        permissions: list(permissions),
        hosts: list(hosts),
    }
}
fn approval(permissions: &[&str], hosts: &[&str]) -> Approval {
    Approval {
        permissions: set(permissions),
        hosts: set(hosts),
    }
}
fn database() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    database::store::migrate(&mut connection).unwrap();
    connection
}

#[test]
fn nothing_runs_without_a_record_and_an_update_asking_for_more_waits() {
    let asked = review(&["storage"], &["https://a.test/*"]);
    assert!(needs_review(None, &asked));
    let approved = approval(&["storage"], &["https://a.test/*"]);
    assert!(!needs_review(Some(&approved), &asked));
    // The same version or a narrower one applies by itself.
    assert!(!needs_review(Some(&approved), &review(&[], &[])));
    // Each kind of widening waits.
    for wider in [
        review(&["storage", "tabs"], &["https://a.test/*"]),
        review(&["storage"], &["https://a.test/*", "https://b.test/*"]),
        review(&["storage"], &["<all_urls>"]),
    ] {
        assert!(needs_review(Some(&approved), &wider));
    }
    // A package Misty can't run waits whatever was approved.
    let mut blocked = asked.clone();
    blocked.blocked = true;
    assert!(needs_review(Some(&approved), &blocked));
}

#[test]
fn what_is_new_is_only_what_was_not_approved() {
    let approved = approval(&["storage"], &["https://a.test/*"]);
    let (permissions, hosts) = approved.added(&review(
        &["storage", "tabs"],
        &["https://a.test/*", "<all_urls>"],
    ));
    assert_eq!(permissions, ["tabs"]);
    assert_eq!(hosts, ["<all_urls>"]);
    let (permissions, hosts) =
        Approval::default().added(&review(&["storage"], &["https://a.test/*"]));
    assert_eq!(permissions, ["storage"]);
    assert_eq!(hosts, ["https://a.test/*"]);
}

#[test]
fn a_list_cannot_run_wider_than_the_approval() {
    let granted = effective(
        &installation(
            &["storage", "tabs", "nativeMessaging"],
            &["https://a.test/*", "<all_urls>"],
            false,
        ),
        &approval(&["storage"], &["https://a.test/*"]),
        &review(
            &["storage", "tabs", "nativeMessaging"],
            &["https://a.test/*", "<all_urls>"],
        ),
    );
    assert_eq!(granted.permissions, ["storage"]);
    assert_eq!(granted.hosts, ["https://a.test/*"]);
}

#[test]
fn removed_access_stays_removed_and_old_grants_do_not_carry_past_the_manifest() {
    let approved = approval(
        &["storage", "tabs"],
        &["https://a.test/*", "https://b.test/*"],
    );
    // The person removed tabs and b.test here.
    let granted = effective(
        &installation(&["storage"], &["https://a.test/*"], false),
        &approved,
        &review(
            &["storage", "tabs"],
            &["https://a.test/*", "https://b.test/*"],
        ),
    );
    assert_eq!(granted.permissions, ["storage"]);
    assert_eq!(granted.hosts, ["https://a.test/*"]);
    // A new version that stopped declaring something doesn't get it from the old list.
    let granted = effective(
        &installation(&["storage", "tabs"], &["https://a.test/*"], false),
        &approved,
        &review(&["storage"], &[]),
    );
    assert_eq!(granted.permissions, ["storage"]);
    assert!(granted.hosts.is_empty());
    // Optional access the person allowed while it ran still counts as declared.
    let mut optional = review(&["storage"], &[]);
    optional.optional_permissions = list(&["tabs"]);
    optional.optional_hosts = list(&["https://b.test/*"]);
    let granted = effective(
        &installation(&["storage", "tabs"], &["https://b.test/*"], false),
        &approved,
        &optional,
    );
    assert_eq!(granted.permissions, ["storage", "tabs"]);
    assert_eq!(granted.hosts, ["https://b.test/*"]);
}

#[test]
fn private_tabs_need_the_person_and_the_manifest() {
    let approved = approval(&[], &[]);
    let mut asked = review(&[], &[]);
    assert!(effective(&installation(&[], &[], true), &approved, &asked).private_access);
    assert!(!effective(&installation(&[], &[], false), &approved, &asked).private_access);
    asked.private_allowed = false;
    assert!(!effective(&installation(&[], &[], true), &approved, &asked).private_access);
}

#[test]
fn approvals_are_kept_per_profile_and_only_grow_until_forgotten() {
    let connection = database();
    assert_eq!(read_from(&connection, "local", "a").unwrap(), None);
    add_to(&connection, "local", "a", &list(&["storage"]), &[]).unwrap();
    add_to(
        &connection,
        "local",
        "a",
        &list(&["tabs"]),
        &list(&["<all_urls>"]),
    )
    .unwrap();
    assert_eq!(
        read_from(&connection, "local", "a").unwrap(),
        Some(approval(&["storage", "tabs"], &["<all_urls>"]))
    );
    assert_eq!(
        read_from(&connection, "local:space:work", "a").unwrap(),
        None
    );
    assert_eq!(read_from(&connection, "local", "b").unwrap(), None);
}

#[test]
fn a_running_request_records_only_what_webkit_said_it_asked_for() {
    let request = uuid::Uuid::new_v4().to_string();
    observe_request(&json!({
        "kind": "permission-request",
        "requestId": request,
        "guid": "guid",
        "permissions": ["tabs"],
        "hosts": ["https://a.test/*"],
    }));
    assert_eq!(
        take_request(&request),
        Some((
            "guid".to_owned(),
            list(&["tabs"]),
            list(&["https://a.test/*"])
        ))
    );
    // An answer is good once, and an answer nobody asked for records nothing.
    assert_eq!(take_request(&request), None);
    assert_eq!(take_request("made up"), None);
    // A question that timed out can't be approved later.
    observe_request(&json!({"kind": "permission-request", "requestId": request, "guid": "guid"}));
    observe_request(&json!({"kind": "permission-expired", "requestId": request}));
    assert_eq!(take_request(&request), None);
}
