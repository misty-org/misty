use serde_json::Value;

use super::SendRequest;

pub(super) fn extra_dirs(req: &SendRequest) -> Vec<String> {
    let workspace = req.workspace.to_string_lossy();
    let mut seen = std::collections::HashSet::new();
    req.additional_dirs
        .iter()
        .map(|dir| dir.trim())
        .filter(|dir| !dir.is_empty() && *dir != workspace && seen.insert(dir.to_string()))
        .map(str::to_string)
        .collect()
}

pub(super) fn folder_sandbox_runs() -> bool {
    if cfg!(target_os = "macos") {
        return true;
    }
    if !cfg!(target_os = "linux") {
        return false;
    }
    static FOUND: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FOUND.get_or_init(|| which::which("bwrap").is_ok() && which::which("socat").is_ok())
}

pub(super) fn folder_sandbox_settings(extra_dirs: &[String]) -> Value {
    serde_json::json!({
        "sandbox": {
            "enabled": true,
            "failIfUnavailable": true,
            "allowUnsandboxedCommands": false,
            "autoAllowBashIfSandboxed": true,
            "filesystem": { "allowWrite": extra_dirs },
        },
        "permissions": { "blockWritesOutsideWorkingDirectories": true },
    })
}
