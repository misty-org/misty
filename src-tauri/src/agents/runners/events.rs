//! What a coding tool reports while it works, in one vocabulary for every
//! engine. Adapters turn each tool's own output into these events; the mirror
//! forwards them to the server as the run's invocation events.
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One step of the tool's own todo list or plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TodoItem {
    pub id: String,
    pub title: String,
    /// pending, in_progress or done, mapped from the tool's own words.
    pub status: String,
}

/// Tokens one turn used, by class, as the tool reported them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Usage {
    pub input: u64,
    pub output: u64,
    pub cache_write: u64,
    pub cache_read: u64,
    /// The model the tool ran, when it said.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model: String,
}

impl Usage {
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_write + self.cache_read
    }
}

/// What a permission question is about, as Misty's rules see it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    /// Reading, searching, listing: never pauses.
    Read,
    /// Changing files inside the attached project.
    Edit,
    /// Running a command inside the project.
    Run,
    /// Installing packages or tools.
    Install,
    /// Pushing commits to a remote.
    Push,
    /// Reaching the network.
    Network,
    /// Anything the adapter could not classify: treated as needing the person.
    Other,
}

/// A tool asks before acting. The bridge answers it in the tool's protocol.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PermissionRequest {
    /// The tool's own id for the question, echoed in the answer.
    pub id: String,
    /// The tool's name for the action, e.g. Bash, Edit, commandExecution.
    pub tool: String,
    pub kind: ActionKind,
    /// The file the action touches, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The command it would run, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// The tool's original input, returned unchanged when allowed.
    pub input: Value,
}

/// How much of a usage window the tool has used, when it reports it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RateLimit {
    pub used_percent: f64,
    /// The window it measures, e.g. "5h" or "weekly", when known.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub window: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RunnerEvent {
    /// The tool's session id, for resuming the conversation later.
    Session { id: String },
    Delta { text: String },
    Thinking { text: String },
    Message { text: String },
    Usage(Usage),
    Todos { items: Vec<TodoItem> },
    /// The tool asks the person a question in words, not a permission.
    Question { text: String },
    PermissionRequest(PermissionRequest),
    /// A plan the tool proposes from a read-only launch.
    PlanDraft { text: String },
    RateLimit(RateLimit),
    Done { stop_reason: String },
    Error { message: String },
}

/// Maps a tool's step status onto pending, in_progress or done.
pub fn todo_status(raw: &str) -> &'static str {
    match raw {
        "in_progress" | "inProgress" | "in-progress" | "active" | "running" => "in_progress",
        "completed" | "complete" | "done" | "finished" => "done",
        _ => "pending",
    }
}
