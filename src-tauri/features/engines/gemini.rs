//! Gemini CLI and Qwen Code over the Agent Client Protocol, on the same ACP driver desktop-cc-gui
//! uses for Grok and Kimi (`grok_acp.rs`). Neither engine is in desktop-cc-gui; they are Misty's.
//! Each permission ask comes back through `session/request_permission` and Misty's gate answers
//! it; only Bypass starts the CLI with `--yolo`, and only inside its own sandbox (`--sandbox` on
//! macOS's Seatbelt), which keeps every write in the folder. Elsewhere their sandbox needs Docker
//! or Podman, so they offer no Bypass there.

use std::path::{Path, PathBuf};

use super::{command_for_binary, BuiltCommand, Engine, SendRequest};

#[path = "gemini_commands.rs"]
mod gemini_commands;
pub(crate) use gemini_commands::{custom_commands, custom_commands_from, expand_custom_command};

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
        // Gemini CLI 0.68 marks `--experimental-acp` deprecated in favour of `--acp`, and Qwen
        // Code takes `--acp` too. Misty doesn't tell CLI versions apart, so there is no fallback
        // for a Gemini CLI old enough to know only the experimental flag.
        cmd.arg("--acp");
        // The folders the person added (`/add-dir`): both CLIs read `--include-directories`
        // (repeatable) into the session's workspace.
        for dir in include_directories(&req.additional_dirs) {
            cmd.arg("--include-directories");
            cmd.arg(dir);
        }
        if let Some(model) = req
            .model
            .as_deref()
            .filter(|model| !model.trim().is_empty())
        {
            cmd.arg("--model");
            cmd.arg(model);
        }
        let level = self.resolve_permission(req.permission.as_deref());
        // The engine's own approval mode for every level but Bypass, Default included: with no
        // flag the CLI takes `tools.approvalMode` (`general.defaultApprovalMode` in Gemini) from
        // its settings, and Qwen Code 0.27 falls back to `auto`, its classifier that approves
        // on its own, rather than asking.
        if let Some(id) = self
            .modes()
            .iter()
            .find(|mode| mode.launch == level && level != "bypass")
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

/// The added folders that can go on the command line: ones that still exist, and none with a
/// comma, since both CLIs split each `--include-directories` value on commas.
fn include_directories(dirs: &[String]) -> Vec<&str> {
    dirs.iter()
        .map(String::as_str)
        .filter(|dir| {
            if dir.contains(',') {
                eprintln!("[gemini] skipping an added folder whose path has a comma");
                return false;
            }
            Path::new(dir).is_dir()
        })
        .collect()
}

/// Where Gemini CLI keeps its user files: `GEMINI_CLI_HOME`, else the home folder.
pub(crate) fn gemini_home() -> Option<PathBuf> {
    std::env::var_os("GEMINI_CLI_HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
}

/// `~/.gemini`.
pub(crate) fn gemini_dir() -> Option<PathBuf> {
    gemini_home().map(|home| home.join(".gemini"))
}

fn is_home(dir: &Path) -> bool {
    let Some(home) = gemini_home() else {
        return false;
    };
    let real = |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    same_path(&real(dir), &real(&home))
}

/// Paths compared the way Gemini CLI does: without case on macOS and Windows.
fn same_path(a: &Path, b: &Path) -> bool {
    normalized(a) == normalized(b)
}

fn normalized(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    if cfg!(any(target_os = "macos", windows)) {
        text.to_lowercase()
    } else {
        text
    }
}

/// Gemini CLI's `trustedFolders.json`: `GEMINI_CLI_TRUSTED_FOLDERS_PATH`, else in `~/.gemini`.
pub(crate) fn trusted_folders_path() -> Option<PathBuf> {
    std::env::var_os("GEMINI_CLI_TRUSTED_FOLDERS_PATH")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| gemini_dir().map(|dir| dir.join("trustedFolders.json")))
}

/// The trust rules in `trustedFolders.json`: folder → `TRUST_FOLDER`, `TRUST_PARENT` or
/// `DO_NOT_TRUST`.
pub(crate) fn trust_rules() -> Vec<(String, String)> {
    let Some(rules) = trusted_folders_path()
        .and_then(|path| super::slash::files::read_json(&path))
        .and_then(|value| value.as_object().cloned())
    else {
        return Vec::new();
    };
    rules
        .into_iter()
        .filter_map(|(path, level)| level.as_str().map(|level| (path, level.to_string())))
        .collect()
}

/// What `trustedFolders.json` says about `dir`: the longest rule that covers it (a
/// `TRUST_PARENT` rule covers its folder's parent) decides. None when no rule covers it.
pub(crate) fn trust_of(dir: &Path) -> Option<bool> {
    let real = |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let location = normalized(&real(dir));
    let mut best: Option<(usize, String)> = None;
    for (rule, level) in trust_rules() {
        let effective = if level == "TRUST_PARENT" {
            Path::new(&rule)
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from(&rule))
        } else {
            PathBuf::from(&rule)
        };
        let effective = normalized(&real(&effective));
        let covers = location == effective
            || location.starts_with(&format!(
                "{}{}",
                effective.trim_end_matches(std::path::MAIN_SEPARATOR),
                std::path::MAIN_SEPARATOR
            ));
        if covers && best.as_ref().is_none_or(|(len, _)| rule.len() > *len) {
            best = Some((rule.len(), level));
        }
    }
    match best?.1.as_str() {
        "DO_NOT_TRUST" => Some(false),
        "TRUST_FOLDER" | "TRUST_PARENT" => Some(true),
        _ => None,
    }
}

/// Whether Gemini CLI trusts `dir`, and so loads its project settings and commands: the
/// `GEMINI_CLI_TRUST_WORKSPACE` / `GEMINI_RESTRICTED_MODE` variables first, then every folder
/// when folder trust is off (`security.folderTrust.enabled: false`), else its trust rules, where
/// a folder no rule covers isn't trusted.
pub(crate) fn workspace_trusted(dir: &Path) -> bool {
    let env = |name: &str| std::env::var(name).ok();
    if env("GEMINI_RESTRICTED_MODE").as_deref() == Some("true")
        || env("GEMINI_CLI_TRUST_WORKSPACE").as_deref() == Some("false")
    {
        return false;
    }
    if env("GEMINI_CLI_TRUST_WORKSPACE").as_deref() == Some("true") {
        return true;
    }
    if !folder_trust_enabled() {
        return true;
    }
    trust_of(dir).unwrap_or(false)
}

/// `security.folderTrust.enabled` from the system and user settings (system wins); on unless
/// one turns it off.
fn folder_trust_enabled() -> bool {
    let enabled = |path: PathBuf| {
        super::slash::files::read_json(&path)?
            .pointer("/security/folderTrust/enabled")?
            .as_bool()
    };
    if let Some(value) = system_settings_path().and_then(enabled) {
        return value;
    }
    gemini_dir()
        .map(|dir| dir.join("settings.json"))
        .and_then(enabled)
        .unwrap_or(true)
}

/// Gemini CLI's system settings: `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, else the platform's place.
pub(crate) fn system_settings_path() -> Option<PathBuf> {
    if let Some(path) =
        std::env::var_os("GEMINI_CLI_SYSTEM_SETTINGS_PATH").filter(|p| !p.is_empty())
    {
        return Some(PathBuf::from(path));
    }
    Some(system_config_dir().join("settings.json"))
}

/// The system config folder, where system settings and policies live.
pub(crate) fn system_config_dir() -> PathBuf {
    if cfg!(target_os = "macos") {
        PathBuf::from("/Library/Application Support/GeminiCli")
    } else if cfg!(windows) {
        PathBuf::from("C:\\ProgramData\\gemini-cli")
    } else {
        PathBuf::from("/etc/gemini-cli")
    }
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
                assert!(args.contains(&"--acp".to_string()));
            }
        }
    }

    #[test]
    fn every_asking_level_names_its_approval_mode() {
        for (engine, expected) in [
            (
                gemini(),
                [
                    ("manual", "default"),
                    ("auto", "auto_edit"),
                    ("plan", "plan"),
                ],
            ),
            (
                qwen(),
                [
                    ("manual", "default"),
                    ("auto", "auto-edit"),
                    ("plan", "plan"),
                ],
            ),
        ] {
            for (level, id) in expected {
                let args = argv(&engine, level);
                let at = args.iter().position(|arg| arg == "--approval-mode");
                assert_eq!(
                    at.and_then(|at| args.get(at + 1)).map(String::as_str),
                    Some(id),
                    "{} {level}: {args:?}",
                    engine.id
                );
            }
        }
    }
}
