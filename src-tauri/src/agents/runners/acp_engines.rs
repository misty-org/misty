//! The ACP tools: MiniMax Code, Kimi Code, Oh My Pi, Qoder and Grok. Each is
//! the shared ACP protocol plus how to start the tool and which mode to set.
//! None is ever started in a bypass or always-approve mode.
use std::path::PathBuf;

use serde_json::{json, Value};

use super::{
    acp::{AcpProtocol, Setup},
    Capabilities, CommandSpec, EngineId, Launch, LaunchMode, Protocol, Runner, RunnerError,
    Transport,
};

pub struct AcpRunner {
    pub engine: EngineId,
}

impl AcpRunner {
    fn program(&self) -> (&'static str, Vec<&'static str>) {
        match self.engine {
            EngineId::Minimax => ("mcode", vec!["acp"]),
            EngineId::Kimi => ("kimi", vec!["acp"]),
            EngineId::Omp => ("omp", vec!["--mode", "acp"]),
            EngineId::Qoder => ("qodercli", vec!["--acp"]),
            EngineId::QoderCn => ("qoderclicn", vec!["--acp"]),
            _ => ("grok", vec!["agent", "stdio"]),
        }
    }

    /// The tool's plan mode, when it has one.
    fn plan_mode(&self) -> Option<Setup> {
        match self.engine {
            EngineId::Minimax | EngineId::Kimi | EngineId::Omp => {
                Some(("session/set_mode", json!({"modeId": "plan"})))
            }
            _ => None,
        }
    }

    /// The mode that makes the tool ask before acting, when it needs setting.
    fn ask_mode(&self) -> Vec<Setup> {
        match self.engine {
            EngineId::Minimax => vec![(
                "session/set_config_option",
                json!({"configId": "permissionMode", "value": "default"}),
            )],
            _ => Vec::new(),
        }
    }
}

/// A hooks folder whose pre-push hook refuses, for tools that can't ask: their
/// pushes fail unless the person remembered pushing for this project.
fn refusing_hooks() -> Option<PathBuf> {
    let dir = std::env::temp_dir().join("misty-refuse-push-hooks");
    let hook = dir.join("pre-push");
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::write(&hook, "#!/bin/sh\necho 'Misty: pushing needs your approval. Remember pushing for this project in Misty first.' >&2\nexit 1\n").ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).ok()?;
    }
    Some(dir)
}

impl Runner for AcpRunner {
    fn engine(&self) -> EngineId {
        self.engine
    }

    fn transport(&self) -> Transport {
        Transport::Acp
    }

    fn capabilities(&self) -> Capabilities {
        let interactive = matches!(
            self.engine,
            EngineId::Minimax | EngineId::Kimi | EngineId::Omp
        );
        Capabilities {
            interactive_asks: interactive,
            plan_mode: self.plan_mode().is_some(),
            todos: interactive,
            rate_limits: false,
            full_access_only: self.engine == EngineId::Grok,
        }
    }

    fn build_command(&self, launch: &Launch) -> Result<CommandSpec, RunnerError> {
        if launch.task.trim().is_empty() {
            return Err(RunnerError::Invalid("the task is empty"));
        }
        if launch.mode == LaunchMode::Plan && self.plan_mode().is_none() {
            return Err(RunnerError::Unsupported("this tool has no read-only mode"));
        }
        if self.engine == EngineId::Grok && launch.mode != LaunchMode::AutoEdit {
            return Err(RunnerError::Unsupported("Grok runs only in Auto"));
        }
        let (program, args) = self.program();
        let mut env = Vec::new();
        if self.engine == EngineId::Grok {
            env.push(("GROK_DISABLE_AUTOUPDATER".to_owned(), "1".to_owned()));
            if !launch.grants.iter().any(|grant| grant == "git.push") {
                let hooks = refusing_hooks()
                    .ok_or(RunnerError::Invalid("couldn't prepare the push guard"))?;
                env.extend([
                    ("GIT_CONFIG_COUNT".to_owned(), "1".to_owned()),
                    ("GIT_CONFIG_KEY_0".to_owned(), "core.hooksPath".to_owned()),
                    (
                        "GIT_CONFIG_VALUE_0".to_owned(),
                        hooks.to_string_lossy().into_owned(),
                    ),
                ]);
            }
        }
        Ok(CommandSpec {
            program: program.into(),
            args: args.into_iter().map(String::from).collect(),
            env,
            cwd: launch.project_root.clone(),
        })
    }

    fn protocol(&self, launch: &Launch) -> Box<dyn Protocol> {
        let setup: Vec<(&'static str, Value)> = match launch.mode {
            LaunchMode::Plan => self.plan_mode().into_iter().collect(),
            _ => self.ask_mode(),
        };
        Box::new(AcpProtocol::new(launch, setup))
    }
}
