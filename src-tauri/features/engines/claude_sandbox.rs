//! Claude Code's Bypass, held to the run's folder by its own sandbox
//! (`docs/plans/anyone-can-use-ai.md`).

use serde_json::Value;

use super::SendRequest;

/// The run's extra folders beside its working folder, once each: blanks, the working folder
/// itself and duplicates left out.
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

/// Whether Claude Code's sandbox can run here: Seatbelt is built into macOS; on Linux it needs
/// bubblewrap and socat; native Windows has none. Where it can't, Claude Code doesn't offer
/// Bypass.
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

/// The `--settings` a Bypass run starts with (checked against Claude Code 2.1.322 and
/// code.claude.com/docs/en/sandboxing):
/// - `sandbox.enabled`: every command runs in the sandbox, which writes only to the working
///   folder, the `--add-dir` folders (named again in `allowWrite`) and its own temp folder;
/// - `failIfUnavailable`: Claude Code exits instead of running commands unsandboxed;
/// - `allowUnsandboxedCommands: false`: a refused command is never retried outside it, and a
///   repository's own settings can't loosen it;
/// - `blockWritesOutsideWorkingDirectories`: its Edit and Write tools, which the sandbox doesn't
///   cover, refuse anything outside those folders, in Bypass too.
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
