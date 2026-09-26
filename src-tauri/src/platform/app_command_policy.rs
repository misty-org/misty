//! Application commands have no implicit permission to run in content views.
//! Plugin commands are separately checked by Tauri's per-WebView capabilities.
pub fn allows(label: &str, command: &str) -> bool {
    if command.starts_with("browser_sync_") || command.starts_with("browser_recovery_") {
        return label == "main";
    }
    match label {
        "main" => true,
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
    fn vault_commands_are_main_workspace_only() {
        for command in [
            "browser_sync_availability",
            "browser_sync_restore_credentials",
            "browser_sync_capture_credentials",
            "browser_sync_generate_secret",
            "browser_sync_setup",
            "browser_sync_connect",
            "browser_sync_state",
            "browser_sync_edit",
            "browser_sync_resume",
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
