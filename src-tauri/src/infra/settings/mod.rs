pub(super) mod migration;
pub mod profile_store;

use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use self::migration::{prune_retired_settings, SETTINGS_SCHEMA_VERSION};

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

/// Sites whose page state is never captured by default (banking, payment,
/// health). Users edit this list in Settings → Privacy.
const DEFAULT_PAGE_STATE_EXCLUSIONS: &str = "paypal.com\nstripe.com\nchase.com\nbankofamerica.com\nwellsfargo.com\nciti.com\ncapitalone.com\namex.com\nschwab.com\nfidelity.com\nvanguard.com\ncoinbase.com\nmychart.org\nkp.org\nirs.gov\nssa.gov";

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

fn normalize_settings_document(document: &mut Value) -> bool {
    let mut changed = false;
    if !document.is_object() {
        *document = Value::Object(Map::new());
        changed = true;
    }

    let root = document.as_object_mut().expect("settings document object");
    // Monotonic: a document already at the current version is left alone, and
    // a newer document (a user who downgraded) is not mangled by this build.
    let stored_version = root
        .get("schema_version")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if stored_version < SETTINGS_SCHEMA_VERSION {
        // Prune before backfilling, or the defaults pass would re-add keys this
        // pass is about to remove. The return value is ignored because bumping
        // the version below already marks the document dirty.
        prune_retired_settings(root);
        root.insert("schema_version".to_owned(), json!(SETTINGS_SCHEMA_VERSION));
        changed = true;
    }

    changed |= ensure_section_defaults(
        root,
        "general",
        &[
            ("launch_on_login", json!(false)),
            ("auto_update_enabled", json!(true)),
            ("preferred_workspace_root", json!("")),
            ("startup_view_index", json!(0)),
            ("reopen_last_session", json!(true)),
            ("browser_search_engine_index", json!(0)),
            ("browser_tab_history_kb", json!(256)),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "appearance",
        &[
            ("theme_mode", json!("dark")),
            ("compact_mode_enabled", json!(false)),
            ("app_zoom", json!(1.0)),
            ("navigator_auto_hide", json!(false)),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "privacy",
        &[
            ("anonymous_usage_analytics_enabled", json!(false)),
            ("anonymous_error_reporting_enabled", json!(false)),
            ("page_state_restore", json!(true)),
            ("page_state_agent_restore", json!(true)),
            (
                "page_state_excluded_sites",
                json!(DEFAULT_PAGE_STATE_EXCLUSIONS),
            ),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "shortcuts",
        &[("shortcut_hints_enabled", json!(true))],
    );
    if let Some(shortcuts) = root.get_mut("shortcuts").and_then(Value::as_object_mut) {
        changed |= shortcuts.remove("custom_shortcuts_enabled").is_some();
    }
    // Voice (docs/design/voice-memory/BRIEF.md). Dictation's shortcut is empty
    // for the platform default: Fn/Globe on macOS, Right Alt on Windows.
    changed |= ensure_section_defaults(
        root,
        "voice",
        &[
            ("dictation_enabled", json!(true)),
            ("dictation_shortcut", json!("")),
            ("dictation_hands_free", json!(true)),
            ("dictation_cleanup", json!(true)),
            ("dictation_style", json!("plain")),
            ("language", json!("auto")),
            ("dictionary", json!("")),
            ("agent_handoff", json!(true)),
            ("capture_sources", json!("mic-tab")),
            ("keep_recordings", json!(false)),
        ],
    );
    // Memory: off until the person turns it on; a pause is a time in ms.
    changed |= ensure_section_defaults(
        root,
        "recall",
        &[
            ("enabled", json!(false)),
            ("paused_until", json!(0)),
            ("excluded_sites", json!("")),
            ("remember_dictation", json!(true)),
        ],
    );
    // Screen memory: a capture session the person starts. It ends after this many idle minutes.
    changed |= ensure_section_defaults(
        root,
        "screen_memory",
        &[
            ("idle_minutes", json!(30)),
            ("excluded_apps", json!("")),
            ("keep_days", json!(30)),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "advanced",
        &[("frame_pacing_overlay_enabled", json!(false))],
    );
    changed
}

fn ensure_section_defaults(
    root: &mut Map<String, Value>,
    section: &str,
    defaults: &[(&str, Value)],
) -> bool {
    let mut changed = false;
    let value = root.entry(section.to_owned()).or_insert_with(|| {
        changed = true;
        Value::Object(Map::new())
    });
    if !value.is_object() {
        *value = Value::Object(Map::new());
        changed = true;
    }
    let section = value.as_object_mut().expect("settings section object");
    for (key, default_value) in defaults {
        if !section.contains_key(*key) {
            section.insert((*key).to_owned(), default_value.clone());
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests;
