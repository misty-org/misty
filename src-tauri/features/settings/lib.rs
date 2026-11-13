mod error;
pub use error::{Error, Result};
mod defaults;
pub mod migration;
pub mod profile_store;

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use self::defaults::normalize_settings_document;

use crate::error::{Error as ApiError, Result as ApiResult};
use database::environment::AppEnvironmentService;

use database::store::Store;

/// This device's settings: one JSON document (sections and keys) in `misty.db`. Settings
/// never leave the device; nothing here talks to the server.
#[derive(Debug, Clone)]
pub struct SettingsService {
    store: Store,
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
        .map_err(|err| ApiError::new(format!("Settings worker failed: {err}")))?
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
        }
    }

    pub async fn snapshot(&self) -> ApiResult<SettingsSnapshot> {
        let store = self.store.clone();
        blocking(move || load_settings(&store)).await
    }

    pub async fn save(&self, request: SaveSettingsRequest) -> ApiResult<SettingsSnapshot> {
        let store = self.store.clone();
        let saved = blocking(move || save_settings(&store, request.document)).await;
        saved
    }

    /// The saved sections-and-keys document, read without normalizing.
    pub async fn document(&self) -> ApiResult<Value> {
        let store = self.store.clone();
        blocking(move || load_settings_document(&store)).await
    }
}

fn db_error(error: rusqlite::Error) -> ApiError {
    ApiError::new(format!("Settings persistence failed: {error}"))
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
        return Err(ApiError::new(
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

pub mod shortcuts;
#[cfg(test)]
mod tests;

/// Tests never reach the person's real data, whatever they exercise.
#[cfg(test)]
#[ctor::ctor]
fn isolate_tests() {
    file_access::paths::isolate_for_tests();
}
