//! Application commands have no implicit permission to run in content views.
//! Plugin commands are separately checked by Tauri's per-WebView capabilities.
pub fn allows(label: &str, command: &str) -> bool {
    match label {
        "main" | "misty-bot-pet" => true,
        _ if label.starts_with("misty-agent-") && uuid::Uuid::parse_str(&label[12..]).is_ok() => true,
        _ => label.starts_with("misty-mini-app-") && command == "mini_app_rpc",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_views_cannot_inherit_host_commands() {
        for label in ["misty-mini-app-a", "browser-a", "unknown", "main-spoof"] {
            for command in [
                "ensure_local_access_token",
                "code_read_text_file",
                "terminal_create",
                "mini_app_open",
                "mini_app_reply",
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
        assert!(allows("main", "mini_app_open"));
        assert!(allows("misty-bot-pet", "app_snapshot"));
        assert!(allows("misty-mini-app-a", "mini_app_rpc"));
        assert!(!allows("browser-a", "mini_app_rpc"));
    }
}
