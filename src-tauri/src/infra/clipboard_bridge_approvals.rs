//! Kura installs this device approved, by the SHA-256 of their token, in `misty.db`.
use crate::infra::store::Store;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

/// Approved Kura installs, by the SHA-256 of their token, in `misty.db`.
pub(super) struct Approvals {
    store: Store,
    /// One consent prompt at a time.
    pub(super) asking: tokio::sync::Mutex<()>,
}

impl Approvals {
    pub(super) fn load(store: Store, legacy: PathBuf) -> Self {
        // An earlier layout kept the hashes in `kura-bridge.json`; import them once.
        let _ = store.import_once("kura-bridge.json", |connection| -> Result<(), rusqlite::Error> {
            let hashes = std::fs::read_to_string(&legacy)
                .ok()
                .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
                .unwrap_or_default();
            for hash in hashes {
                connection.execute(
                    "INSERT OR IGNORE INTO kura_approvals (hash) VALUES (?1)",
                    [hash],
                )?;
            }
            Ok(())
        });
        Self {
            store,
            asking: tokio::sync::Mutex::new(()),
        }
    }

    pub(super) fn allows(&self, token: &str) -> bool {
        !token.is_empty()
            && self.store.connect().is_ok_and(|connection| {
                connection
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM kura_approvals WHERE hash = ?1)",
                        [hash(token)],
                        |row| row.get::<_, bool>(0),
                    )
                    .unwrap_or(false)
            })
    }

    pub(super) fn approve(&self) -> std::io::Result<String> {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let token = hex::encode(bytes);
        self.store
            .connect()
            .and_then(|connection| {
                connection.execute(
                    "INSERT OR IGNORE INTO kura_approvals (hash) VALUES (?1)",
                    [hash(&token)],
                )
            })
            .map_err(std::io::Error::other)?;
        Ok(token)
    }
}

fn hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approved_tokens_persist_and_unknown_ones_do_not_pass() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        let approvals = Approvals::load(store.clone(), directory.path().join("kura-bridge.json"));
        assert!(!approvals.allows("nope"));
        assert!(!approvals.allows(""));
        let token = approvals.approve().unwrap();
        assert!(approvals.allows(&token));
        // A new instance over the same database still honors it.
        let reopened = Approvals::load(store, directory.path().join("kura-bridge.json"));
        assert!(reopened.allows(&token));
    }

    #[test]
    fn an_earlier_approvals_file_is_imported_once() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        let legacy = directory.path().join("kura-bridge.json");
        std::fs::write(&legacy, serde_json::to_vec(&[hash("old-token")]).unwrap()).unwrap();
        let approvals = Approvals::load(store, legacy);
        assert!(approvals.allows("old-token"));
    }
}
