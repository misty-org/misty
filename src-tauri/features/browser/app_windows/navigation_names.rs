//! Names the person once gave to tabs and groups, per account, in `misty.db`. Nothing renames
//! anything now; saved tabs read them once for their titles.
pub mod commands;

use database::store::Store;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Serialize)]
pub struct NavigationSnapshot {
    pub names: BTreeMap<String, String>,
    pub error: Option<String>,
}

pub struct NavigationNamesService {
    store: Store,
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

impl NavigationNamesService {
    pub fn new(store: Store) -> Self {
        Self { store }
    }

    pub async fn snapshot(&self, account: &str) -> NavigationSnapshot {
        let (store, account) = (self.store.clone(), account.to_owned());
        let result = tokio::task::spawn_blocking(move || read_names(&store, &account))
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
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service(directory: &tempfile::TempDir) -> NavigationNamesService {
        NavigationNamesService::new(Store::at(directory.path().join("misty.db")))
    }

    #[tokio::test]
    async fn names_stay_per_account() {
        let directory = tempfile::tempdir().unwrap();
        let service = service(&directory);
        let connection = service.store.connect().unwrap();
        connection
            .execute(
                "INSERT INTO navigation_names (account, key, name) VALUES ('account-a', 'tab:1', 'School')",
                [],
            )
            .unwrap();
        assert_eq!(service.snapshot("account-a").await.names["tab:1"], "School");
        assert!(service.snapshot("account-b").await.names.is_empty());
    }
}
