//! The Codex app-server run's sandbox: every mode that changes files works in `workspace-write`,
//! Bypass included, never `danger-full-access` (`docs/plans/anyone-can-use-ai.md`).
//!
//! On Windows this holds too, so Codex keeps Bypass there (checked against openai/codex
//! `codex-rs` at 16280e19):
//! - with Codex's Windows sandbox set up, every command runs under its restricted token, and a
//!   failed sandboxed spawn is an error, never an unsandboxed retry;
//! - without it, `effective_sandbox_mode` (`config/src/config_toml.rs`) turns the
//!   `workspace-write` this run asks for into `read-only`, and with approvals off every command
//!   the person's own exec rules don't allow is forbidden (`exec_policy.rs`) and every patch is
//!   rejected (`safety.rs`): the run does nothing rather than run unrestricted.

use serde_json::{json, Value};

use super::codex_read_only;
use super::SendRequest;

/// Sandbox mode for the run's permission. Every mode that changes files works in
/// `workspace-write`, Bypass included: it stops for nothing (`approval_for`), but
/// stays inside the run's folder and its extra folders (`writable_roots`). Never
/// `danger-full-access`.
pub(super) fn sandbox_for(permission: Option<&str>) -> &'static str {
    match permission {
        Some(codex_read_only::PERMISSION | crate::engines::codex::READ_ONLY) => "read-only",
        _ => "workspace-write",
    }
}

/// The config override that makes the run's extra folders writable beside its
/// working folder, or None when it has none (the person's own config stands).
pub(super) fn writable_roots(req: &SendRequest) -> Option<Value> {
    if sandbox_for(req.permission.as_deref()) != "workspace-write" {
        return None;
    }
    let workspace = req.workspace.to_string_lossy();
    let mut roots: Vec<&str> = Vec::new();
    for dir in &req.additional_dirs {
        let dir = dir.trim();
        if !dir.is_empty() && dir != workspace && !roots.contains(&dir) {
            roots.push(dir);
        }
    }
    (!roots.is_empty()).then(|| json!({ "sandbox_workspace_write.writable_roots": roots }))
}

#[cfg(test)]
mod tests {
    use super::super::approval_for;
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn sandbox_for_keeps_every_mode_inside_the_folder() {
        // Bypass stops for nothing but stays in the folder: never full access.
        assert_eq!(sandbox_for(Some("bypass")), "workspace-write");
        assert_eq!(approval_for(Some("bypass")), "never");
        // Ask works in the folder and stops for approval (`approval_for`).
        assert_eq!(sandbox_for(Some("manual")), "workspace-write");
        assert_eq!(approval_for(Some("manual")), "untrusted");
        assert_eq!(approval_for(Some("auto")), "never");
        assert_eq!(sandbox_for(Some("auto")), "workspace-write");
        // Anything the exec path's fallback would land on resolves to the same
        // default here.
        assert_eq!(sandbox_for(Some("plan")), "workspace-write");
        assert_eq!(sandbox_for(None), "workspace-write");
        assert_eq!(sandbox_for(Some(codex_read_only::PERMISSION)), "read-only");
    }

    #[test]
    fn writable_roots_add_the_runs_extra_folders_once() {
        let mut req = SendRequest {
            session_id: None,
            workspace: PathBuf::from("/work/space"),
            prompt: "hi".into(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: Vec::new(),
            model: None,
            effort: None,
            service_tier: None,
            permission: Some("bypass".into()),
            additional_dirs: Vec::new(),
            provider_id: None,
            mcp_servers: None,
            allowed_tools: None,
        };
        // No extra folders: the person's own config stands.
        assert_eq!(writable_roots(&req), None);
        req.additional_dirs = vec![
            "/data/shared".into(),
            " ".into(),
            "/work/space".into(),
            "/data/shared".into(),
            "/data/other".into(),
        ];
        let expected = json!({
            "sandbox_workspace_write.writable_roots": ["/data/shared", "/data/other"]
        });
        for permission in ["bypass", "auto", "manual"] {
            req.permission = Some(permission.into());
            assert_eq!(writable_roots(&req), Some(expected.clone()), "{permission}");
        }
        // A read-only run gets no writable folder at all.
        req.permission = Some(codex_read_only::PERMISSION.into());
        assert_eq!(writable_roots(&req), None);
    }
}
