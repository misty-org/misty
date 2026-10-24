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
