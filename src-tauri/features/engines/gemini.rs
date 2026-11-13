//! Gemini CLI and Qwen Code over the Agent Client Protocol, on the same ACP driver desktop-cc-gui
//! uses for Grok and Kimi (`grok_acp.rs`). Neither engine is in desktop-cc-gui; they are Misty's.
//! Each permission ask comes back through `session/request_permission` and Misty's gate answers
//! it; only Bypass starts the CLI with `--yolo`, and only inside its own sandbox (`--sandbox` on
//! macOS's Seatbelt), which keeps every write in the folder. Elsewhere their sandbox needs Docker
//! or Podman, so they offer no Bypass there.

use super::{command_for_binary, BuiltCommand, Engine, SendRequest};

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

/// Gemini CLI's approval modes (`--approval-mode default | auto_edit | plan`, and `--yolo`),
/// in its Shift+Tab order with YOLO last.
const GEMINI_MODES: &[super::modes::EngineMode] = {
    use super::modes::{mode, ModeKind::*};
    &[
        mode("default", "Default", Asks, "manual"),
        mode("auto_edit", "Auto-edit", Edits, "auto"),
        mode("plan", "Plan", Plans, "plan"),
        mode("yolo", "YOLO", NoAsking, "bypass"),
    ]
};

/// Qwen Code's approval modes, as its `/approval-mode` names them (`plan`, `default` "Ask
/// permissions", `auto-edit`, `yolo`). Its `auto` (a classifier) isn't offered.
const QWEN_MODES: &[super::modes::EngineMode] = {
    use super::modes::{mode, ModeKind::*};
    &[
        mode("plan", "Plan", Plans, "plan"),
        mode("default", "Ask permissions", Asks, "manual"),
        mode("auto-edit", "Auto-edit", Edits, "auto"),
        mode("yolo", "YOLO", NoAsking, "bypass"),
    ]
};

impl Engine for GeminiEngine {
    fn id(&self) -> &'static str {
        self.id
    }

    fn drives_own_transport(&self) -> bool {
        true
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
        let level = self.resolve_permission(req.permission.as_deref());
        // The engine's own approval mode for Auto-edit and Plan; Default needs no flag.
        if let Some(id) = self
            .modes()
            .iter()
            .find(|mode| mode.launch == level && matches!(level, "auto" | "plan"))
            .map(|mode| mode.id)
        {
            cmd.arg("--approval-mode");
            cmd.arg(id);
        }
        if level == "bypass" {
            cmd.arg("--yolo");
            cmd.arg("--sandbox");
            // The CLI reads the sandbox's kind from its env var before the flag, and skips the
            // sandbox when `SANDBOX` says it's already inside one: both are pinned here, to
            // Seatbelt and its default profile, which writes only to the project folder.
            cmd.env(self.sandbox_env(), "sandbox-exec");
            cmd.env("SEATBELT_PROFILE", "permissive-open");
            cmd.env_remove("SANDBOX");
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

    fn supports_images(&self) -> bool {
        true
    }

    fn supports_mcp(&self) -> bool {
        true
    }

    /// The CLI's approval modes (`--approval-mode`). YOLO only where the CLI's own Seatbelt
    /// sandbox runs.
    fn modes(&self) -> &'static [super::modes::EngineMode] {
        if self.id == "qwen" {
            QWEN_MODES
        } else {
            GEMINI_MODES
        }
    }
    fn folder_sandbox(&self) -> bool {
        seatbelt_runs()
    }
}

impl GeminiEngine {
    /// The env var each CLI reads its sandbox's kind from.
    fn sandbox_env(&self) -> &'static str {
        if self.id == "qwen" {
            "QWEN_SANDBOX"
        } else {
            "GEMINI_SANDBOX"
        }
    }
}

/// Whether macOS's built-in sandbox is here: the only one these CLIs run without Docker or Podman.
fn seatbelt_runs() -> bool {
    static FOUND: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    cfg!(target_os = "macos") && *FOUND.get_or_init(|| which::which("sandbox-exec").is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(engine: &GeminiEngine, permission: &str) -> std::process::Command {
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
        let mut command = std::process::Command::new("gemini");
        command.args(built.command.as_std().get_args());
        for (key, value) in built.command.as_std().get_envs() {
            match value {
                Some(value) => command.env(key, value),
                None => command.env_remove(key),
            };
        }
        command
    }

    fn argv(engine: &GeminiEngine, permission: &str) -> Vec<String> {
        command(engine, permission)
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    fn env(command: &std::process::Command, key: &str) -> Option<Option<String>> {
        command
            .get_envs()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| value.map(|value| value.to_string_lossy().into_owned()))
    }

    #[test]
    fn bypass_is_offered_only_where_seatbelt_runs() {
        for engine in [gemini(), qwen()] {
            assert_eq!(
                engine.supported_permissions().contains(&"bypass"),
                cfg!(target_os = "macos"),
                "{}",
                engine.id
            );
        }
    }

    #[test]
    fn bypass_runs_yolo_inside_seatbelt() {
        for (engine, var) in [(gemini(), "GEMINI_SANDBOX"), (qwen(), "QWEN_SANDBOX")] {
            let bypass = command(&engine, "bypass");
            let args: Vec<String> = bypass
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            if !engine.supported_permissions().contains(&"bypass") {
                // No sandbox here, so a stray Bypass runs as Auto: no --yolo.
                assert!(!args.contains(&"--yolo".to_string()), "{args:?}");
                continue;
            }
            assert!(args.contains(&"--yolo".to_string()), "{args:?}");
            assert!(args.contains(&"--sandbox".to_string()), "{args:?}");
            assert_eq!(env(&bypass, var), Some(Some("sandbox-exec".into())));
            assert_eq!(
                env(&bypass, "SEATBELT_PROFILE"),
                Some(Some("permissive-open".into()))
            );
            assert_eq!(env(&bypass, "SANDBOX"), Some(None));
        }
    }

    #[test]
    fn only_bypass_skips_the_asks() {
        for engine in [gemini(), qwen()] {
            for mode in ["auto", "manual", "plan"] {
                let args = argv(&engine, mode);
                assert!(!args.contains(&"--yolo".to_string()), "{mode}: {args:?}");
                assert!(!args.contains(&"--sandbox".to_string()), "{mode}: {args:?}");
                assert!(args.contains(&"--experimental-acp".to_string()));
            }
        }
    }
}
