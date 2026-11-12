//! Gemini CLI and Qwen Code over the Agent Client Protocol, on the same ACP driver desktop-cc-gui
//! uses for Grok and Kimi (`grok_acp.rs`). Neither engine is in desktop-cc-gui; they are Misty's.
//! Each permission ask comes back through `session/request_permission` and Misty's gate answers
//! it; only Bypass starts the CLI with `--yolo`.

use super::{command_for_binary, BuiltCommand, Engine, EngineEvent, SendRequest, Transport};

/// Gemini CLI, or Qwen Code (a fork of it with the same flags).
pub struct GeminiEngine {
    id: &'static str,
}

pub fn gemini() -> GeminiEngine {
    GeminiEngine { id: "gemini" }
}

pub fn qwen() -> GeminiEngine {
    GeminiEngine { id: "qwen" }
}

impl Engine for GeminiEngine {
    fn id(&self) -> &'static str {
        self.id
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    /// The ACP driver spawns the CLI on this computer; a WSL folder has no path to it.
    fn transport_for(&self, _wsl: bool) -> Transport {
        Transport::Own
    }

    fn host_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("--experimental-acp");
        if let Some(model) = req
            .model
            .as_deref()
            .filter(|model| !model.trim().is_empty())
        {
            cmd.arg("--model");
            cmd.arg(model);
        }
        if self.resolve_permission(req.permission.as_deref()) == "bypass" {
            cmd.arg("--yolo");
        }
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: None,
            // The gate's answers and question replies are written to this pipe for the turn.
            keep_stdin_open: true,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        })
    }

    fn build_command(&self, _req: &SendRequest, _bin: &str) -> Result<BuiltCommand, String> {
        Err(format!(
            "{} runs only over the Agent Client Protocol.",
            super::engine_name(self.id)
        ))
    }

    /// ACP sessions report through the driver, never through stdout lines.
    fn parse_line(&self, _line: &str, _out: &mut Vec<EngineEvent>) {}

    fn supports_images(&self) -> bool {
        true
    }

    fn supports_mcp(&self) -> bool {
        true
    }

    /// Plan runs the CLI's default mode with every change refused by the gate.
    fn supported_permissions(&self) -> &'static [&'static str] {
        &["auto", "manual", "plan", "bypass"]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(engine: &GeminiEngine, permission: &str) -> Vec<String> {
        let req = SendRequest {
            session_id: None,
            workspace: std::env::temp_dir(),
            prompt: "hi".into(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: Vec::new(),
            model: Some("gemini-2.5-pro".into()),
            effort: None,
            service_tier: None,
            permission: Some(permission.into()),
            additional_dirs: Vec::new(),
            provider_id: None,
            mcp_servers: None,
            allowed_tools: None,
        };
        let built = engine.host_command(&req, "gemini").unwrap();
        built
            .command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn only_bypass_skips_the_asks() {
        for engine in [gemini(), qwen()] {
            assert!(argv(&engine, "bypass").contains(&"--yolo".to_string()));
            for mode in ["auto", "manual", "plan"] {
                let args = argv(&engine, mode);
                assert!(!args.contains(&"--yolo".to_string()), "{mode}: {args:?}");
                assert!(args.contains(&"--experimental-acp".to_string()));
            }
        }
    }
}
