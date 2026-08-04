//! Retirement of settings keys that no longer have a reader.
//!
//! Kept separate from the defaults in `settings.rs` because the two pull in
//! opposite directions: that file describes the settings that exist, this one
//! describes the ones that used to.

use serde_json::{json, Map, Value};

/// Bumped whenever a key is retired, so the prune below runs exactly once per
/// user rather than on every launch.
pub(super) const SETTINGS_SCHEMA_VERSION: i64 = 2;

/// Whole sections that no longer exist. `account` and `ai` were never read;
/// `transfer_profiles` keeps its presets but no longer stores a user-edited
/// profile list.
const RETIRED_SECTIONS: &[&str] = &["account", "ai"];

/// Individual keys retired from sections that still exist.
const RETIRED_KEYS: &[(&str, &str)] = &[
    ("general", "startup_view_index"),
    ("general", "reopen_last_session"),
    ("general", "release_channel_index"),
    ("general", "update_available"),
    ("general", "available_version_label"),
    ("general", "last_update_check_label"),
    ("appearance", "custom_fonts"),
    ("privacy", "data_stays_local"),
    ("search", "automatic_image_discovery_enabled"),
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
            "general": { "startup_view_index": 2, "reopen_last_session": false },
            "appearance": { "custom_fonts": ["Inter"], "theme_index": 1 },
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
        assert!(general.is_none_or(|general| !general.contains_key("startup_view_index")));
        assert!(general.is_none_or(|general| !general.contains_key("reopen_last_session")));
        // A section that still has live keys keeps them.
        assert_eq!(
            root.get("appearance")
                .and_then(Value::as_object)
                .and_then(|appearance| appearance.get("theme_index"))
                .and_then(Value::as_i64),
            Some(1)
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
