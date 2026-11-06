use super::*;

fn temp_store() -> (tempfile::TempDir, Store) {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::at(directory.path().join("nested/misty.db"));
    (directory, store)
}

#[test]
fn creates_the_database_and_applies_every_migration_once() {
    let (_directory, store) = temp_store();
    let connection = store.connect().unwrap();
    assert_eq!(version(&connection).unwrap() as usize, MIGRATIONS.len());
    drop(connection);
    let again = store.connect().unwrap();
    assert_eq!(version(&again).unwrap() as usize, MIGRATIONS.len());
}

#[test]
fn refuses_a_database_from_a_newer_version() {
    let (_directory, store) = temp_store();
    let connection = store.connect().unwrap();
    connection
        .execute_batch(&format!("PRAGMA user_version = {}", MIGRATIONS.len() + 1))
        .unwrap();
    drop(connection);
    assert!(store.connect().is_err());
}

#[test]
fn concurrent_first_opens_do_not_conflict() {
    let (_directory, store) = temp_store();
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let store = store.clone();
            std::thread::spawn(move || store.connect().map(|_| ()))
        })
        .collect();
    for handle in handles {
        handle.join().unwrap().unwrap();
    }
}

#[test]
fn migration_18_keeps_the_device_id_and_drops_what_is_no_longer_kept() {
    let mut connection = Connection::open_in_memory().unwrap();
    for sql in &MIGRATIONS[..17] {
        connection.execute_batch(sql).unwrap();
    }
    connection
        .execute_batch(
            "PRAGMA user_version = 17;
             INSERT INTO local_agent_settings VALUES ('device_id', 'device_old');
             INSERT INTO agent_chats VALUES ('a', 'conversation', 'c', '{}', 1);
             INSERT INTO legacy_imports VALUES ('profile-collections:a'), ('settings.json');
             INSERT INTO local_agent_scopes (id,device_id,display_name,local_path,created_at,access,allow_push)
                 VALUES ('s','d','Site','/site','t','write',1);",
        )
        .unwrap();
    migrate(&mut connection).unwrap();
    let id: String = connection
        .query_row(
            "SELECT document FROM settings_state WHERE scope = 'device:id'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(id, "\"device_old\"");
    // An account already seeded stays seeded; old import names don't come along.
    let moved: Vec<String> = connection
        .prepare("SELECT scope FROM settings_state WHERE document = 'true'")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(moved, ["profile-collections:a"]);
    for table in [
        "local_agent_settings",
        "agent_chats",
        "agent_file_grants",
        "agent_file_manifests",
        "explorer_library",
        "kura_approvals",
        "legacy_imports",
    ] {
        let found: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = ?1",
                [table],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(found, 0, "{table} is gone");
    }
    assert!(connection
        .prepare("SELECT allow_push FROM local_agent_scopes")
        .is_err());
}

#[test]
fn migration_19_stops_sharing_folders_shared_with_write_access() {
    let mut connection = Connection::open_in_memory().unwrap();
    for sql in &MIGRATIONS[..18] {
        connection.execute_batch(sql).unwrap();
    }
    connection
        .execute_batch(
            "PRAGMA user_version = 18;
             INSERT INTO local_agent_scopes (id,device_id,display_name,local_path,created_at,access)
                 VALUES ('w','d','Site','/site','t','write'), ('r','d','Papers','/papers','t','read');",
        )
        .unwrap();
    migrate(&mut connection).unwrap();
    let kept: Vec<String> = connection
        .prepare("SELECT id FROM local_agent_scopes")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(kept, ["r"]);
    assert!(connection
        .prepare("SELECT access FROM local_agent_scopes")
        .is_err());
}

#[test]
fn migration_20_removes_only_the_coding_preferences() {
    let mut connection = Connection::open_in_memory().unwrap();
    for sql in &MIGRATIONS[..19] {
        connection.execute_batch(sql).unwrap();
    }
    connection
        .execute_batch(
            r#"PRAGMA user_version = 19;
             INSERT INTO settings_document VALUES (1,
                 '{"agent":{"mode":"plan","coding_default_tool":"claude","coding_usage_cap":"50"},"general":{"coding_usage_cap":"kept"}}');
             INSERT INTO settings_state (scope, revision, document) VALUES
                 ('["hosted"]', 4, '{"version":3,"values":{"agents.mode":"plan","agents.coding_default_tool":"codex","agents.coding_fallback_tool":"none","agents.coding_usage_cap":"50"}}'),
                 ('settings-baseline:hosted', 2, '{"agent":{"mode":"act","coding_fallback_tool":"pi"}}'),
                 ('clean', 7, '{ "version": 3, "values": {"agents.mode": "act"} }'),
                 ('device:id', 1, '"device_old"'),
                 ('profile-collections:a', 1, 'true'),
                 ('broken', 3, '{not json "coding_default_tool"');"#,
        )
        .unwrap();
    migrate(&mut connection).unwrap();

    let document: String = connection
        .query_row(
            "SELECT document FROM settings_document WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        document,
        r#"{"agent":{"mode":"plan"},"general":{"coding_usage_cap":"kept"}}"#
    );
    let state = |scope: &str| -> (i64, String) {
        connection
            .query_row(
                "SELECT revision, document FROM settings_state WHERE scope = ?1",
                [scope],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap()
    };
    assert_eq!(
        state(r#"["hosted"]"#),
        (5, r#"{"version":3,"values":{"agents.mode":"plan"}}"#.into())
    );
    assert_eq!(
        state("settings-baseline:hosted"),
        (3, r#"{"agent":{"mode":"act"}}"#.into())
    );
    // Nothing else changes, not even its spacing or revision.
    assert_eq!(
        state("clean"),
        (7, r#"{ "version": 3, "values": {"agents.mode": "act"} }"#.into())
    );
    assert_eq!(state("device:id"), (1, r#""device_old""#.into()));
    assert_eq!(state("profile-collections:a"), (1, "true".into()));
    assert_eq!(state("broken"), (3, r#"{not json "coding_default_tool""#.into()));
}
