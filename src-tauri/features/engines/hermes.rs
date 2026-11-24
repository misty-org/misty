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

    fn modes(&self) -> &'static [super::modes::EngineMode] {
        use super::modes::{mode, ModeKind::*};
        const MODES: &[super::modes::EngineMode] = &[
            mode("default", "Default", Asks, "manual"),
            mode("accept_edits", "Accept edits", Edits, "auto"),
        ];
        MODES
    }
}

pub(super) async fn set_mode(
    acp: &mut super::acp_session::AcpProcess,
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

pub(super) async fn set_model(
    acp: &mut super::acp_session::AcpProcess,
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
