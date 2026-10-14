// SPDX-License-Identifier: MIT
//! Extension storage values stay on this native path. The local outbox is
//! encrypted with a device key; transport records use the existing sync vault.
use super::*;
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use misty_browser_sync::{
    collections::EXTENSION_SYNC,
    document::{entities::Kind, ViewRecord},
};
use std::sync::atomic::{AtomicU64, Ordering};

#[path = "sync_exchange.rs"]
mod exchange;
#[path = "sync_journal.rs"]
mod journal;
use exchange::pass;
use journal::{ciphers, journal_exists, journal_lock, read, remove_local, write, Journal};

static EPOCH: AtomicU64 = AtomicU64::new(0);
fn ready() -> &'static std::sync::Mutex<std::collections::BTreeSet<String>> {
    static READY: OnceLock<std::sync::Mutex<std::collections::BTreeSet<String>>> = OnceLock::new();
    READY.get_or_init(Default::default)
}
fn readiness_key(account: &str, id: &str) -> String {
    format!("{account}:{id}")
}
pub fn forget(account: &str, id: &str) {
    if let Ok(mut ready) = ready().lock() {
        ready.remove(&readiness_key(account, id));
    }
}
pub fn reset() {
    EPOCH.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut ready) = ready().lock() {
        ready.clear();
    }
    if let Ok(mut ciphers) = ciphers().lock() {
        ciphers.clear();
    }
}
pub fn queue_removal(
    _app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
) -> Result<(), String> {
    let home = crate::infra::paths::misty_home_dir().ok_or("Misty's data folder is unavailable.")?;
    crate::infra::store::Store::at(home.join(".local").join("data").join("misty.db"))
        .connect()
        .and_then(|connection| {
            connection.execute(
                "INSERT OR REPLACE INTO extension_removals (account, generation, installation)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    account,
                    installation.generation,
                    serde_json::to_string(installation).unwrap_or_default()
                ],
            )
        })
        .map(|_| ())
        .map_err(|e| e.to_string())
}
pub async fn clear_local(
    app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
) -> Result<(), String> {
    let _guard = journal_lock().lock().await;
    remove_local(app, account, installation)
}
/// A new generation explicitly approved on this device has no remote values to
/// restore. Journal its writes immediately, even before the sync vault unlocks.
pub async fn seed_local(
    app: &tauri::AppHandle,
    account: &str,
    installation: &Installation,
) -> Result<(), String> {
    let _guard = journal_lock().lock().await;
    if journal_exists(app, account, installation)? {
        return Err("This extension installation generation already exists.".into());
    }
    write(
        app,
        account,
        installation,
        &Journal {
            initialized: true,
            ..Default::default()
        },
    )
}
fn safe_change(key: &str, value: &Value) -> bool {
    key.len() <= 8192
        && value.to_string().len() + key.len() <= 8192
        && value.as_object().is_some_and(|v| {
            (v.len() == 1 && v.get("deleted") == Some(&Value::Bool(true)))
                || (v.len() == 1 && v.contains_key("value"))
        })
}

pub async fn observe(app: &tauri::AppHandle, event: Value) {
    if event["session"].as_u64() != Some(ACCOUNT_EPOCH.load(Ordering::Acquire)) {
        return;
    }
    let Some(account) = event["account"].as_str() else {
        return;
    };
    let Some(id) = event["id"]
        .as_str()
        .filter(|v| super::catalog::Store::of(v).is_some())
        .map(str::to_owned)
    else {
        return;
    };
    let installation = {
        let state = service().lock().await;
        if state.account != account {
            return;
        }
        state
            .desired
            .get(&id)
            .filter(|v| v.installed && v.enabled)
            .cloned()
    };
    let Some(installation) = installation else {
        return;
    };
    let _guard = journal_lock().lock().await;
    {
        let state = service().lock().await;
        if state.account != account || state.desired.get(&id) != Some(&installation) {
            return;
        }
    }
    let result = (|| {
        let mut journal = read(app, account, &installation)?;
        let changes: BTreeMap<String, Value> = if event["kind"] == "sync-ready" {
            let values = event["payload"]["values"]
                .as_object()
                .ok_or("The extension sync bridge is not ready.")?;
            let mut changes = BTreeMap::new();
            for (key, value) in values {
                if journal.values.get(key) != Some(value) {
                    changes.insert(key.clone(), json!({"value":value}));
                }
            }
            for key in journal.values.keys() {
                if !values.contains_key(key) {
                    changes.insert(key.clone(), json!({"deleted":true}));
                }
            }
            changes
        } else {
            serde_json::from_value(event["payload"]["changes"].clone())
                .map_err(|_| "Could not read the extension's storage changes.")?
        };
        if changes.len() > 512 || changes.iter().any(|(k, v)| !safe_change(k, v)) {
            return Err("Extension sync storage exceeds its quota.".into());
        }
        for (key, change) in changes {
            if change["deleted"] == true {
                journal.values.remove(&key);
            } else {
                journal.values.insert(key.clone(), change["value"].clone());
            }
            if journal.initialized {
                journal.pending.insert(key, change);
            }
        }
        if journal.values.len() > 512
            || serde_json::to_vec(&journal.values)
                .map_err(|e| e.to_string())?
                .len()
                > 102_400
        {
            return Err("Extension sync storage exceeds its quota.".into());
        }
        write(app, account, &installation, &journal)
    })();
    if result.is_ok() && event["kind"] == "sync-ready" {
        if let Ok(mut ready) = ready().lock() {
            ready.insert(readiness_key(account, &id));
        }
        // Previously restored local data remains usable while the vault is locked.
        if read(app, account, &installation).is_ok_and(|journal| journal.initialized) {
            let _ = native::request(json!({"operation":"sync-restored","account":account,"id":id}))
                .await;
        }
    }
    if result.is_err() {
        let _ = app.emit_to("main","misty://extensions",json!({"kind":"sync-status","account":account,"id":id,"detail":"Extension settings could not be saved for sync. Retry after checking sync access."}));
    }
}

pub fn start(app: tauri::AppHandle, account: String) {
    let epoch = EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(std::time::Duration::from_secs(3));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            if EPOCH.load(Ordering::SeqCst) != epoch {
                break;
            }
            let installations = {
                let state = service().lock().await;
                if state.account != account {
                    break;
                }
                state
                    .desired
                    .values()
                    .filter(|v| v.installed && v.enabled)
                    .cloned()
                    .collect::<Vec<_>>()
            };
            let Some(handle) = crate::infra::browser_sync::extension_sync_handle(&account).await
            else {
                continue;
            };
            let removed = {
                let state = service().lock().await;
                state
                    .desired
                    .values()
                    .filter(|v| !v.installed)
                    .cloned()
                    .collect::<Vec<_>>()
            };
            for installation in removed {
                remove(&account, &installation).await;
            }
            for installation in queued_removals(&account) {
                if valid_installation(&installation) && remove(&account, &installation).await {
                    forget_removal(&account, &installation.generation);
                }
            }
            for installation in installations {
                if pass(&app, &account, &installation, &handle).await.is_err() {
                    let _ = app.emit_to("main","misty://extensions",json!({"kind":"sync-status","account":account,"id":installation.id,"detail":"Extension settings are waiting for sync. Local changes are retained."}));
                }
            }
        }
    });
}

async fn current(account: &str, installation: &Installation, epoch: u64) -> bool {
    if ACCOUNT_EPOCH.load(Ordering::Acquire) != epoch {
        return false;
    }
    let state = service().lock().await;
    state.account == account && state.desired.get(&installation.id) == Some(installation)
}

pub async fn remove(account: &str, installation: &Installation) -> bool {
    let Some(handle) = crate::infra::browser_sync::extension_sync_handle(account).await else {
        return false;
    };
    if !handle
        .records_ready(EXTENSION_SYNC.into())
        .await
        .unwrap_or(false)
    {
        return false;
    }
    if let Ok((_, records)) = handle.records_list(EXTENSION_SYNC.into()).await {
        let matches = |r: &&ViewRecord| {
            r.fields.get("extension").and_then(Value::as_str) == Some(&installation.guid)
                && r.fields.get("generation").and_then(Value::as_str)
                    == Some(&installation.generation)
        };
        let mut writes = records
            .iter()
            .filter(matches)
            .filter(|r| r.kind == Kind::ExtensionSyncKey)
            .map(|r| (r.id.clone(), None))
            .collect::<Vec<_>>();
        if !records
            .iter()
            .filter(matches)
            .any(|r| r.kind == Kind::ExtensionRemoval)
        {
            let id = identity(&format!(
                "removed:{}:{}",
                installation.guid, installation.generation
            ));
            writes.push((
                id.clone(),
                Some(ViewRecord {
                    kind: Kind::ExtensionRemoval,
                    id,
                    fields: BTreeMap::from([
                        ("extension".into(), json!(installation.guid)),
                        ("generation".into(), json!(installation.generation)),
                    ]),
                }),
            ));
        }
        return writes.is_empty()
            || handle
                .records_write(EXTENSION_SYNC.into(), writes)
                .await
                .is_ok();
    }
    false
}

#[cfg(test)]
#[path = "sync_tests.rs"]
mod tests;

fn removals_db() -> Option<rusqlite::Connection> {
    let home = crate::infra::paths::misty_home_dir()?;
    crate::infra::store::Store::at(home.join(".local").join("data").join("misty.db"))
        .connect()
        .ok()
}

/// Installations removed here whose remote values still need clearing.
fn queued_removals(account: &str) -> Vec<Installation> {
    let Some(connection) = removals_db() else {
        return Vec::new();
    };
    let Ok(mut statement) =
        connection.prepare("SELECT installation FROM extension_removals WHERE account = ?1")
    else {
        return Vec::new();
    };
    statement
        .query_map([account], |row| row.get::<_, String>(0))
        .map(|rows| {
            rows.flatten()
                .filter_map(|text| serde_json::from_str::<Installation>(&text).ok())
                .collect()
        })
        .unwrap_or_default()
}

fn forget_removal(account: &str, generation: &str) {
    if let Some(connection) = removals_db() {
        let _ = connection.execute(
            "DELETE FROM extension_removals WHERE account = ?1 AND generation = ?2",
            [account, generation],
        );
    }
}
