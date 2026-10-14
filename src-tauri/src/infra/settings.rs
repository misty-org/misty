use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::settings_migration::{prune_retired_settings, SETTINGS_SCHEMA_VERSION};

use crate::error::{ApiError, ApiResult};
use crate::infra::environment::AppEnvironmentService;
#[cfg(desktop)]
use crate::infra::system_dependencies::detected_login_shell_path;

#[path = "settings/open_with.rs"]
mod open_with;
use super::store::Store;
use open_with::{
    association_key_for_path, open_with_association_for_path, open_with_associations,
    remove_open_with_association, set_open_with_association_for_path,
};

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWithAssociation {
    pub key: String,
    pub application_path: String,
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
    ) -> ApiResult<super::settings_profile_store::ProfileStateSnapshot> {
        let store = self.store.clone();
        blocking(move || super::settings_profile_store::profile_state(&store, &scope, update)).await
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

    pub async fn open_with_association_for_path(
        &self,
        file_path: String,
    ) -> ApiResult<Option<String>> {
        let store = self.store.clone();
        blocking(move || open_with_association_for_path(&store, file_path)).await
    }

    pub async fn set_open_with_association_for_path(
        &self,
        file_path: String,
        application_path: String,
    ) -> ApiResult<SettingsSnapshot> {
        let store = self.store.clone();
        blocking(move || set_open_with_association_for_path(&store, file_path, application_path))
            .await
    }

    pub async fn open_with_associations(&self) -> ApiResult<Vec<OpenWithAssociation>> {
        let store = self.store.clone();
        blocking(move || open_with_associations(&store)).await
    }

    pub async fn remove_open_with_association(&self, key: String) -> ApiResult<SettingsSnapshot> {
        let store = self.store.clone();
        blocking(move || remove_open_with_association(&store, key)).await
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

    #[cfg(desktop)]
    let default_extension_tools_path = detected_login_shell_path();
    #[cfg(not(desktop))]
    let default_extension_tools_path = String::new();
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
    changed |= ensure_section_defaults(
        root,
        "advanced",
        &[
            ("mount_path", json!(".misty/mnt")),
            ("extension_tools_path", json!(default_extension_tools_path)),
            ("frame_pacing_overlay_enabled", json!(false)),
        ],
    );
    changed |= ensure_object(root, "open_with");

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

fn ensure_object(root: &mut Map<String, Value>, key: &str) -> bool {
    match root.get(key) {
        Some(value) if value.is_object() => false,
        _ => {
            root.insert(key.to_owned(), Value::Object(Map::new()));
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_store() -> (tempfile::TempDir, Store) {
        let directory = tempfile::tempdir().expect("temp dir");
        let store = Store::at(directory.path().join("misty.db"));
        (directory, store)
    }

    fn make_existing_app(directory: &Path, name: &str) -> PathBuf {
        let app_path = directory.join(name);
        fs::write(&app_path, "test app").expect("write test app");
        app_path
    }

    #[test]
    fn load_settings_normalizes_imgui_settings_schema_without_clobbering_existing_values() {
        let (_directory, store) = test_store();
        save_settings_document(
            &store,
            &json!({
                "general": {
                    "preferred_terminal_app": "Ghostty",
                    "custom_general_value": "kept"
                },
                "appearance": {
                    "custom_theme": { "accent": "#80aaff" },
                    "ui_scale_index": 2,
                    "font_size_index": 2,
                    "reduced_motion_enabled": true,
                    "theme_index": 1
                },
                "shortcuts": { "keymap_index": 1 },
                "advanced": { "server_address": "localhost:50051" },
                "editor": { "tab_size": 4 },
                "terminal": { "scrollback": 1000 },
                "files": { "show_hidden_files": true },
                "search": { "automatic_file_discovery_enabled": false },
                "transfer_profiles": { "default_profile_id": "balanced" },
                "plugin_namespace": {
                    "enabled": true
                }
            }),
        )
        .expect("write partial settings");

        let snapshot = load_settings(&store).expect("load settings");
        let document = snapshot.document;
        assert_eq!(
            document.get("schema_version").and_then(Value::as_i64),
            Some(SETTINGS_SCHEMA_VERSION)
        );
        // Unknown keys must survive the prune, or an extension's settings would
        // vanish on upgrade.
        assert_eq!(
            document
                .get("general")
                .and_then(Value::as_object)
                .and_then(|general| general.get("custom_general_value"))
                .and_then(Value::as_str),
            Some("kept"),
        );
        assert_eq!(
            document
                .get("appearance")
                .and_then(Value::as_object)
                .and_then(|appearance| appearance.get("custom_theme"))
                .and_then(Value::as_object)
                .and_then(|custom_theme| custom_theme.get("accent"))
                .and_then(Value::as_str),
            Some("#80aaff"),
        );
        assert_eq!(
            document
                .get("plugin_namespace")
                .and_then(Value::as_object)
                .and_then(|plugin| plugin.get("enabled"))
                .and_then(Value::as_bool),
            Some(true),
        );
        // Schema 6: the Code workspace, file manager and file indexing left Misty, so their
        // sections are neither kept nor backfilled.
        for section in ["search", "editor", "terminal", "files", "transfer_profiles"] {
            assert!(
                !document
                    .as_object()
                    .is_some_and(|root| root.contains_key(section)),
                "{section} should have been pruned",
            );
        }
        assert!(!document
            .get("general")
            .and_then(Value::as_object)
            .is_some_and(|general| general.contains_key("preferred_terminal_app")));

        // Schema 3 retirements: controls that persisted but had no reader.
        for (section, key) in [
            ("appearance", "ui_scale_index"),
            ("appearance", "font_size_index"),
            ("appearance", "reduced_motion_enabled"),
            ("appearance", "theme_index"),
            ("shortcuts", "keymap_index"),
            ("advanced", "server_address"),
        ] {
            assert!(
                !document
                    .get(section)
                    .and_then(Value::as_object)
                    .is_some_and(|entries| entries.contains_key(key)),
                "{section}.{key} should have been pruned",
            );
        }

        // Sections introduced alongside the redesign must be backfilled.
        for (section, key) in [
            ("general", "reopen_last_session"),
            ("appearance", "app_zoom"),
        ] {
            assert!(
                document
                    .get(section)
                    .and_then(Value::as_object)
                    .is_some_and(|entries| entries.contains_key(key)),
                "{section}.{key} should have been backfilled",
            );
        }
    }

    #[test]
    fn an_earlier_settings_file_is_imported_once_and_left_in_place() {
        let (directory, store) = test_store();
        let legacy = directory.path().join("settings.json");
        fs::write(
            &legacy,
            r#"{"general":{"custom_general_value":"from file"}}"#,
        )
        .unwrap();
        import_legacy_settings(&store, &legacy).unwrap();
        assert_eq!(
            load_settings_document(&store).unwrap()["general"]["custom_general_value"],
            "from file"
        );
        // Later edits are never overwritten by the old file.
        save_settings_document(
            &store,
            &json!({"general":{"custom_general_value":"edited"}}),
        )
        .unwrap();
        import_legacy_settings(&store, &legacy).unwrap();
        assert_eq!(
            load_settings_document(&store).unwrap()["general"]["custom_general_value"],
            "edited"
        );
        assert!(legacy.exists());
    }

    #[test]
    fn association_key_matches_native_extension_or_filename_rules() {
        assert_eq!(association_key_for_path("/tmp/Report.PDF"), ".pdf");
        assert_eq!(
            association_key_for_path("C:\\Users\\me\\Makefile"),
            "makefile"
        );
    }

    #[test]
    fn set_and_get_open_with_association_uses_settings_document() {
        let (directory, store) = test_store();
        let app_path = make_existing_app(directory.path(), "Preview.app");

        set_open_with_association_for_path(
            &store,
            "/tmp/report.PDF".to_owned(),
            app_path.display().to_string(),
        )
        .expect("set association");

        let association = open_with_association_for_path(&store, "/tmp/other.pdf".to_owned())
            .expect("get association");
        assert_eq!(association, Some(app_path.display().to_string()));

        let saved = load_settings_document(&store).expect("load settings");
        assert_eq!(
            saved["open_with"][".pdf"].as_str(),
            Some(app_path.to_str().expect("utf-8 app path")),
        );
    }

    #[test]
    fn missing_open_with_application_is_pruned() {
        let (_directory, store) = test_store();
        save_settings(
            &store,
            json!({ "open_with": { ".txt": "/definitely/missing/app" } }),
        )
        .expect("save settings");

        let association = open_with_association_for_path(&store, "/tmp/note.txt".to_owned())
            .expect("get association");
        assert_eq!(association, None);

        let saved = load_settings_document(&store).expect("load settings");
        assert!(saved["open_with"].get(".txt").is_none());
    }

    #[test]
    fn lists_open_with_associations_and_prunes_missing_apps() {
        let (directory, store) = test_store();
        let app_path = make_existing_app(directory.path(), "TextEdit.app");
        save_settings(
            &store,
            json!({
                "open_with": {
                    ".txt": app_path.display().to_string(),
                    ".bad": "/definitely/missing/app"
                }
            }),
        )
        .expect("save settings");

        let associations = open_with_associations(&store).expect("list associations");
        assert_eq!(associations.len(), 1);
        assert_eq!(associations[0].key, ".txt");
        assert_eq!(
            associations[0].application_path,
            app_path.display().to_string()
        );

        let saved = load_settings_document(&store).expect("load settings");
        assert!(saved["open_with"].get(".bad").is_none());
    }

    #[test]
    fn removes_open_with_association_by_key() {
        let (directory, store) = test_store();
        let app_path = make_existing_app(directory.path(), "Preview.app");
        save_settings(
            &store,
            json!({ "open_with": { ".pdf": app_path.display().to_string() } }),
        )
        .expect("save settings");

        remove_open_with_association(&store, ".pdf".to_owned()).expect("remove association");

        let saved = load_settings_document(&store).expect("load settings");
        assert!(saved["open_with"].get(".pdf").is_none());
    }
}
