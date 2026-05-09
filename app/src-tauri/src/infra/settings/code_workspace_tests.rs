use std::{fs, path::PathBuf};

use serde_json::{json, Value};
use uuid::Uuid;

use super::{load_settings, save_settings_document};

fn settings_path() -> PathBuf {
    std::env::temp_dir()
        .join(format!("misty-code-settings-test-{}", Uuid::new_v4()))
        .join("config")
        .join("settings.json")
}

fn cleanup(path: &std::path::Path) {
    let root = path
        .parent()
        .and_then(std::path::Path::parent)
        .expect("test root");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn upgrades_the_legacy_code_font_default_once() {
    let path = settings_path();
    save_settings_document(
        &path,
        &json!({ "schema_version": 3, "editor": { "font_size": 12.5 } }),
    )
    .expect("write legacy settings");

    let snapshot = load_settings(path.clone()).expect("load settings");
    let editor = snapshot
        .document
        .get("editor")
        .and_then(Value::as_object)
        .expect("editor settings");
    assert_eq!(editor.get("font_size").and_then(Value::as_f64), Some(14.0));
    assert_eq!(
        editor.get("interface_scale").and_then(Value::as_f64),
        Some(1.0)
    );
    assert_eq!(
        editor.get("theme").and_then(Value::as_str),
        Some("gruvbox-dark")
    );
    cleanup(&path);
}

#[test]
fn preserves_a_custom_legacy_font_size() {
    let path = settings_path();
    save_settings_document(
        &path,
        &json!({ "schema_version": 3, "editor": { "font_size": 13.0 } }),
    )
    .expect("write customized settings");

    let snapshot = load_settings(path.clone()).expect("load settings");
    assert_eq!(
        snapshot
            .document
            .get("editor")
            .and_then(Value::as_object)
            .and_then(|editor| editor.get("font_size"))
            .and_then(Value::as_f64),
        Some(13.0)
    );
    cleanup(&path);
}
