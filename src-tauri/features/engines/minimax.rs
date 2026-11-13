// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/minimax.rs.
//! MiniMax Code CLI (`mcode`). Runs drive the `mcode acp` transport (`minimax_acp`); this
//! module holds the engine adapter.

use super::{command_for_binary, BuiltCommand, Engine, SendRequest};

pub struct MiniMaxEngine;

impl Engine for MiniMaxEngine {
    fn id(&self) -> &'static str {
        "minimax"
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    fn host_command(&self, _req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut command = command_for_binary(bin);
        command.arg("acp");
        Ok(BuiltCommand {
            command,
            stdin_payload: None,
            keep_stdin_open: true,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        })
    }

    fn supports_images(&self) -> bool {
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }
    fn supports_mcp(&self) -> bool {
        true
    }
    /// MiniMax Code's `permissionMode` option (`default` "Ask", `auto`) and its ACP plan mode.
    /// Its Full access (`bypassPermissions`) isn't offered: MiniMax has no sandbox that keeps it
    /// inside its folder.
    fn modes(&self) -> &'static [super::modes::EngineMode] {
        use super::modes::{mode, ModeKind::*};
        const MODES: &[super::modes::EngineMode] = &[
            mode("default", "Ask", Asks, "manual"),
            mode("auto", "Auto", Edits, "auto"),
            mode("plan", "Plan", Plans, "plan"),
        ];
        MODES
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> SendRequest {
        SendRequest {
            session_id: None,
            workspace: std::env::temp_dir(),
            prompt: "run the tests".into(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: vec![],
            model: Some("minimax/MiniMax-M2.7".into()),
            effort: Some("medium".into()),
            service_tier: None,
            permission: Some("auto".into()),
            additional_dirs: vec![],
            provider_id: None,
            mcp_servers: None,
            allowed_tools: None,
        }
    }

    fn argv(built: &BuiltCommand) -> Vec<String> {
        built
            .command
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn transport_is_acp() {
        assert!(MiniMaxEngine.drives_own_transport());
        let built = MiniMaxEngine.host_command(&request(), "mcode").unwrap();
        assert_eq!(argv(&built), ["acp"]);
        assert!(built.keep_stdin_open);
    }
}
