//! Copies what this computer already kept for itself (site choices and the downloads list) into
//! the first profile's records, once per account.
use super::*;
use browser_data::collections::{DOWNLOADS, SITE_PERMISSIONS};

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
) -> [(&'static str, Vec<ViewRecord>); 2] {
    [
        (
            SITE_PERMISSIONS,
            crate::browser::site_settings::permissions::seed_records(connection, store_key),
        ),
        (
            DOWNLOADS,
            crate::browser::history_downloads::library::seed_download_records(connection, session),
        ),
    ]
}

fn seed() -> Result<(), SeedError> {
    let home = file_access::paths::misty_home_dir().ok_or(SeedError::Records)?;
    let scope = crate::browser::app_windows::current_scope();
    let store_key =
        crate::browser::app_windows::store_for_profile(crate::browser::app_windows::PERSONAL)
            .ok()
            .and_then(|store| {
                crate::browser::site_settings::permissions::store_key(store.as_deref()).ok()
            })
            .ok_or(SeedError::Records)?;
    let session = session_id().ok_or(SeedError::Records)?;
    // Only a key storage that answers counts: a failed read tries again next launch.
    let records = local_store().map_err(|_| SeedError::Records)?;
    let database = database::store::Store::in_home(&home);
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
    {
        let mut records = records.lock().map_err(|_| SeedError::Records)?;
        for (collection, seeded) in read(&transaction, &store_key, &session) {
            let writes = seeded
                .into_iter()
                .map(|record| (record.id.clone(), Some(record)))
                .collect();
            records
                .write(crate::browser::app_windows::PERSONAL, collection, writes)
                .map_err(|_| SeedError::Records)?;
        }
    }
    transaction.execute(
        "INSERT INTO settings_state (scope, revision, document) VALUES (?1, 1, 'true')",
        [&marker],
    )?;
    transaction.commit()?;
    Ok(())
}

/// Runs once per account, in the background: nothing waits for it.
pub(crate) fn seed_first_profile() {
    tauri::async_runtime::spawn_blocking(|| {
        let _ = seed();
    });
}
