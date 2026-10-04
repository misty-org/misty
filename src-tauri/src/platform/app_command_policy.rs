//! Application commands have no implicit permission to run in content views.
//! Plugin commands are separately checked by Tauri's per-WebView capabilities.
pub fn allows(label: &str, command: &str) -> bool {
    if command.starts_with("agent_files_")
        || command.starts_with("extensions_")
        || command.starts_with("browser_sync_")
        || command.starts_with("browser_recovery_")
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
                "ensure_local_access_token",
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
                "misty-mini-app-a",
                "misty-agent-01951d32-40ac-7000-8000-000000000001",
                "main-spoof",
            ] {
                assert!(!allows(label, command));
            }
        }
    }

    #[test]
    fn content_views_cannot_inherit_host_commands() {
        for label in ["misty-mini-app-a", "browser-a", "unknown", "main-spoof"] {
            for command in [
                "ensure_local_access_token",
                "code_read_text_file",
                "terminal_create",
                "builtin_service_open",
                "mini_app_close",
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
        assert!(allows("main", "builtin_service_open"));
        assert!(!allows("misty-bot-pet", "app_snapshot"));
        assert!(!allows("misty-mini-app-a", "mini_app_rpc"));
        assert!(!allows("browser-a", "mini_app_rpc"));
    }
}
