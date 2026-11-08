//! Keeps memory moving while the vault link runs. Rows go into the account's record store, which the link
//! seals and sends, and what the link receives comes back the same way. With no vault this never runs,
//! and memory stays on this computer.
use std::time::Duration;

use browser_data::{collections::MEMORY, local::LocalStore};
use tauri::{AppHandle, Manager};
use tokio::sync::broadcast;
use tokio::time::{sleep_until, Instant};

use super::{sync, sync_apply};
use crate::browser::app_windows;
use crate::browser::profiles::{self, RecordsChanged};
use database::store::Store;

const PASS: Duration = Duration::from_secs(60);
/// Incoming records come in runs; take them in once they've settled.
const SETTLE: Duration = Duration::from_secs(3);
const BATCH: i64 = 200;
/// Memory belongs to the account, not to any one profile, so it lives under this name.
const OWNER: &str = "";
/// Set once this vault holds this computer's memory. Gone with the vault link, so everything goes up
/// again to a new vault.
const META_SENT: &str = "vault.memory_sent";

pub(crate) fn spawn(app: AppHandle) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut changes = profiles::subscribe();
        let mut due = Instant::now();
        loop {
            tokio::select! {
                _ = sleep_until(due) => {}
                change = changes.recv() => {
                    match change {
                        Ok(change) if change.remote && change.collection == MEMORY => {
                            due = due.min(Instant::now() + SETTLE);
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            due = due.min(Instant::now() + SETTLE);
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                        Ok(_) => {}
                    }
                    continue;
                }
            }
            due = Instant::now() + PASS;
            let store = app
                .state::<crate::app::runtime::MistyRuntime>()
                .environment
                .store();
            let account = app_windows::current_scope();
            // A failed pass leaves everything marked and is tried again next pass.
            let wrote = tokio::task::spawn_blocking(move || pass(&store, &account))
                .await
                .ok()
                .and_then(Result::ok)
                .unwrap_or(false);
            if wrote {
                profiles::announce(RecordsChanged {
                    profile: OWNER.to_owned(),
                    collection: MEMORY.to_owned(),
                    remote: false,
                });
            }
        }
    })
}

fn locked<T>(
    records: &std::sync::Mutex<LocalStore>,
    work: impl FnOnce(&mut LocalStore) -> browser_data::Result<T>,
) -> Result<T, String> {
    let mut store = records
        .lock()
        .map_err(|_| "Local storage is unavailable.".to_owned())?;
    work(&mut store).map_err(|_| "Local storage is unavailable.".to_owned())
}

/// One round in both directions. Says whether anything new is waiting for the link.
fn pass(store: &Store, account: &str) -> Result<bool, String> {
    let records = profiles::local_store()?;
    let mut connection = store.connect().map_err(|error| error.to_string())?;
    let failed = |error: super::MemoryError| error.code();
    if locked(&records, |store| store.meta(META_SENT))?.is_none() {
        sync::start_over(&connection, account).map_err(failed)?;
        locked(&records, |store| store.set_meta(META_SENT, "1"))?;
    }
    // The record store is the signed-in account's, so a change of account ends this pass at once.
    let same_account = || app_windows::current_scope() == account;
    loop {
        if !same_account() {
            return Ok(false);
        }
        let incoming = locked(&records, |store| store.inbox(OWNER, MEMORY, BATCH as usize))?;
        if incoming.is_empty() {
            break;
        }
        let batch: Vec<(String, Option<Vec<u8>>)> = incoming
            .into_iter()
            .map(|(id, body)| (id, body.map(|body| body.to_vec())))
            .collect();
        sync_apply::apply(&mut connection, account, &batch).map_err(failed)?;
        let ids: Vec<String> = batch.into_iter().map(|(id, _)| id).collect();
        locked(&records, |store| store.inbox_done(OWNER, MEMORY, &ids))?;
    }
    let mut wrote = false;
    loop {
        if !same_account() {
            return Ok(wrote);
        }
        let rows = sync::outgoing(&connection, account, BATCH).map_err(failed)?;
        if rows.is_empty() {
            return Ok(wrote);
        }
        locked(&records, |store| {
            store.atomic(|store| {
                for row in &rows {
                    store.write_one(OWNER, MEMORY, &row.id, row.body.as_deref())?;
                }
                Ok(())
            })
        })?;
        sync::sent(&mut connection, account, &rows).map_err(failed)?;
        wrote = true;
    }
}
