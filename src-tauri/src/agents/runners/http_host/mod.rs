//! Coding tools that run as a local HTTP server rather than a child speaking
//! on stdio: OpenCode (`opencode serve`, events over SSE) and DeepSeek Shell
//! (`dsh web`, events over a WebSocket). Misty starts the tool's server for
//! the turn on a free loopback port, drives one session through it and stops
//! the server when the turn ends. Each adapter is a pure state machine
//! ([`HostedProtocol`]); [`driver`] does the network I/O, so adapters are
//! tested by feeding them messages.
pub mod driver;
pub mod dsh;
pub mod opencode;
pub mod server;
pub mod sse;
mod wire;

use serde_json::Value;

use super::{
    events::{PermissionRequest, RunnerEvent},
    CommandSpec, EngineId, Launch, RunnerError,
};

/// A request to the tool's server. Responses come back through
/// [`HostedProtocol::on_response`] with the same tag.
#[derive(Debug, Clone, PartialEq)]
pub enum HostCall {
    Post {
        tag: &'static str,
        path: String,
        body: Value,
    },
    /// Opens the event stream: an SSE GET, or a WebSocket that is sent these
    /// frames once it opens.
    OpenStream { path: String, frames: Vec<Value> },
}

/// What a response or stream message produced.
#[derive(Debug, Default, PartialEq)]
pub struct HostStep {
    pub events: Vec<RunnerEvent>,
    pub calls: Vec<HostCall>,
}

impl HostStep {
    pub fn events(events: Vec<RunnerEvent>) -> Self {
        Self {
            events,
            calls: Vec::new(),
        }
    }

    pub fn calls(calls: Vec<HostCall>) -> Self {
        Self {
            events: Vec::new(),
            calls,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self::events(vec![RunnerEvent::Error {
            message: message.into(),
        }])
    }
}

/// One session's conversation with a hosted tool.
pub trait HostedProtocol: Send {
    /// The first requests once the server is up.
    fn start(&mut self) -> Vec<HostCall>;
    /// A response to an earlier request. Success is a 2xx status.
    fn on_response(&mut self, tag: &str, status: u16, body: Value) -> HostStep;
    /// One message from the event stream, already decoded from JSON.
    fn on_message(&mut self, message: Value) -> HostStep;
    /// The requests that answer a permission question.
    fn answer(&mut self, request: &PermissionRequest, allow: bool, reason: &str) -> Vec<HostCall>;
    /// The requests that stop the turn early.
    fn cancel(&mut self) -> Vec<HostCall>;
}

/// How the server proves the caller may use it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostAuth {
    /// Loopback only; ready once the health path answers 200.
    None { health: &'static str },
    /// The server prints a one-time `?token=` link, exchanged for a cookie.
    TokenCookie,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    Sse,
    WebSocket,
}

/// A hosted tool's adapter.
pub trait HostedRunner: Send + Sync {
    /// The server command for a launch on this port. Refuses a mode the
    /// engine cannot honor.
    fn server(&self, launch: &Launch, port: u16) -> Result<CommandSpec, RunnerError>;
    fn auth(&self) -> HostAuth;
    fn stream(&self) -> StreamKind;
    fn protocol(&self, launch: &Launch) -> Box<dyn HostedProtocol>;
}

/// The hosted adapter for an engine, when it runs as a local server.
pub fn hosted_for(engine: EngineId) -> Option<Box<dyn HostedRunner>> {
    match engine {
        EngineId::Opencode => Some(Box::new(opencode::OpencodeRunner)),
        EngineId::Dsh => Some(Box::new(dsh::DshRunner)),
        _ => None,
    }
}

/// Reads a string at a JSON pointer.
pub(crate) fn text_at<'a>(value: &'a Value, pointer: &str) -> Option<&'a str> {
    value.pointer(pointer).and_then(Value::as_str)
}

/// Reads a count at the first pointer that has one.
pub(crate) fn count_at(value: &Value, pointers: &[&str]) -> u64 {
    pointers
        .iter()
        .find_map(|pointer| value.pointer(pointer).and_then(Value::as_u64))
        .unwrap_or(0)
}

#[cfg(test)]
mod driver_tests;
#[cfg(test)]
mod guard_tests;
#[cfg(test)]
mod tests;
