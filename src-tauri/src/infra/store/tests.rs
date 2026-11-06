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
    // The folder itself is still shared.
    let access: String = connection
        .query_row(
            "SELECT access FROM local_agent_scopes WHERE id = 's'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(access, "write");
    assert!(connection
        .prepare("SELECT allow_push FROM local_agent_scopes")
        .is_err());
}
