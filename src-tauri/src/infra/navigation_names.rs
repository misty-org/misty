//! Names the person gave to windows, tabs and groups, per account, in `misty.db`.
use super::store::Store;
use serde::Serialize;
use std::{collections::BTreeMap, path::PathBuf};

#[derive(Clone, Serialize)]
pub struct NavigationSnapshot {
    pub names: BTreeMap<String, String>,
    pub error: Option<String>,
}

pub struct NavigationNamesService {
    store: Store,
    /// `navigation.json` from an earlier layout, imported once when no names exist yet.
    legacy_path: PathBuf,
}

fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.chars().count() <= 120
        && !value
            .chars()
            .any(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
}

fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 2048 && !key.chars().any(char::is_control)
}

fn read_names(store: &Store, account: &str) -> Result<BTreeMap<String, String>, String> {
    let connection = store.connect().map_err(|e| e.to_string())?;
    let mut statement = connection
        .prepare("SELECT key, name FROM navigation_names WHERE account = ?1")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([account], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

/// Imports an earlier `navigation.json` (`{"version":1,"accounts":{...}}`) once.
fn import_legacy(store: &Store, legacy: &std::path::Path) -> Result<(), String> {
    store
        .import_once("navigation.json", |connection| -> Result<(), rusqlite::Error> {
            let Ok(bytes) = std::fs::read(legacy) else {
                return Ok(());
            };
            #[derive(serde::Deserialize)]
            struct Legacy {
                #[serde(default)]
                accounts: BTreeMap<String, BTreeMap<String, String>>,
            }
            let Ok(document) = serde_json::from_slice::<Legacy>(&bytes) else {
                return Ok(());
            };
            for (account, names) in document.accounts {
                for (key, name) in names {
                    if valid_key(&account) && valid_key(&key) && valid_name(&name) {
                        connection.execute(
                            "INSERT OR IGNORE INTO navigation_names (account, key, name) VALUES (?1, ?2, ?3)",
                            rusqlite::params![account, key, name],
                        )?;
                    }
                }
            }
            Ok(())
        })
        .map_err(|e| e.to_string())
}

impl NavigationNamesService {
    pub fn new(store: Store, legacy_path: PathBuf) -> Self {
        Self { store, legacy_path }
    }

    pub async fn snapshot(&self, account: &str) -> NavigationSnapshot {
        let (store, legacy, account) = (
            self.store.clone(),
            self.legacy_path.clone(),
            account.to_owned(),
        );
        let result = tokio::task::spawn_blocking(move || {
            import_legacy(&store, &legacy)?;
            read_names(&store, &account)
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|result| result);
        match result {
            Ok(names) => NavigationSnapshot { names, error: None },
            Err(error) => NavigationSnapshot {
                names: BTreeMap::new(),
                error: Some(error),
            },
        }
    }

    pub async fn update(
        &self,
        account: String,
        key: String,
        name: Option<String>,
    ) -> Result<NavigationSnapshot, String> {
        if !valid_key(&account) || !valid_key(&key) || name.as_ref().is_some_and(|n| !valid_name(n))
        {
            return Err("Choose a single-line name of 1–120 characters.".into());
        }
        let store = self.store.clone();
        let names = tokio::task::spawn_blocking(move || {
            let connection = store.connect().map_err(|e| e.to_string())?;
            match name {
                Some(name) => connection.execute(
                    "INSERT INTO navigation_names (account, key, name) VALUES (?1, ?2, ?3)
                     ON CONFLICT (account, key) DO UPDATE SET name = excluded.name",
                    rusqlite::params![account, key, name],
                ),
                None => connection.execute(
                    "DELETE FROM navigation_names WHERE account = ?1 AND key = ?2",
                    rusqlite::params![account, key],
                ),
            }
            .map_err(|e| e.to_string())?;
            read_names(&store, &account)
        })
        .await
        .map_err(|e| e.to_string())??;
        Ok(NavigationSnapshot { names, error: None })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service(directory: &tempfile::TempDir) -> NavigationNamesService {
        NavigationNamesService::new(
            Store::at(directory.path().join("misty.db")),
            directory.path().join("navigation.json"),
        )
    }

    #[tokio::test]
    async fn names_merge_reset_and_stay_per_account() {
        let directory = tempfile::tempdir().unwrap();
        let service = service(&directory);
        let (a, b) = tokio::join!(
            service.update("account-a".into(), "tab:1".into(), Some("School".into())),
            service.update("account-a".into(), "tab:2".into(), Some("Mail".into()))
        );
        a.unwrap();
        b.unwrap();
        assert_eq!(service.snapshot("account-a").await.names.len(), 2);
        // A new service over the same database sees the saved names.
        assert_eq!(
            self::service(&directory).snapshot("account-a").await.names["tab:1"],
            "School"
        );
        assert!(service.snapshot("account-b").await.names.is_empty());
        service
            .update("account-a".into(), "tab:1".into(), Some("Edited".into()))
            .await
            .unwrap();
        assert_eq!(service.snapshot("account-a").await.names["tab:1"], "Edited");
        service
            .update("account-a".into(), "tab:1".into(), None)
            .await
            .unwrap();
        assert!(!service
            .snapshot("account-a")
            .await
            .names
            .contains_key("tab:1"));
    }

    #[tokio::test]
    async fn an_earlier_navigation_file_is_imported_once() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("navigation.json"),
            br#"{"version":1,"accounts":{"account-a":{"tab:1":"Old name"}}}"#,
        )
        .unwrap();
        let service = service(&directory);
        assert_eq!(
            service.snapshot("account-a").await.names["tab:1"],
            "Old name"
        );
        service
            .update("account-a".into(), "tab:1".into(), None)
            .await
            .unwrap();
        // The file does not come back after the name was removed.
        assert!(service.snapshot("account-a").await.names.is_empty());
    }

    #[test]
    fn labels_are_bounded_single_line() {
        for value in ["", " padded ", "a\nb", "a\u{2028}b"] {
            assert!(!valid_name(value));
        }
        assert!(valid_name("家族"));
        assert!(!valid_name(&"a".repeat(121)));
    }
}
