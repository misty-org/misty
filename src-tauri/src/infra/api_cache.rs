//! Local copies of account data fetched from the Misty server, so a page can paint from them
//! at once while the fresh data loads (stale-while-revalidate, driven by `src/api/cache`).
//!
//! Entries live in one SQLite file under `~/.misty/cache/api`. Each body is encrypted with
//! AES-256-GCM under a key held in Misty's credential store (the OS keychain), and bound to
//! its account and key, so a copied database file reveals nothing. The cache is a copy: it
//! can be deleted at any time and the server stays the source of truth.
use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use rand::RngCore;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::app::runtime::MistyRuntime;
use crate::infra::credential_store;

const KEY_SERVICE: &str = "com.misty.api-cache";
const KEY_ACCOUNT: &str = "key";
/// The cache holds at most this much; the oldest entries go first.
const MAX_BYTES: i64 = 128 * 1024 * 1024;
/// One response larger than this is not worth keeping.
const MAX_ENTRY_BYTES: usize = 8 * 1024 * 1024;
const NONCE_LEN: usize = 12;

struct Cache {
    connection: Connection,
    cipher: Aes256Gcm,
}

static CACHE: OnceLock<Mutex<Option<Cache>>> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCacheHit {
    pub body: String,
    /// Unix milliseconds when the entry was fetched.
    pub fetched_at: i64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

fn cipher() -> Result<Aes256Gcm, String> {
    let stored = credential_store::load(KEY_SERVICE, KEY_ACCOUNT).map_err(|e| e.to_string())?;
    let key = match stored.and_then(|hex_key| hex::decode(hex_key).ok()) {
        Some(bytes) if bytes.len() == 32 => bytes,
        _ => {
            let mut bytes = vec![0u8; 32];
            rand::thread_rng().fill_bytes(&mut bytes);
            credential_store::store(KEY_SERVICE, KEY_ACCOUNT, &hex::encode(&bytes))
                .map_err(|e| e.to_string())?;
            bytes
        }
    };
    Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())
}

fn open(dir: PathBuf) -> Result<Cache, String> {
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("cache.sqlite");
    let connection = Connection::open(&path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS entries(
               account TEXT NOT NULL,
               key TEXT NOT NULL,
               body BLOB NOT NULL,
               fetched_at INTEGER NOT NULL,
               size INTEGER NOT NULL,
               PRIMARY KEY(account, key)
             );
             CREATE INDEX IF NOT EXISTS entries_age ON entries(fetched_at);",
        )
        .map_err(|e| e.to_string())?;
    Ok(Cache {
        connection,
        cipher: cipher()?,
    })
}

fn with_cache<T>(
    runtime: &MistyRuntime,
    work: impl FnOnce(&Cache) -> Result<T, String>,
) -> Result<T, String> {
    let slot = CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = slot.lock().map_err(|_| "The cache is unavailable".to_string())?;
    if guard.is_none() {
        *guard = Some(open(runtime.environment.cache_dir().join("api"))?);
    }
    work(guard.as_ref().expect("opened above"))
}

fn aad(account: &str, key: &str) -> Vec<u8> {
    format!("{account}\n{key}").into_bytes()
}

fn get(cache: &Cache, account: &str, key: &str) -> Result<Option<ApiCacheHit>, String> {
    let row: Option<(Vec<u8>, i64)> = cache
        .connection
        .query_row(
            "SELECT body, fetched_at FROM entries WHERE account=?1 AND key=?2",
            params![account, key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    let Some((sealed, fetched_at)) = row else {
        return Ok(None);
    };
    if sealed.len() <= NONCE_LEN {
        return Ok(None);
    }
    let (nonce, ciphertext) = sealed.split_at(NONCE_LEN);
    let opened = cache.cipher.decrypt(
        Nonce::from_slice(nonce),
        Payload {
            msg: ciphertext,
            aad: &aad(account, key),
        },
    );
    // An entry that no longer opens (a new key, a damaged file) is a miss, never an error.
    Ok(opened
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .map(|body| ApiCacheHit { body, fetched_at }))
}

fn put(cache: &Cache, account: &str, key: &str, body: &str) -> Result<(), String> {
    if body.len() > MAX_ENTRY_BYTES {
        return Ok(());
    }
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce);
    let sealed = cache
        .cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: body.as_bytes(),
                aad: &aad(account, key),
            },
        )
        .map_err(|_| "The cache entry could not be sealed".to_string())?;
    let mut stored = nonce.to_vec();
    stored.extend_from_slice(&sealed);
    let size = stored.len() as i64;
    cache
        .connection
        .execute(
            "INSERT INTO entries(account, key, body, fetched_at, size) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(account, key) DO UPDATE SET body=?3, fetched_at=?4, size=?5",
            params![account, key, stored, now_ms(), size],
        )
        .map_err(|e| e.to_string())?;
    evict(cache)
}

/// Drops the oldest entries while the cache is over its size.
fn evict(cache: &Cache) -> Result<(), String> {
    loop {
        let total: i64 = cache
            .connection
            .query_row("SELECT COALESCE(SUM(size),0) FROM entries", [], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;
        if total <= MAX_BYTES {
            return Ok(());
        }
        cache
            .connection
            .execute(
                "DELETE FROM entries WHERE rowid IN
                 (SELECT rowid FROM entries ORDER BY fetched_at ASC LIMIT 200)",
                [],
            )
            .map_err(|e| e.to_string())?;
    }
}

#[tauri::command]
pub async fn api_cache_get(
    runtime: State<'_, MistyRuntime>,
    account: String,
    key: String,
) -> Result<Option<ApiCacheHit>, String> {
    with_cache(&runtime, |cache| get(cache, &account, &key))
}

#[tauri::command]
pub async fn api_cache_put(
    runtime: State<'_, MistyRuntime>,
    account: String,
    key: String,
    body: String,
) -> Result<(), String> {
    with_cache(&runtime, |cache| put(cache, &account, &key, &body))
}

/// Removes every entry of the account whose key starts with `prefix`.
#[tauri::command]
pub async fn api_cache_delete_prefix(
    runtime: State<'_, MistyRuntime>,
    account: String,
    prefix: String,
) -> Result<(), String> {
    with_cache(&runtime, |cache| {
        cache
            .connection
            .execute(
                "DELETE FROM entries WHERE account=?1 AND substr(key,1,?2)=?3",
                params![account, prefix.chars().count() as i64, prefix],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
}

/// Removes everything cached for the account (sign-out, account removal).
#[tauri::command]
pub async fn api_cache_clear(
    runtime: State<'_, MistyRuntime>,
    account: String,
) -> Result<(), String> {
    with_cache(&runtime, |cache| {
        cache
            .connection
            .execute("DELETE FROM entries WHERE account=?1", params![account])
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_cache() -> Cache {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE entries(account TEXT NOT NULL, key TEXT NOT NULL, body BLOB NOT NULL,
                 fetched_at INTEGER NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(account, key));",
            )
            .unwrap();
        Cache {
            connection,
            cipher: Aes256Gcm::new_from_slice(&[7u8; 32]).unwrap(),
        }
    }

    #[test]
    fn entries_round_trip_and_stay_with_their_account() {
        let cache = test_cache();
        put(&cache, "a", "/spaces", "{\"spaces\":[]}").unwrap();
        assert_eq!(
            get(&cache, "a", "/spaces").unwrap().unwrap().body,
            "{\"spaces\":[]}"
        );
        assert!(get(&cache, "b", "/spaces").unwrap().is_none());
    }

    #[test]
    fn a_body_moved_to_another_key_does_not_open() {
        let cache = test_cache();
        put(&cache, "a", "/one", "secret").unwrap();
        cache
            .connection
            .execute("UPDATE entries SET key='/two' WHERE key='/one'", [])
            .unwrap();
        assert!(get(&cache, "a", "/two").unwrap().is_none());
    }
}
