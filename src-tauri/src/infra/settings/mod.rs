mod defaults;
pub(super) mod migration;
pub mod profile_store;

use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use self::defaults::normalize_settings_document;

use crate::error::{ApiError, ApiResult};
use crate::infra::environment::AppEnvironmentService;

use super::store::Store;

/// This device's settings: one JSON document (sections and keys) in `misty.db`. Settings
/// never leave the device; nothing here talks to the server.
#[derive(Debug, Clone)]
pub struct SettingsService {
    store: Store,
    /// The settings file of an earlier layout, imported once if present.
    legacy_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub path: String,
    pub document: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsRequest {
    pub document: Value,
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> ApiResult<T> + Send + 'static,
) -> ApiResult<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
}

impl SettingsService {
    pub async fn profile_state(
        &self,
        scope: String,
        update: Option<(i64, Value)>,
    ) -> ApiResult<profile_store::ProfileStateSnapshot> {
        let store = self.store.clone();
        blocking(move || profile_store::profile_state(&store, &scope, update)).await
    }

    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            store: environment.store(),
            legacy_path: environment.settings_path(),
        }
    }

    pub async fn snapshot(&self) -> ApiResult<SettingsSnapshot> {
        let (store, legacy) = (self.store.clone(), self.legacy_path.clone());
        blocking(move || {
            import_legacy_settings(&store, &legacy)?;
            load_settings(&store)
        })
        .await
    }

    pub async fn save(&self, request: SaveSettingsRequest) -> ApiResult<SettingsSnapshot> {
        let store = self.store.clone();
        blocking(move || save_settings(&store, request.document)).await
    }
}

fn db_error(error: rusqlite::Error) -> ApiError {
    ApiError::Message(format!("Settings persistence failed: {error}"))
}

/// Imports `config/settings.json` from an earlier layout, once. The old file is left
/// where it is.
fn import_legacy_settings(store: &Store, legacy: &Path) -> ApiResult<()> {
    store
        .import_once(
            "settings.json",
            |connection| -> Result<(), rusqlite::Error> {
                let Ok(raw) = fs::read_to_string(legacy) else {
                    return Ok(());
                };
                if let Some(document) = serde_json::from_str::<Value>(&raw)
                    .ok()
                    .filter(Value::is_object)
                {
                    connection.execute(
                        "INSERT OR IGNORE INTO settings_document (id, document) VALUES (1, ?1)",
                        [document.to_string()],
                    )?;
                }
                Ok(())
            },
        )
        .map_err(db_error)
}

fn load_settings(store: &Store) -> ApiResult<SettingsSnapshot> {
    let mut document = load_settings_document(store)?;
    if normalize_settings_document(&mut document) {
        save_settings_document(store, &document)?;
    }

    Ok(SettingsSnapshot {
        path: store.path().display().to_string(),
        document,
    })
}

fn load_settings_document(store: &Store) -> ApiResult<Value> {
    let connection = store.connect().map_err(db_error)?;
    let stored: Option<String> = connection
        .query_row(
            "SELECT document FROM settings_document WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    Ok(stored
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Default::default())))
}

fn save_settings(store: &Store, mut document: Value) -> ApiResult<SettingsSnapshot> {
    if !document.is_object() {
        return Err(ApiError::Message(
            "Settings document must be a JSON object.".to_owned(),
        ));
    }

    normalize_settings_document(&mut document);
    save_settings_document(store, &document)?;

    Ok(SettingsSnapshot {
        path: store.path().display().to_string(),
        document,
    })
}

fn save_settings_document(store: &Store, document: &Value) -> ApiResult<()> {
    let encoded = serde_json::to_string(document)?;
    let connection = store.connect().map_err(db_error)?;
    connection
        .execute(
            "INSERT INTO settings_document (id, document) VALUES (1, ?1)
             ON CONFLICT (id) DO UPDATE SET document = excluded.document",
            [encoded],
        )
        .map_err(db_error)?;
    Ok(())
}

#[cfg(test)]
mod tests;
