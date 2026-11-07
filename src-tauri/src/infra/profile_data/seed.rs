//! Copies what this computer already kept for itself (site choices, the downloads list, search
//! shortcuts) into the first profile's records, once per account. Extensions arrive with the next
//! reconcile, which writes every installed one.
use super::*;
use misty_browser_sync::collections::{DOWNLOADS, SEARCH, SITE_PERMISSIONS};

enum SeedError {
    Database,
    Records,
}

impl From<rusqlite::Error> for SeedError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Database
    }
}

/// The writes that start each collection, from `misty.db`.
fn read(
    connection: &rusqlite::Connection,
    store_key: &str,
    session: &str,
) -> [(&'static str, Vec<ViewRecord>); 3] {
    [
        (
            SITE_PERMISSIONS,
            crate::infra::site_settings::permissions::seed_records(connection, store_key),
        ),
        (
            DOWNLOADS,
            crate::infra::browser_library::seed_download_records(connection, session),
        ),
        (
            SEARCH,
            crate::infra::search::profile::seed_records(connection),
        ),
    ]
}

fn seed() -> Result<(), SeedError> {
    let home = super::super::paths::misty_home_dir().ok_or(SeedError::Records)?;
    let scope = profile_windows::current_scope();
    let store_key = profile_windows::store_for_profile(profile_windows::PERSONAL)
        .ok()
        .and_then(|store| {
            crate::infra::site_settings::permissions::store_key(store.as_deref()).ok()
        })
        .ok_or(SeedError::Records)?;
    let session = session_id().ok_or(SeedError::Records)?;
    // Only a key storage that answers counts: a failed read tries again next launch.
    let records = local_store().map_err(|_| SeedError::Records)?;
    let database = super::super::store::Store::in_home(&home);
    let marker = format!("profile-collections:{}", account_identity(&scope));
    let mut connection = database.connect()?;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let done: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM settings_state WHERE scope = ?1)",
        [&marker],
        |row| row.get(0),
    )?;
    if done {
        return Ok(());
    }
    let mut changed = Vec::new();
    {
        let mut records = records.lock().map_err(|_| SeedError::Records)?;
        for (collection, seeded) in read(&transaction, &store_key, &session) {
            let writes = seeded
                .into_iter()
                .map(|record| (record.id.clone(), Some(record)))
                .collect();
            let written = records
                .write(profile_windows::PERSONAL, collection, writes)
                .map_err(|_| SeedError::Records)?;
            if written > 0 {
                changed.push(collection);
            }
        }
    }
    transaction.execute(
        "INSERT INTO settings_state (scope, revision, document) VALUES (?1, 1, 'true')",
        [&marker],
    )?;
    transaction.commit()?;
    for collection in changed {
        announce(RecordsChanged {
            profile: profile_windows::PERSONAL.to_owned(),
            collection: collection.to_owned(),
            remote: false,
        });
    }
    Ok(())
}

/// Runs once per account, in the background: nothing waits for it.
pub(crate) fn seed_first_profile() {
    tauri::async_runtime::spawn_blocking(|| {
        let _ = seed();
    });
}
