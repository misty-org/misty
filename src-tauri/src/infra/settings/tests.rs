use super::migration::SETTINGS_SCHEMA_VERSION;
use super::*;
use serde_json::json;

fn test_store() -> (tempfile::TempDir, Store) {
    let directory = tempfile::tempdir().expect("temp dir");
    let store = Store::at(directory.path().join("misty.db"));
    (directory, store)
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
