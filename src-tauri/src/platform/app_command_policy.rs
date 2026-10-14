//! Application commands have no implicit permission to run in content views.
//! Plugin commands are separately checked by Tauri's per-WebView capabilities.
pub fn allows(label: &str, command: &str) -> bool {
    if command.starts_with("agent_files_")
        || command.starts_with("extensions_")
        || command.starts_with("browser_sync_")
        || command.starts_with("browser_recovery_")
        // Reads other browsers' profiles, sign-ins included.
        || command.starts_with("browser_import_")
    {
        return label == "main";
    }
    match label {
        "main" => true,
        _ if label
            .strip_prefix("misty-cursor-")
            .and_then(|id| id.parse::<u32>().ok())
            .is_some() =>
        {
            command == "cursor_companion_snapshot"
        }
        _ if label.starts_with("misty-agent-") && uuid::Uuid::parse_str(&label[12..]).is_ok() => {
            true
        }
        // A detached tab's window: its bar can dock it, bring the tab back or stop.
        _ if label
            .strip_prefix("misty-dock-")
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok()) =>
        {
            command == "agent_dock_host_action"
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
                "browser_sync_state",
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
    fn dock_hosts_can_only_press_their_own_bar() {
        let host = "misty-dock-01951d32-40ac-7000-8000-000000000001";
        assert!(allows(host, "agent_dock_host_action"));
        for command in [
            "agent_tab_detach",
            "agent_dock_status",
            "browser_webview_create",
        ] {
            assert!(!allows(host, command), "{command}");
        }
        assert!(!allows("misty-dock-spoof", "agent_dock_host_action"));
    }

    #[test]
    fn vault_commands_are_main_workspace_only() {
        for command in [
            "agent_files_choose",
            "agent_files_prepare",
            "agent_files_apply",
            "agent_files_undo",
            "agent_files_revoke",
            "extensions_prepare",
            "extensions_action",
            "extensions_reconcile",
            "browser_sync_availability",
            "browser_sync_restore_credentials",
            "browser_sync_capture_credentials",
            "browser_sync_generate_secret",
            "browser_sync_setup",
            "browser_sync_connect",
            "browser_sync_state",
            "browser_sync_account_feed",
            "browser_sync_edit",
            "browser_sync_activate",
            "browser_sync_claim",
            "browser_sync_flush",
            "browser_sync_lock",
            "browser_sync_forget_key",
            "browser_recovery_open",
            "browser_recovery_read",
            "browser_recovery_write",
            "browser_recovery_forget",
        ] {
            assert!(allows("main", command));
            for label in [
                "browser-a",
                "misty-agent-01951d32-40ac-7000-8000-000000000001",
                "main-spoof",
            ] {
                assert!(!allows(label, command));
            }
        }
    }

    /// Plugin permissions come from capabilities. A capability scoped by window
    /// would also cover website views attached to that window, and one with
    /// remote URLs would grant commands to websites; neither may exist.
    #[test]
    fn capabilities_never_reach_website_views() {
        let capabilities = [
            include_str!("../../capabilities/default.json"),
            include_str!("../../capabilities/bot.json"),
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
        for label in ["browser-a", "unknown", "main-spoof"] {
            for command in [
                "code_read_text_file",
                "terminal_create",
                "save_authenticated_user",
                "auth_cookie_restore",
                "auth_cookie_capture",
                "auth_cookie_forget",
                "auth_http_start",
                "auth_http_read",
                "auth_http_cancel",
            ] {
                assert!(!allows(label, command), "{label}: {command}");
            }
        }
        assert!(!allows("misty-bot-pet", "app_snapshot"));
    }
}
