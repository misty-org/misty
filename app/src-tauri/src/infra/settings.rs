use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::settings_migration::{
    migrate_code_workspace_settings, prune_retired_settings, SETTINGS_SCHEMA_VERSION,
};

use crate::error::{ApiError, ApiResult};
use crate::infra::environment::AppEnvironmentService;
#[cfg(desktop)]
use crate::infra::system_dependencies::detected_login_shell_path;

#[derive(Debug, Clone)]
pub struct SettingsService {
    path: PathBuf,
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

impl SettingsService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            path: environment.settings_path(),
        }
    }

    pub async fn snapshot(&self) -> ApiResult<SettingsSnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || load_settings(path))
            .await
            .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
    }

    pub async fn save(&self, request: SaveSettingsRequest) -> ApiResult<SettingsSnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || save_settings(path, request.document))
            .await
            .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
    }

    pub async fn open_with_association_for_path(
        &self,
        file_path: String,
    ) -> ApiResult<Option<String>> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || open_with_association_for_path(path, file_path))
            .await
            .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
    }

    pub async fn set_open_with_association_for_path(
        &self,
        file_path: String,
        application_path: String,
    ) -> ApiResult<SettingsSnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            set_open_with_association_for_path(path, file_path, application_path)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
    }

    pub async fn open_with_associations(&self) -> ApiResult<Vec<OpenWithAssociation>> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || open_with_associations(path))
            .await
            .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
    }

    pub async fn remove_open_with_association(&self, key: String) -> ApiResult<SettingsSnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || remove_open_with_association(path, key))
            .await
            .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
    }
}

fn load_settings(path: PathBuf) -> ApiResult<SettingsSnapshot> {
    let mut document = load_settings_document(&path)?;
    migrate_legacy_open_with_if_needed(&path, &mut document)?;
    if normalize_settings_document(&mut document) {
        save_settings_document(&path, &document)?;
    }

    Ok(SettingsSnapshot {
        path: path.display().to_string(),
        document,
    })
}

fn load_settings_document(path: &Path) -> ApiResult<Value> {
    match fs::read_to_string(path) {
        Ok(raw) => Ok(serde_json::from_str::<Value>(&raw)
            .ok()
            .filter(Value::is_object)
            .unwrap_or_else(|| Value::Object(Default::default()))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Ok(Value::Object(Default::default()))
        }
        Err(err) => Err(ApiError::Message(format!(
            "Failed to read ~/.misty/config/settings.json: {err}"
        ))),
    }
}

fn save_settings(path: PathBuf, mut document: Value) -> ApiResult<SettingsSnapshot> {
    if !document.is_object() {
        return Err(ApiError::Message(
            "Settings document must be a JSON object.".to_owned(),
        ));
    }

    normalize_settings_document(&mut document);
    save_settings_document(&path, &document)?;

    Ok(SettingsSnapshot {
        path: path.display().to_string(),
        document,
    })
}

fn save_settings_document(path: &Path, document: &Value) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            ApiError::Message(format!("Failed to create settings directory: {err}"))
        })?;
    }

    let encoded = serde_json::to_string_pretty(document)?;
    fs::write(path, format!("{encoded}\n")).map_err(|err| {
        ApiError::Message(format!(
            "Failed to write ~/.misty/config/settings.json: {err}"
        ))
    })
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
    changed |= migrate_code_workspace_settings(root, stored_version);
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
            ("confirm_destructive_actions", json!(true)),
            ("default_file_action_index", json!(0)),
            ("open_links_externally", json!(true)),
            ("preferred_workspace_root", json!("")),
            ("preferred_terminal_app", json!("System Default")),
            ("default_transfer_behavior_index", json!(0)),
            ("startup_view_index", json!(0)),
            ("reopen_last_session", json!(true)),
            ("browser_search_engine_index", json!(0)),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "appearance",
        &[
            ("compact_mode_enabled", json!(false)),
            ("thumbnail_previews_enabled", json!(true)),
            ("wallpaper_path", json!("")),
            ("panel_opacity", json!(0.82)),
            ("app_zoom", json!(1.0)),
            ("navigator_width_index", json!(0)),
            ("navigator_auto_hide", json!(false)),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "files",
        &[
            ("default_view_mode_index", json!(0)),
            ("show_hidden_files", json!(false)),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "terminal",
        &[
            ("font_family", json!("")),
            ("font_size", json!(13)),
            ("cursor_blink", json!(true)),
            ("cursor_style_index", json!(0)),
            ("scrollback", json!(50000)),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "editor",
        &[
            ("font_family", json!("")),
            ("font_size", json!(14)),
            ("interface_scale", json!(1.0)),
            ("theme", json!("gruvbox-dark")),
            ("tab_size", json!(2)),
            ("word_wrap", json!(true)),
            ("line_numbers", json!(true)),
            ("autosave_delay_ms", json!(1000)),
            ("format_on_save", json!(false)),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "privacy",
        &[
            ("anonymous_usage_analytics_enabled", json!(false)),
            ("anonymous_error_reporting_enabled", json!(false)),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "search",
        &[
            ("automatic_file_discovery_enabled", json!(true)),
            ("discovery_interval_minutes", json!(15)),
            ("max_depth", json!(18)),
            ("include_hidden", json!(false)),
            ("ignored_paths", json!("")),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "transfer_profiles",
        &[
            ("default_profile_id", json!("balanced")),
            (
                "profiles",
                json!([
                    {
                        "id": "balanced",
                        "name": "Balanced",
                        "transfers": 4,
                        "checkers": 8,
                        "bandwidth_limit": "",
                        "retries": 3,
                        "low_level_retries": 10,
                        "checksum": false
                    },
                    {
                        "id": "low-bandwidth",
                        "name": "Low Bandwidth",
                        "transfers": 2,
                        "checkers": 4,
                        "bandwidth_limit": "2Mi",
                        "retries": 3,
                        "low_level_retries": 10,
                        "checksum": false
                    },
                    {
                        "id": "many-small-files",
                        "name": "Many Small Files",
                        "transfers": 8,
                        "checkers": 16,
                        "bandwidth_limit": "",
                        "retries": 3,
                        "low_level_retries": 10,
                        "checksum": false
                    },
                    {
                        "id": "careful-verify",
                        "name": "Careful Verify",
                        "transfers": 2,
                        "checkers": 4,
                        "bandwidth_limit": "",
                        "retries": 5,
                        "low_level_retries": 10,
                        "checksum": true
                    }
                ]),
            ),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "notifications",
        &[
            ("desktop_notifications_enabled", json!(true)),
            ("in_app_notifications_enabled", json!(true)),
            ("sound_notifications_enabled", json!(false)),
            ("badge_count_enabled", json!(true)),
            ("quiet_hours_enabled", json!(false)),
            ("digest_notifications_enabled", json!(false)),
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "shortcuts",
        &[
            ("custom_shortcuts_enabled", json!(false)),
            ("shortcut_hints_enabled", json!(true)),
        ],
    );
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

fn open_with_association_for_path(
    settings_path: PathBuf,
    file_path: String,
) -> ApiResult<Option<String>> {
    let mut document = load_settings_document(&settings_path)?;
    migrate_legacy_open_with_if_needed(&settings_path, &mut document)?;
    let key = association_key_for_path(&file_path);
    let Some(open_with) = document.get_mut("open_with").and_then(Value::as_object_mut) else {
        return Ok(None);
    };
    let Some(application_path) = open_with
        .get(&key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
    else {
        return Ok(None);
    };

    if Path::new(&application_path).exists() {
        return Ok(Some(application_path));
    }

    open_with.remove(&key);
    save_settings_document(&settings_path, &document)?;
    Ok(None)
}

fn set_open_with_association_for_path(
    settings_path: PathBuf,
    file_path: String,
    application_path: String,
) -> ApiResult<SettingsSnapshot> {
    if application_path.trim().is_empty() {
        return Err(ApiError::Message(
            "Application path is required.".to_owned(),
        ));
    }

    let mut document = load_settings_document(&settings_path)?;
    migrate_legacy_open_with_if_needed(&settings_path, &mut document)?;
    let key = association_key_for_path(&file_path);
    let Some(root) = document.as_object_mut() else {
        return Err(ApiError::Message(
            "Settings document must be a JSON object.".to_owned(),
        ));
    };
    let open_with = root
        .entry("open_with")
        .or_insert_with(|| Value::Object(Default::default()));
    if !open_with.is_object() {
        *open_with = Value::Object(Default::default());
    }
    open_with
        .as_object_mut()
        .expect("open_with object")
        .insert(key, Value::String(application_path));
    save_settings(settings_path, document)
}

fn open_with_associations(settings_path: PathBuf) -> ApiResult<Vec<OpenWithAssociation>> {
    let mut document = load_settings_document(&settings_path)?;
    migrate_legacy_open_with_if_needed(&settings_path, &mut document)?;
    let Some(open_with) = document.get_mut("open_with").and_then(Value::as_object_mut) else {
        return Ok(Vec::new());
    };

    let mut removed_missing = false;
    let mut associations = Vec::new();
    open_with.retain(|key, value| {
        let Some(application_path) = value.as_str().filter(|value| !value.trim().is_empty()) else {
            removed_missing = true;
            return false;
        };
        if !Path::new(application_path).exists() {
            removed_missing = true;
            return false;
        }
        associations.push(OpenWithAssociation {
            key: key.clone(),
            application_path: application_path.to_owned(),
        });
        true
    });
    associations.sort_by(|left, right| left.key.cmp(&right.key));
    if removed_missing {
        save_settings_document(&settings_path, &document)?;
    }
    Ok(associations)
}

fn remove_open_with_association(
    settings_path: PathBuf,
    key: String,
) -> ApiResult<SettingsSnapshot> {
    let mut document = load_settings_document(&settings_path)?;
    migrate_legacy_open_with_if_needed(&settings_path, &mut document)?;
    let Some(root) = document.as_object_mut() else {
        return Err(ApiError::Message(
            "Settings document must be a JSON object.".to_owned(),
        ));
    };
    if let Some(open_with) = root.get_mut("open_with").and_then(Value::as_object_mut) {
        open_with.remove(&key);
    }
    save_settings(settings_path, document)
}

fn migrate_legacy_open_with_if_needed(settings_path: &Path, document: &mut Value) -> ApiResult<()> {
    if document.get("open_with").is_some_and(Value::is_object) {
        return Ok(());
    }

    let Some(legacy_path) = legacy_open_with_path(settings_path) else {
        return Ok(());
    };
    let legacy = match fs::read_to_string(&legacy_path) {
        Ok(raw) => serde_json::from_str::<Value>(&raw)
            .ok()
            .filter(Value::is_object)
            .unwrap_or_else(|| Value::Object(Default::default())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => {
            return Err(ApiError::Message(format!(
                "Failed to read legacy open_with.json: {err}"
            )));
        }
    };
    let Some(legacy_map) = legacy.as_object() else {
        return Ok(());
    };
    let open_with = legacy_map
        .iter()
        .filter_map(|(key, value)| {
            value
                .as_str()
                .map(|path| (key.clone(), Value::String(path.to_owned())))
        })
        .collect();
    if let Some(root) = document.as_object_mut() {
        root.insert("open_with".to_owned(), Value::Object(open_with));
        save_settings_document(settings_path, document)?;
        let _ = fs::remove_file(legacy_path);
    }
    Ok(())
}

fn legacy_open_with_path(settings_path: &Path) -> Option<PathBuf> {
    settings_path
        .parent()?
        .parent()
        .map(|root| root.join("open_with.json"))
}

fn association_key_for_path(file_path: &str) -> String {
    let normalized = file_path.replace('\\', "/");
    let file_name = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .next_back()
        .unwrap_or(file_path);
    let key = file_name
        .rfind('.')
        .map(|index| &file_name[index..])
        .unwrap_or(file_name);
    key.to_lowercase()
}

#[cfg(test)]
#[path = "settings/code_workspace_tests.rs"]
mod code_workspace_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    fn test_settings_path() -> PathBuf {
        let root = std::env::temp_dir().join(format!("misty-settings-test-{}", Uuid::new_v4()));
        root.join("config").join("settings.json")
    }

    fn make_existing_app(settings_path: &Path, name: &str) -> PathBuf {
        let app_path = settings_path
            .parent()
            .and_then(Path::parent)
            .expect("test settings root")
            .join(name);
        fs::create_dir_all(app_path.parent().expect("test app parent")).expect("create app parent");
        fs::write(&app_path, "test app").expect("write test app");
        app_path
    }

    #[test]
    fn load_settings_normalizes_imgui_settings_schema_without_clobbering_existing_values() {
        let settings_path = test_settings_path();
        save_settings_document(
            &settings_path,
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
                "plugin_namespace": {
                    "enabled": true
                }
            }),
        )
        .expect("write partial settings");

        let snapshot = load_settings(settings_path.clone()).expect("load settings");
        let document = snapshot.document;
        assert_eq!(
            document.get("schema_version").and_then(Value::as_i64),
            Some(SETTINGS_SCHEMA_VERSION)
        );
        assert_eq!(
            document
                .get("general")
                .and_then(Value::as_object)
                .and_then(|general| general.get("preferred_terminal_app"))
                .and_then(Value::as_str),
            Some("Ghostty"),
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
                .get("general")
                .and_then(Value::as_object)
                .and_then(|general| general.get("open_links_externally"))
                .and_then(Value::as_bool),
            Some(true),
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
        assert!(document
            .get("notifications")
            .and_then(Value::as_object)
            .is_some_and(
                |notifications| notifications.contains_key("desktop_notifications_enabled")
            ));
        assert_eq!(
            document
                .get("search")
                .and_then(Value::as_object)
                .and_then(|search| search.get("automatic_file_discovery_enabled"))
                .and_then(Value::as_bool),
            Some(true),
        );
        assert!(!document
            .get("search")
            .and_then(Value::as_object)
            .is_some_and(|search| search.contains_key("automatic_image_discovery_enabled")));

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
            ("editor", "tab_size"),
            ("files", "default_view_mode_index"),
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

        let _ = fs::remove_dir_all(
            settings_path
                .parent()
                .and_then(Path::parent)
                .expect("test root"),
        );
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
        let settings_path = test_settings_path();
        let app_path = make_existing_app(&settings_path, "Preview.app");

        set_open_with_association_for_path(
            settings_path.clone(),
            "/tmp/report.PDF".to_owned(),
            app_path.display().to_string(),
        )
        .expect("set association");

        let association =
            open_with_association_for_path(settings_path.clone(), "/tmp/other.pdf".to_owned())
                .expect("get association");
        assert_eq!(association, Some(app_path.display().to_string()));

        let saved = load_settings_document(&settings_path).expect("load settings");
        assert_eq!(
            saved
                .get("open_with")
                .and_then(Value::as_object)
                .and_then(|open_with| open_with.get(".pdf"))
                .and_then(Value::as_str),
            Some(app_path.to_str().expect("utf-8 app path")),
        );

        let _ = fs::remove_dir_all(
            settings_path
                .parent()
                .and_then(Path::parent)
                .expect("test root"),
        );
    }

    #[test]
    fn missing_open_with_application_is_pruned() {
        let settings_path = test_settings_path();
        save_settings(
            settings_path.clone(),
            json!({ "open_with": { ".txt": "/definitely/missing/app" } }),
        )
        .expect("save settings");

        let association =
            open_with_association_for_path(settings_path.clone(), "/tmp/note.txt".to_owned())
                .expect("get association");
        assert_eq!(association, None);

        let saved = load_settings_document(&settings_path).expect("load settings");
        assert!(saved
            .get("open_with")
            .and_then(Value::as_object)
            .and_then(|open_with| open_with.get(".txt"))
            .is_none(),);

        let _ = fs::remove_dir_all(
            settings_path
                .parent()
                .and_then(Path::parent)
                .expect("test root"),
        );
    }

    #[test]
    fn legacy_open_with_file_migrates_into_settings() {
        let settings_path = test_settings_path();
        let root = settings_path
            .parent()
            .and_then(Path::parent)
            .expect("test root");
        fs::create_dir_all(root).expect("create test root");
        let app_path = make_existing_app(&settings_path, "Editor.app");
        fs::write(
            root.join("open_with.json"),
            json!({ ".md": app_path.display().to_string() }).to_string(),
        )
        .expect("write legacy open_with");

        let association =
            open_with_association_for_path(settings_path.clone(), "/tmp/readme.md".to_owned())
                .expect("get association");
        assert_eq!(association, Some(app_path.display().to_string()));
        assert!(!root.join("open_with.json").exists());

        let saved = load_settings_document(&settings_path).expect("load settings");
        assert_eq!(
            saved
                .get("open_with")
                .and_then(Value::as_object)
                .and_then(|open_with| open_with.get(".md"))
                .and_then(Value::as_str),
            Some(app_path.to_str().expect("utf-8 app path")),
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn lists_open_with_associations_and_prunes_missing_apps() {
        let settings_path = test_settings_path();
        let app_path = make_existing_app(&settings_path, "TextEdit.app");
        save_settings(
            settings_path.clone(),
            json!({
                "open_with": {
                    ".txt": app_path.display().to_string(),
                    ".bad": "/definitely/missing/app"
                }
            }),
        )
        .expect("save settings");

        let associations =
            open_with_associations(settings_path.clone()).expect("list associations");
        assert_eq!(associations.len(), 1);
        assert_eq!(associations[0].key, ".txt");
        assert_eq!(
            associations[0].application_path,
            app_path.display().to_string()
        );

        let saved = load_settings_document(&settings_path).expect("load settings");
        assert!(saved
            .get("open_with")
            .and_then(Value::as_object)
            .and_then(|open_with| open_with.get(".bad"))
            .is_none());

        let _ = fs::remove_dir_all(
            settings_path
                .parent()
                .and_then(Path::parent)
                .expect("test root"),
        );
    }

    #[test]
    fn removes_open_with_association_by_key() {
        let settings_path = test_settings_path();
        let app_path = make_existing_app(&settings_path, "Preview.app");
        save_settings(
            settings_path.clone(),
            json!({ "open_with": { ".pdf": app_path.display().to_string() } }),
        )
        .expect("save settings");

        remove_open_with_association(settings_path.clone(), ".pdf".to_owned())
            .expect("remove association");

        let saved = load_settings_document(&settings_path).expect("load settings");
        assert!(saved
            .get("open_with")
            .and_then(Value::as_object)
            .and_then(|open_with| open_with.get(".pdf"))
            .is_none());

        let _ = fs::remove_dir_all(
            settings_path
                .parent()
                .and_then(Path::parent)
                .expect("test root"),
        );
    }
}
