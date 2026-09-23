//! Coding tools as runners. Each engine adapter knows how to start its tool,
//! read what it prints and answer its permission questions; everything around
//! that (the process registry, permission bridge, budget lease and mirror to
//! the server) is shared.
pub mod bridge;
pub mod claude;
pub mod codex;
pub mod detect;
pub mod events;
pub mod lease;
pub mod mirror;
pub mod registry;
pub mod session;

use std::{fmt, path::PathBuf};

use events::{PermissionRequest, RunnerEvent};

/// Every engine Misty can delegate to. Ids match the server's runner column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EngineId {
    Claude,
    Codex,
    Kimi,
    Minimax,
    Grok,
    Pi,
    Omp,
    Dsh,
    Agy,
    Opencode,
    Qoder,
    QoderCn,
}

impl EngineId {
    pub const ALL: [EngineId; 12] = [
        EngineId::Claude,
        EngineId::Codex,
        EngineId::Kimi,
        EngineId::Minimax,
        EngineId::Grok,
        EngineId::Pi,
        EngineId::Omp,
        EngineId::Dsh,
        EngineId::Agy,
        EngineId::Opencode,
        EngineId::Qoder,
        EngineId::QoderCn,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            EngineId::Claude => "claude",
            EngineId::Codex => "codex",
            EngineId::Kimi => "kimi",
            EngineId::Minimax => "minimax",
            EngineId::Grok => "grok",
            EngineId::Pi => "pi",
            EngineId::Omp => "omp",
            EngineId::Dsh => "dsh",
            EngineId::Agy => "agy",
            EngineId::Opencode => "opencode",
            EngineId::Qoder => "qoder",
            EngineId::QoderCn => "qoder-cn",
        }
    }

    pub fn parse(value: &str) -> Option<EngineId> {
        EngineId::ALL.into_iter().find(|engine| engine.as_str() == value)
    }
}

impl fmt::Display for EngineId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// How a launch may act. Never anything looser: no bypass modes exist here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchMode {
    /// Read-only research ending in a plan.
    Plan,
    /// Every change goes through the permission bridge.
    Ask,
    /// Edits inside the project continue; the rest still goes through the bridge.
    AutoEdit,
}

/// How the adapter talks to its tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    /// A child per turn printing JSON lines, with a JSON control channel on stdin.
    StreamJson,
    /// JSON-RPC over stdio: the Codex app-server protocol.
    AppServer,
    /// JSON-RPC over stdio: the Agent Client Protocol.
    Acp,
    /// A child per turn with no way to ask mid-turn.
    LaunchOnly,
}

/// What an engine can do, which decides the work it may be given.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Capabilities {
    /// It asks before acting mid-turn, so Ask and Auto both work fully.
    pub interactive_asks: bool,
    /// It has a read-only or plan launch.
    pub plan_mode: bool,
    /// It reports a todo list or plan while it works.
    pub todos: bool,
    /// It reports how much of its own usage limit is used.
    pub rate_limits: bool,
    /// It can only run with full access (no asks, no read-only mode).
    pub full_access_only: bool,
}

/// One turn's launch.
#[derive(Debug, Clone)]
pub struct Launch {
    pub project_root: PathBuf,
    pub task: String,
    pub mode: LaunchMode,
    pub model: Option<String>,
    /// The tool's session to continue, from an earlier Session event.
    pub session: Option<String>,
}

/// The process to start for a launch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunnerError {
    /// The launch asks for something this engine cannot do safely.
    Unsupported(&'static str),
    Invalid(&'static str),
}

/// What one line of the tool's output produced: events to report, and lines
/// to write back (a protocol's next request, such as starting the turn).
#[derive(Debug, Default, PartialEq)]
pub struct Step {
    pub events: Vec<RunnerEvent>,
    pub writes: Vec<String>,
}

impl Step {
    pub fn events(events: Vec<RunnerEvent>) -> Self {
        Self { events, writes: Vec::new() }
    }
}

/// One session's conversation with a tool. Protocols that need a handshake
/// (JSON-RPC servers) keep their state here.
pub trait Protocol: Send {
    /// Lines written to the tool's stdin once it starts.
    fn initial_input(&mut self) -> Vec<String>;
    /// Reads one line of the tool's output.
    fn on_line(&mut self, line: &str) -> Step;
    /// The line that answers a permission question in the tool's protocol.
    fn answer(&mut self, request: &PermissionRequest, allow: bool, reason: &str) -> Option<String>;
}

/// A coding tool's adapter.
pub trait Runner: Send + Sync {
    fn engine(&self) -> EngineId;
    fn transport(&self) -> Transport;
    fn capabilities(&self) -> Capabilities;
    /// The command for a launch. Refuses a mode the engine cannot honor.
    fn build_command(&self, launch: &Launch) -> Result<CommandSpec, RunnerError>;
    /// A fresh protocol session for a launch.
    fn protocol(&self, launch: &Launch) -> Box<dyn Protocol>;
}

/// The adapter for an engine available in this build.
pub fn runner_for(engine: EngineId) -> Option<Box<dyn Runner>> {
    match engine {
        EngineId::Claude => Some(Box::new(claude::ClaudeRunner)),
        EngineId::Codex => Some(Box::new(codex::CodexRunner)),
        _ => None,
    }
}

/// Flags and settings that remove the tool's own permission checks. Routed
/// work never passes them; a test pins every adapter against this list.
pub const BYPASS_MARKERS: [&str; 7] = [
    "--dangerously-skip-permissions",
    "--dangerously-bypass-approvals-and-sandbox",
    "bypassPermissions",
    "--yolo",
    "danger-full-access",
    "\"never\"",
    "--full-auto",
];

#[cfg(test)]
mod tests;
