use std::path::{Path, PathBuf};

use super::{command_for_binary, BuiltCommand, Engine, SendRequest};

#[path = "gemini_commands.rs"]
mod gemini_commands;
pub(crate) use gemini_commands::{custom_commands, custom_commands_from, expand_custom_command};

pub struct GeminiEngine {
    id: &'static str,
}

pub fn gemini() -> GeminiEngine {
    GeminiEngine { id: "gemini" }
}

pub fn qwen() -> GeminiEngine {
    GeminiEngine { id: "qwen" }
}

const GEMINI_MODES: &[super::modes::EngineMode] = {
    use super::modes::{mode, ModeKind::*};
    &[
        mode("default", "Default", Asks, "manual"),
        mode("auto_edit", "Auto-edit", Edits, "auto"),
        mode("plan", "Plan", Plans, "plan"),
        mode("yolo", "YOLO", NoAsking, "bypass"),
    ]
};

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
        cmd.arg("--acp");
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
            cmd.env(self.sandbox_env(), "sandbox-exec");
            cmd.env("SEATBELT_PROFILE", "permissive-open");
            cmd.env_remove("SANDBOX");
        }
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: None,
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

    fn supports_web_search(&self) -> bool {
        self.id == "gemini"
    }

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
    fn sandbox_env(&self) -> &'static str {
        if self.id == "qwen" {
            "QWEN_SANDBOX"
        } else {
            "GEMINI_SANDBOX"
        }
    }
}

fn seatbelt_runs() -> bool {
    static FOUND: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    cfg!(target_os = "macos") && *FOUND.get_or_init(|| which::which("sandbox-exec").is_ok())
}

#[allow(
    clippy::disallowed_methods,
    reason = "checks the folders the person added to a run, which need not be linked"
)]
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

pub(crate) fn gemini_home() -> Option<PathBuf> {
    std::env::var_os("GEMINI_CLI_HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
}

pub(crate) fn gemini_dir() -> Option<PathBuf> {
    gemini_home().map(|home| home.join(".gemini"))
}

fn is_home(dir: &Path) -> bool {
    let Some(home) = gemini_home() else {
        return false;
    };
    same_path(&real(dir), &real(&home))
}

#[allow(
    clippy::disallowed_methods,
    reason = "resolves the person's folders and the folders Gemini's trust rules name, which need not be linked"
)]
fn real(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

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

pub(crate) fn trusted_folders_path() -> Option<PathBuf> {
    std::env::var_os("GEMINI_CLI_TRUSTED_FOLDERS_PATH")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| gemini_dir().map(|dir| dir.join("trustedFolders.json")))
}

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

pub(crate) fn trust_of(dir: &Path) -> Option<bool> {
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

pub(crate) fn system_settings_path() -> Option<PathBuf> {
    if let Some(path) =
        std::env::var_os("GEMINI_CLI_SYSTEM_SETTINGS_PATH").filter(|p| !p.is_empty())
    {
        return Some(PathBuf::from(path));
    }
    Some(system_config_dir().join("settings.json"))
}

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
