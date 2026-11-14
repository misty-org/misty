//! Hermes Agent (Nous Research) over the Agent Client Protocol: `hermes acp`, on the same ACP
//! driver as Grok, Kimi and Gemini CLI (`grok_acp.rs`). Each permission ask comes back through
//! `session/request_permission` and Misty's gate answers it. Hermes has no sandbox that keeps its
//! writes in the folder, so it offers no Bypass (`docs/plans/anyone-can-use-ai.md`). It is Misty's
//! own adapter; desktop-cc-gui has none. Over ACP Hermes is its gateway's client
//! (`acp_adapter/gateway_server.py`): modes, models and forks all go through the gateway.

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

    /// Hermes's ACP session modes (`acp_adapter/modes.py`): `default`, which asks before each
    /// edit, and `accept_edits`, which allows edits inside the folder and the temp dir without
    /// asking and still asks for sensitive paths and dangerous commands. Its `dont_ask` isn't
    /// offered: it allows edits anywhere, and Hermes has no sandbox that keeps it inside its
    /// folder. Hermes has no plan mode of its own (its `/plan` command writes a plan file).
    fn modes(&self) -> &'static [super::modes::EngineMode] {
        use super::modes::{mode, ModeKind::*};
        const MODES: &[super::modes::EngineMode] = &[
            mode("default", "Default", Asks, "manual"),
            mode("accept_edits", "Accept edits", Edits, "auto"),
        ];
        MODES
    }
}

/// Puts the session in the run's mode with ACP's `session/set_mode`, on every turn: a loaded
/// session keeps the mode it last ran in, and a new one starts in `default`.
pub(super) async fn set_mode(
    acp: &mut super::qoder_session::AcpProcess,
    session_id: &str,
    permission: Option<&str>,
    killed: &std::sync::atomic::AtomicBool,
) -> Result<(), String> {
    let mode = match HermesEngine.resolve_permission(permission) {
        "auto" => "accept_edits",
        _ => "default",
    };
    acp.routed(
        "session/set_mode",
        serde_json::json!({ "sessionId": session_id, "modeId": mode }),
        std::time::Duration::from_secs(30),
        killed,
        None,
        &mut |_| None,
    )
    .await
    .map(|_| ())
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

    /// Hermes 0.23.1's `session/new` modes and its edit-approval option.
    #[test]
    fn modes_match_the_installed_handshake() {
        let session = serde_json::json!({"modes": {"currentModeId": "default", "availableModes": [
            {"id": "default", "name": "Default", "description": "Ask before edits."},
            {"id": "accept_edits", "name": "Accept Edits",
             "description": "Auto-allow workspace and temp-dir edits; still asks for sensitive paths."},
            {"id": "dont_ask", "name": "Don't Ask",
             "description": "Auto-allow file edits for this session except sensitive paths."}]}});
        let listed: Vec<String> = super::super::models::acp_modes(&session)
            .into_iter()
            .map(|mode| mode.id)
            .collect();
        assert_eq!(listed, ["default", "accept_edits", "dont_ask"]);
        let adapter: Vec<&str> = HermesEngine.modes().iter().map(|mode| mode.id).collect();
        assert_eq!(adapter, ["default", "accept_edits"]);
        assert!(adapter
            .iter()
            .all(|id| listed.iter().any(|listed| listed == id)));
    }

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
