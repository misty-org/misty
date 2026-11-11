//! Outside agent engines (Claude Code, Codex, OpenCode) run as adapters: each is a program the
//! person installed, started in a folder, and its output is turned into the same run events
//! Misty's own agent produces, so one chat shows them all. Misty holds none of their keys; each
//! engine signs in and talks to its provider by itself.
//!
//! The adapters are ported from desktop-cc-gui (MIT). See NOTICE.

mod claude;
mod codex;
pub mod commands;
pub mod connections;
pub(crate) mod mcp;
mod opencode;
pub mod resolve;
pub mod runs;
pub mod store;
pub mod turn;

use std::path::PathBuf;

use serde::Serialize;

use turn::{TurnLink, TurnRequest};

/// An engine Misty has an adapter for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineKind {
    Claude,
    Codex,
    OpenCode,
}

pub const ENGINES: [EngineKind; 3] = [EngineKind::Claude, EngineKind::Codex, EngineKind::OpenCode];

impl EngineKind {
    /// The id an agent's definition names its engine by.
    pub fn id(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::OpenCode => "opencode",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
            Self::OpenCode => "OpenCode",
        }
    }

    /// The program's name on the command line.
    fn program(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::OpenCode => "opencode",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        ENGINES.into_iter().find(|engine| engine.id() == id)
    }

    pub fn find(self) -> Option<PathBuf> {
        resolve::find_program(self.program())
    }

    /// Runs one turn with this engine, reporting through `link` until it ends.
    pub async fn run(self, request: TurnRequest, link: TurnLink) -> Result<(), String> {
        let program = self.find().ok_or_else(|| {
            format!(
                "{} is not installed on this computer. Install it, sign in to it, then try again.",
                self.name()
            )
        })?;
        match self {
            Self::Claude => claude::run(&program, request, link).await,
            Self::Codex => codex::run(&program, request, link).await,
            Self::OpenCode => opencode::run(&program, request, link).await,
        }
    }
}

/// An engine as the settings and the agent editor list it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub installed: bool,
    pub version: Option<String>,
}

pub async fn list() -> Vec<EngineInfo> {
    let mut engines = Vec::new();
    for engine in ENGINES {
        let program = engine.find();
        let version = match &program {
            Some(path) => resolve::version_of(path).await,
            None => None,
        };
        engines.push(EngineInfo {
            id: engine.id(),
            name: engine.name(),
            installed: program.is_some(),
            version,
        });
    }
    engines
}

/// A model an engine can be asked for.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineModel {
    pub id: String,
    /// The engine's own default, which an agent that names no model gets.
    pub default: bool,
}

/// The models an engine offers on this computer. Empty when it can't say; the person can still
/// type one.
pub async fn models(engine: EngineKind) -> Vec<EngineModel> {
    let listed = match (engine, engine.find()) {
        (EngineKind::Codex, Some(program)) => codex::models(&program).await,
        // Claude Code takes these names for whichever models the account has.
        (EngineKind::Claude, Some(_)) => ["sonnet", "opus", "haiku"]
            .into_iter()
            .map(|name| (name.to_string(), false))
            .collect(),
        _ => Vec::new(),
    };
    listed
        .into_iter()
        .map(|(id, default)| EngineModel { id, default })
        .collect()
}

/// Ends what the engines left running, as the app quits.
pub async fn shutdown() {
    runs::stop_all();
    opencode::stop_server().await;
}
