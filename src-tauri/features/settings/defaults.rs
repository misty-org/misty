//! Defaults backfilled into the settings document, and the schema-version bump.

use serde_json::{json, Map, Value};

use super::migration::{prune_retired_settings, SETTINGS_SCHEMA_VERSION};

pub(super) fn normalize_settings_document(document: &mut Value) -> bool {
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
        ],
    );
    changed |= ensure_section_defaults(
        root,
        "appearance",
        &[
            ("theme_mode", json!("dark")),
            ("compact_mode_enabled", json!(false)),
            ("app_zoom", json!(1.0)),
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
    // Voice. Dictation's shortcut is empty
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
            ("capture_sources", json!("mic-system")),
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
