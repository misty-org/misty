//! Retirement of settings keys that no longer have a reader.
//!
//! Kept separate from the defaults in `settings.rs` because the two pull in
//! opposite directions: that file describes the settings that exist, this one
//! describes the ones that used to.

use serde_json::{json, Map, Value};

/// Bumped whenever a key is retired, so the prune below runs exactly once per
/// user rather than on every launch.
pub(super) const SETTINGS_SCHEMA_VERSION: i64 = 4;

/// Upgrades values whose old defaults would otherwise make the redesigned
/// Code workspace look unchanged after installing the new interface.
pub(super) fn migrate_code_workspace_settings(
    root: &mut Map<String, Value>,
    stored_version: i64,
) -> bool {
    if stored_version >= 4 {
        return false;
    }
    let Some(font_size) = root
        .get_mut("editor")
        .and_then(Value::as_object_mut)
        .and_then(|editor| editor.get_mut("font_size"))
    else {
        return false;
    };
    if font_size.as_f64() != Some(12.5) {
        return false;
    }
    *font_size = json!(14);
    true
}

/// Whole sections that no longer exist. `account` and `ai` were never read;
/// `transfer_profiles` keeps its presets but no longer stores a user-edited
/// profile list.
const RETIRED_SECTIONS: &[&str] = &["account", "ai"];

/// Individual keys retired from sections that still exist.
const RETIRED_KEYS: &[(&str, &str)] = &[
    ("general", "release_channel_index"),
    ("general", "update_available"),
    ("general", "available_version_label"),
    ("general", "last_update_check_label"),
    ("appearance", "custom_fonts"),
    ("privacy", "data_stays_local"),
    ("search", "automatic_image_discovery_enabled"),
    // Schema 3. Each of these persisted happily and was read by nothing:
    // `ui_scale_index`/`font_size_index`/`reduced_motion_enabled` reached the
    // DOM as data attributes with no CSS or JS consumer, `theme_index` was
    // ignored by a dark-only theme store, `keymap_index` was never applied to
    // any keymap, and `server_address` had no reader at all.
    ("appearance", "theme_index"),
    ("appearance", "ui_scale_index"),
    ("appearance", "font_size_index"),
    ("appearance", "reduced_motion_enabled"),
    ("shortcuts", "keymap_index"),
    ("advanced", "server_address"),
];

/// Removes retired keys from an existing settings file.
///
/// Deliberately an allowlist rather than a wholesale rewrite: unknown keys and
/// extension-owned namespaces must survive untouched, which the round-trip test
/// asserts by planting a plugin namespace.
pub(super) fn prune_retired_settings(root: &mut Map<String, Value>) -> bool {
    let mut changed = false;

    for section in RETIRED_SECTIONS {
        if root.remove(*section).is_some() {
            changed = true;
        }
    }

    for (section, key) in RETIRED_KEYS {
        let Some(entries) = root.get_mut(*section).and_then(Value::as_object_mut) else {
            continue;
        };
        if entries.remove(*key).is_some() {
            changed = true;
        }
        // Do not leave an empty object behind where a section used to be.
        if entries.is_empty() {
            root.remove(*section);
        }
    }

    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn object(value: Value) -> Map<String, Value> {
        value.as_object().expect("test object").clone()
    }

    #[test]
    fn removes_retired_sections_and_keys() {
        let mut root = object(json!({
            "general": { "release_channel_index": 1, "open_links_externally": false },
            "appearance": { "custom_fonts": ["Inter"], "theme_index": 1, "compact_mode_enabled": true },
            "shortcuts": { "keymap_index": 2 },
            "advanced": { "server_address": "localhost:50051" },
            "privacy": { "data_stays_local": true, "anonymous_usage_analytics_enabled": true },
            "search": { "automatic_image_discovery_enabled": false },
            "account": { "email": "someone@example.com" },
            "ai": { "api_key": "sk-secret" }
        }));

        assert!(prune_retired_settings(&mut root));

        // Whole retired sections go, including the plaintext credential slot
        // that nothing ever read.
        assert!(!root.contains_key("account"));
        assert!(!root.contains_key("ai"));
        let general = root.get("general").and_then(Value::as_object);
        assert!(general.is_none_or(|general| !general.contains_key("release_channel_index")));
        // Schema 3: controls that persisted with no reader. `shortcuts` and
        // `advanced` had nothing else in them here, so the whole section goes.
        let appearance = root.get("appearance").and_then(Value::as_object);
        assert!(appearance.is_none_or(|appearance| !appearance.contains_key("theme_index")));
        assert!(!root.contains_key("shortcuts"));
        assert!(!root.contains_key("advanced"));
        // A section that still has live keys keeps them.
        assert_eq!(
            root.get("appearance")
                .and_then(Value::as_object)
                .and_then(|appearance| appearance.get("compact_mode_enabled"))
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            root.get("privacy")
                .and_then(Value::as_object)
                .and_then(|privacy| privacy.get("anonymous_usage_analytics_enabled"))
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn leaves_unknown_namespaces_untouched() {
        // Extension-owned settings live alongside ours; a wholesale rewrite
        // would silently delete them on upgrade.
        let mut root = object(json!({
            "plugin_namespace": { "enabled": true },
            "general": { "custom_general_value": "kept" }
        }));

        assert!(!prune_retired_settings(&mut root));
        assert_eq!(
            root.get("plugin_namespace")
                .and_then(Value::as_object)
                .and_then(|plugin| plugin.get("enabled"))
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            root.get("general")
                .and_then(Value::as_object)
                .and_then(|general| general.get("custom_general_value"))
                .and_then(Value::as_str),
            Some("kept")
        );
    }

    #[test]
    fn drops_a_section_left_empty_by_the_prune() {
        let mut root = object(json!({ "privacy": { "data_stays_local": true } }));

        assert!(prune_retired_settings(&mut root));
        assert!(!root.contains_key("privacy"));
    }

    #[test]
    fn reports_no_change_for_an_already_clean_document() {
        let mut root = object(json!({ "general": { "launch_on_login": true } }));

        assert!(!prune_retired_settings(&mut root));
    }
}
