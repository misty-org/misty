use std::collections::BTreeSet;

use rusqlite::Connection;

use super::store::{read_answer, write_answer};
use super::{Permission, PROCESS_PERMISSIONS};

const PERMISSIONS: &str = include_str!("../../../sandbox/permissions/permissions.toml");

fn identifiers(toml: &str) -> BTreeSet<String> {
    toml.lines()
        .filter_map(|line| line.strip_prefix("identifier = \""))
        .map(|name| name.trim_end_matches('"').to_owned())
        .collect()
}

#[test]
fn the_list_matches_permissions_toml() {
    let listed: BTreeSet<String> = Permission::ALL
        .into_iter()
        .map(|permission| permission.id().to_owned())
        .chain(PROCESS_PERMISSIONS.map(str::to_owned))
        .collect();
    assert_eq!(listed, identifiers(PERMISSIONS));
}

#[test]
fn ids_and_scopes_are_unique_and_round_trip() {
    let scopes: BTreeSet<&str> = Permission::ALL.iter().map(|p| p.scope()).collect();
    assert_eq!(scopes.len(), Permission::ALL.len());
    for permission in Permission::ALL {
        assert_eq!(Permission::from_id(permission.id()), Some(permission));
        assert!(permission.scope().starts_with("permission:"));
        assert!(crate::infra::settings::profile_store::is_protected_scope(
            permission.scope()
        ));
    }
    assert_eq!(Permission::from_id("permission-agent-shell"), None);
}

fn database() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch(
            "CREATE TABLE settings_state (
               scope TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL)",
        )
        .unwrap();
    connection
}

#[test]
fn off_until_answered_and_a_no_stays_off() {
    let connection = database();
    let scope = Permission::ScreenCapture.scope();
    assert!(!read_answer(&connection, scope).unwrap());
    write_answer(&connection, scope, false).unwrap();
    assert!(!read_answer(&connection, scope).unwrap());
    write_answer(&connection, scope, true).unwrap();
    assert!(read_answer(&connection, scope).unwrap());
    write_answer(&connection, scope, false).unwrap();
    assert!(!read_answer(&connection, scope).unwrap());
}

#[test]
fn only_true_counts_as_yes() {
    let connection = database();
    connection
        .execute(
            "INSERT INTO settings_state VALUES ('grant:downloads', 1, '{\"on\":true}')",
            [],
        )
        .unwrap();
    assert!(!read_answer(&connection, "grant:downloads").unwrap());
}

#[test]
fn one_prompt_at_a_time_per_permission() {
    let scope = "permission:test-only";
    let first = super::Asking::start(scope).expect("first asks");
    assert!(super::Asking::start(scope).is_none());
    assert!(super::Asking::start("permission:other-test-only").is_some());
    drop(first);
    assert!(super::Asking::start(scope).is_some());
}
