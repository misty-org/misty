use serde_json::{Map, Value};

pub(super) const SETTINGS_SCHEMA_VERSION: i64 = 15;

const RETIRED_SECTIONS: &[&str] = &[
    "account",
    "ai",
    "editor",
    "terminal",
    "files",
    "search",
    "transfer_profiles",
    "open_with",
    "screen_memory",
    "recall",
];

const RETIRED_KEYS: &[(&str, &str)] = &[
    ("general", "release_channel_index"),
    ("general", "update_available"),
    ("general", "available_version_label"),
    ("general", "last_update_check_label"),
    ("appearance", "custom_fonts"),
    ("privacy", "data_stays_local"),
    ("appearance", "theme_index"),
    ("appearance", "ui_scale_index"),
    ("appearance", "font_size_index"),
    ("appearance", "reduced_motion_enabled"),
    ("shortcuts", "keymap_index"),
    ("advanced", "server_address"),
    ("general", "confirm_destructive_actions"),
    ("general", "default_file_action_index"),
    ("general", "open_links_externally"),
    ("general", "preferred_terminal_app"),
    ("general", "default_transfer_behavior_index"),
    ("general", "browser_bookmarks_bar"),
    ("appearance", "thumbnail_previews_enabled"),
    ("agent", "default_model_id"),
    ("agent", "default_reasoning_effort"),
    ("appearance", "wallpaper_path"),
    ("appearance", "panel_opacity"),
    ("appearance", "accent_color"),
    ("appearance", "theme_light_start"),
    ("appearance", "theme_dark_start"),
    ("advanced", "mount_path"),
    ("advanced", "extension_tools_path"),
    ("privacy", "anonymous_usage_analytics_enabled"),
    ("privacy", "anonymous_error_reporting_enabled"),
    ("agent", "office_sounds"),
    ("agent", "studio_sounds"),
];

const RENAMED_KEYS: &[(&str, &str, &str)] = &[];

pub(super) fn prune_retired_settings(root: &mut Map<String, Value>) -> bool {
    let mut changed = false;

    for (section, old, new) in RENAMED_KEYS {
        let Some(entries) = root.get_mut(*section).and_then(Value::as_object_mut) else {
            continue;
        };
        if let Some(value) = entries.remove(*old) {
            entries.entry(*new).or_insert(value);
            changed = true;
        }
    }

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
            "privacy": {
                "data_stays_local": true,
                "anonymous_usage_analytics_enabled": true,
                "anonymous_error_reporting_enabled": true,
                "page_state_restore": false
            },
            "search": { "automatic_image_discovery_enabled": false },
            "account": { "email": "someone@example.com" },
            "ai": { "api_key": "sk-secret" }
        }));

        assert!(prune_retired_settings(&mut root));

        assert!(!root.contains_key("account"));
        assert!(!root.contains_key("ai"));
        let general = root.get("general").and_then(Value::as_object);
        assert!(general.is_none_or(|general| !general.contains_key("release_channel_index")));
        let appearance = root.get("appearance").and_then(Value::as_object);
        assert!(appearance.is_none_or(|appearance| !appearance.contains_key("theme_index")));
        assert!(!root.contains_key("shortcuts"));
        assert!(!root.contains_key("advanced"));
        assert_eq!(
            root.get("appearance")
                .and_then(Value::as_object)
                .and_then(|appearance| appearance.get("compact_mode_enabled"))
                .and_then(Value::as_bool),
            Some(true)
        );
        let privacy = root.get("privacy").and_then(Value::as_object).unwrap();
        assert!(!privacy.contains_key("anonymous_usage_analytics_enabled"));
        assert!(!privacy.contains_key("anonymous_error_reporting_enabled"));
        assert_eq!(
            privacy.get("page_state_restore").and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn retires_studio_sounds() {
        let mut root = object(json!({
            "agent": { "office_sounds": true, "studio_sounds": true, "panel_side": "left" }
        }));
        assert!(prune_retired_settings(&mut root));
        let agent = root.get("agent").and_then(Value::as_object).unwrap();
        assert!(!agent.contains_key("office_sounds"));
        assert!(!agent.contains_key("studio_sounds"));
        assert_eq!(
            agent.get("panel_side").and_then(Value::as_str),
            Some("left")
        );
    }

    #[test]
    fn leaves_unknown_namespaces_untouched() {
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
