//! Hermes Agent (Nous Research) over the Agent Client Protocol: `hermes acp`, on the same ACP
//! driver as Grok, Kimi and Gemini CLI (`grok_acp.rs`). Each permission ask comes back through
//! `session/request_permission` and Misty's gate answers it. Hermes has no sandbox that keeps its
//! writes in the folder, so it offers no Bypass (`docs/plans/anyone-can-use-ai.md`). It is Misty's
//! own adapter; desktop-cc-gui has none.

use super::{command_for_binary, BuiltCommand, Engine, SendRequest};

pub struct HermesEngine;

impl Engine for HermesEngine {
    fn id(&self) -> &'static str {
        "hermes"
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    fn host_command(&self, _req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("acp");
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: None,
            // The gate's answers and question replies are written to this pipe for the turn.
            keep_stdin_open: true,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        })
    }

    fn supports_images(&self) -> bool {
        false
    }

    fn supports_mcp(&self) -> bool {
        true
    }

    /// Hermes's one mode: each ask comes back through ACP. Hermes has no plan mode of its own,
    /// and no sandbox that keeps it inside its folder.
    fn modes(&self) -> &'static [super::modes::EngineMode] {
        use super::modes::{mode, ModeKind::*};
        const MODES: &[super::modes::EngineMode] = &[mode("default", "Default", Asks, "manual")];
        MODES
    }
}

/// Picks the session's model, when one was chosen, with ACP's `session/set_model`.
pub(super) async fn set_model(
    acp: &mut super::qoder_session::AcpProcess,
    session_id: &str,
    model: &str,
    killed: &std::sync::atomic::AtomicBool,
) -> Result<(), String> {
    let model = model.trim();
    if model.is_empty() {
        return Ok(());
    }
    acp.routed(
        "session/set_model",
        serde_json::json!({ "sessionId": session_id, "modelId": model }),
        std::time::Duration::from_secs(30),
        killed,
        None,
        &mut |_| None,
    )
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_as_an_acp_server_without_bypass() {
        let req = SendRequest {
            session_id: None,
            workspace: std::env::temp_dir(),
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
        let built = HermesEngine.host_command(&req, "hermes").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args, ["acp"]);
        assert!(!HermesEngine.supported_permissions().contains(&"bypass"));
    }
}
