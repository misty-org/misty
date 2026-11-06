//! Application commands have no implicit permission to run in content views.
//! Plugin commands are separately checked by Tauri's per-WebView capabilities.
use crate::infra::profile_windows;

/// What an incognito window may never reach: account data, sync, recovery, history,
/// memory and agents. Incognito is entirely local and Misty does nothing with it.
const ACCOUNT_DATA: [&str; 14] = [
    "agent",
    "profile_records_",
    "profile_tabs_",
    "profile_extensions_",
    "vault_",
    "browser_history",
    "browser_library",
    "cursor_companion_",
    "misty_screen",
    "browser_passwords",
    "browser_site_data",
    "voice_",
    "dictation_",
    "capture_",
];

pub fn allows(label: &str, command: &str) -> bool {
    if profile_windows::is_incognito_window(label)
        && ACCOUNT_DATA
            .iter()
            .any(|prefix| command.starts_with(prefix))
    {
        return false;
    }
    if command.starts_with("extensions_")
        || command.starts_with("profile_records_")
        || command.starts_with("profile_tabs_")
        || command.starts_with("profile_extensions_")
        || command.starts_with("vault_")
        || command.starts_with("browser_recovery_")
        // Copies of account data; only the main workspace reads or clears them.
        || command.starts_with("api_cache_")
        // Reads other browsers' profiles, sign-ins included.
        || command.starts_with("browser_import_")
        // Saves and removes the device's model provider keys.
        || command.starts_with("model_keys_")
    {
        return profile_windows::is_person_window(label);
    }
    match label {
        _ if profile_windows::is_app_window(label) => true,
        _ if label
            .strip_prefix("misty-cursor-")
            .and_then(|id| id.parse::<u32>().ok())
            .is_some() =>
        {
            command == "cursor_companion_snapshot"
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_overlays_can_only_read_their_presentation_snapshot() {
        for label in ["misty-cursor-1", "misty-cursor-4294967295"] {
            assert!(allows(label, "cursor_companion_snapshot"));
            for command in [
                "cursor_companion_configure",
                "cursor_companion_present",
                "cursor_companion_capture",
                "cursor_companion_interrupt",
                "cursor_companion_bind_task",
                "cursor_companion_snap",
                "cursor_companion_capture_region",
                "cursor_companion_watch_clicks",
                "profile_records_list",
                "code_read_text_file",
            ] {
                assert!(!allows(label, command), "{label}: {command}");
            }
        }
        for label in [
            "misty-cursor-controls",
            "misty-cursor-",
            "misty-cursor-spoof",
            "browser-a",
        ] {
            assert!(!allows(label, "cursor_companion_snapshot"));
        }
    }

    #[test]
    fn vault_commands_are_main_workspace_only() {
        for command in [
            "extensions_prepare",
            "extensions_action",
            "extensions_reconcile",
            "profile_records_list",
            "profile_records_write",
            "browser_recovery_open",
            "browser_recovery_read",
            "browser_recovery_write",
            "browser_recovery_forget",
            "model_keys_saved",
            "model_keys_save",
            "model_keys_remove",
            "model_keys_add",
            "model_keys_models",
            "model_keys_openrouter_sign_in",
            "model_keys_chatgpt_status",
            "model_keys_chatgpt_sign_in",
            "model_keys_chatgpt_sign_out",
        ] {
            assert!(allows("window-1", command));
            for label in [
                "browser-a",
                "misty-agent-01951d32-40ac-7000-8000-000000000001",
                "misty-main",
                "space-personal",
                "window-1-spoof",
                "incognito-1",
            ] {
                assert!(!allows(label, command));
            }
        }
    }

    /// Filling a sign-in is the app's choice, made in its own menu. A website view can't ask.
    #[test]
    fn only_app_windows_fill_a_sign_in_into_a_page() {
        assert!(allows("window-1", "browser_page_password_fill"));
        assert!(allows("incognito-1", "browser_page_password_fill"));
        for label in ["misty-browser-a", "render-control", "misty-cursor-1"] {
            assert!(!allows(label, "browser_page_password_fill"), "{label}");
        }
    }

    /// Plugin permissions come from capabilities. A capability scoped by window
    /// would also cover website views attached to that window, and one with
    /// remote URLs would grant commands to websites; neither may exist.
    #[test]
    fn capabilities_never_reach_website_views() {
        let capabilities = [
            include_str!("../../capabilities/default.json"),
            include_str!("../../capabilities/cursor-companion.json"),
        ];
        let website_labels = [
            "misty-browser-a",
            "misty-browser-storage-1",
            "misty-browser-capture-1",
            "render-control",
        ];
        for raw in capabilities {
            let capability: serde_json::Value = serde_json::from_str(raw).unwrap();
            let name = capability["identifier"].as_str().unwrap();
            assert!(
                capability.get("remote").is_none(),
                "{name} grants remote URLs"
            );
            assert!(
                capability.get("windows").is_none(),
                "{name} is scoped by window"
            );
            for pattern in capability["webviews"].as_array().unwrap() {
                let pattern = pattern.as_str().unwrap();
                for label in website_labels {
                    let matches = match pattern.strip_suffix('*') {
                        Some(prefix) => label.starts_with(prefix),
                        None => label == pattern,
                    };
                    assert!(!matches, "{name}: {pattern} covers {label}");
                }
            }
        }
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_ne!(
            config["app"]["withGlobalTauri"],
            serde_json::Value::Bool(true)
        );
    }

    #[test]
    fn content_views_cannot_inherit_host_commands() {
        for label in ["browser-a", "unknown", "misty-main", "space-spoof"] {
            for command in [
                "profile_create",
                "profile_delete",
                "code_read_text_file",
                "terminal_create",
                "save_authenticated_user",
                "auth_session_restore",
                "auth_session_capture",
                "auth_session_forget",
                "auth_http_start",
                "auth_http_read",
                "auth_http_cancel",
            ] {
                assert!(!allows(label, command), "{label}: {command}");
            }
        }
        assert!(!allows(
            "misty-agent-01951d32-40ac-7000-8000-000000000001",
            "app_snapshot"
        ));
    }
}
