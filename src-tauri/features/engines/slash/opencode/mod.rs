//! The opencode commands Misty lists and runs (see `slash/mod.rs`).
//!
//! Misty runs OpenCode's turns on a managed `opencode serve` (`opencode_server.rs`), so what its
//! terminal app does with its own `/` commands is a call to that server's HTTP API, made here out
//! of turn, against the chat's session (`ses_…`) and folder. `/compact`, `/init` and `/review`
//! are OpenCode's own session calls and go in the turn (`opencode_session::run_command`).
//!
//! OpenCode 2.x moved the server API under `/api/…` (checked against 2.3.0's `/openapi.json` and a
//! live server): each command below picks its route from [`opencode_server::is_v2`]. 2.x dropped
//! session sharing and Console orgs, and serves no LSP or formatter status, so those say so.
//!
//! Left out: `/workspaces` and `/warp` (behind OpenCode's experimental workspaces flag) and
//! `/move` (moving a session to another folder, not checked against a running server).

use std::time::Duration;

use reqwest::Method;
use serde_json::{json, Value};

use super::{misty, row, turn, Command, Context, Output, Row, Section};
use crate::engines::opencode_server::{self, data};
use crate::engines::opencode_session;

mod lists;
mod mcp;
mod session;
mod shell;
mod status;

use lists::{agents, org, skills};
use mcp::mcp;
use session::{fork, redo, redo_v2, rename, share, undo, undo_v2, unshare};
use shell::{shell, shell_v2};
use status::{debug, debug_v2, status, status_v2};

pub const COMMANDS: &[Command] = &[
    // OpenCode's report leaves `/compact` out (its terminal app runs it, not the server's command
    // list), and it would vanish from the menu once the report replaces the built-in rows.
    turn(
        "compact",
        "Summarize the conversation so far to free context",
    ),
    turn("init", "Write an AGENTS.md that describes this project"),
    turn("review", "Review changes, the uncommitted ones by default").hint("[commit|branch|pr]"),
    misty("rename", "Rename this session").hint("<title>"),
    misty("fork", "Copy this session into a new chat").hint("[message]"),
    misty("undo", "Undo the last message and its file changes"),
    misty("redo", "Bring back what undo took"),
    misty("shell", "Run a shell command in this session").hint("<command>"),
    misty(
        "status",
        "Show OpenCode's MCP servers, LSP servers, formatters and plugins",
    ),
    misty("debug", "Show OpenCode's version, paths and session"),
    misty("mcps", "Turn an MCP server on or off, or sign in to one")
        .hint("<name> on|off | auth <name>"),
    misty("mcp", "Turn an MCP server on or off, or sign in to one")
        .hint("<name> on|off | auth <name>"),
    misty("agents", "List OpenCode's agents"),
    misty("skills", "List OpenCode's skills"),
    misty("share", "Share this session on a public link"),
    misty("unshare", "Stop sharing this session"),
    misty("org", "Show or switch your OpenCode Console org").hint("[name]"),
];

/// How long an ordinary call may take.
const CALL_TIMEOUT: Duration = Duration::from_secs(30);
/// A shell command answers once it has finished, so it gets as long as a command might run.
const SHELL_TIMEOUT: Duration = Duration::from_secs(600);
/// The MCP sign-in waits for the browser; past this it is left running and the person is told
/// to finish there. OpenCode gives up on its own after its callback timeout.
const SIGN_IN_WAIT: Duration = Duration::from_secs(3);
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(600);
/// The most of a shell command's output shown, from its end.
const MOST_OUTPUT: usize = 20_000;

const NO_SESSION: &str = "OpenCode has no session for this chat yet. Send a message first.";
const NO_SHARING: &str = "OpenCode 2 removed session sharing.";

pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    let args = context.args.as_str();
    match name {
        // Bare, these open Misty's own MCP settings, as `/mcp` does for every engine.
        "mcp" | "mcps" if args.is_empty() => return Ok(Output::open("settings:engine-mcp")),
        "rename" if args.is_empty() => return Err("Give the new title: /rename <title>".into()),
        "shell" if args.is_empty() => return Err("Give a command to run: /shell <command>".into()),
        _ => {}
    }
    let in_session = matches!(
        name,
        "rename" | "fork" | "undo" | "redo" | "shell" | "share" | "unshare"
    );
    let session = context.session.clone();
    if in_session && session.is_none() {
        // A chat that hasn't run yet still takes the title; OpenCode's session starts with the
        // first message.
        if name == "rename" {
            return Ok(Output::Rename {
                title: args.to_owned(),
            });
        }
        return Ok(Output::done(NO_SESSION));
    }
    let session = session.unwrap_or_default();
    let server = Server::up(&context).await?;
    if server.v2 {
        return match name {
            "rename" => rename(&server, &session, args).await,
            "fork" => fork(&server, &session, args).await,
            "undo" => undo_v2(&server, &session).await,
            "redo" => redo_v2(&server, &session).await,
            "shell" => shell_v2(&server, &session, args).await,
            "status" => status_v2(&server).await,
            "debug" => debug_v2(&server, context.session.as_deref()).await,
            "mcp" | "mcps" => mcp(&server, args).await,
            "agents" => agents(&server).await,
            "skills" => skills(&server).await,
            "share" | "unshare" => Ok(Output::done(NO_SHARING)),
            "org" => Ok(Output::done(
                "OpenCode 2 has no Console orgs; its accounts are integrations, set up in its terminal app with /connect.",
            )),
            _ => Err(format!("Misty doesn't run /{name} for this engine.")),
        };
    }
    match name {
        "rename" => rename(&server, &session, args).await,
        "fork" => fork(&server, &session, args).await,
        "undo" => undo(&server, &session).await,
        "redo" => redo(&server, &session).await,
        "shell" => shell(&server, &session, args).await,
        "status" => status(&server).await,
        "debug" => debug(&server, context.session.as_deref()).await,
        "mcp" | "mcps" => mcp(&server, args).await,
        "agents" => agents(&server).await,
        "skills" => skills(&server).await,
        "share" => share(&server, &session).await,
        "unshare" => unshare(&server, &session).await,
        "org" => org(&server, args).await,
        _ => Err(format!("Misty doesn't run /{name} for this engine.")),
    }
}

/// The running server, routed to the chat's folder.
struct Server {
    origin: String,
    directory: Option<String>,
    /// OpenCode 2.x's `/api/…` routes.
    v2: bool,
}

impl Server {
    async fn up(context: &Context) -> Result<Self, String> {
        let origin = opencode_server::ensure_running().await?;
        let directory = context
            .folder
            .as_ref()
            .map(|folder| folder.to_string_lossy().into_owned());
        // The server is up for this folder: its commands go to the `/` menu now, before the
        // chat's first turn.
        if let Some(directory) = &directory {
            tokio::spawn(opencode_session::report_commands(
                origin.clone(),
                directory.clone(),
            ));
        }
        let v2 = opencode_server::is_v2(&origin);
        Ok(Self {
            origin,
            directory,
            v2,
        })
    }

    /// The route for this server: 2.x's `/api/…` one, else 1.x's.
    fn path(&self, v1: impl Into<String>, v2: impl Into<String>) -> String {
        if self.v2 {
            v2.into()
        } else {
            v1.into()
        }
    }

    async fn call(&self, method: Method, path: &str, body: Option<Value>) -> Result<Value, String> {
        self.call_for(method, path, body, CALL_TIMEOUT).await
    }

    async fn call_for(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, String> {
        opencode_server::call(
            method,
            &self.origin,
            path,
            self.directory.as_deref(),
            body,
            timeout,
        )
        .await
    }

    async fn get(&self, path: &str) -> Result<Value, String> {
        self.call(Method::GET, path, None).await
    }

    /// The session's messages, oldest first. Only session commands ask, and a session always
    /// has its folder.
    async fn messages(&self, session: &str) -> Result<Vec<Value>, String> {
        let directory = self.directory.as_deref().unwrap_or_default();
        opencode_session::messages(&self.origin, directory, session).await
    }
}

fn text_at<'a>(value: &'a Value, pointer: &str) -> Option<&'a str> {
    value.pointer(pointer).and_then(Value::as_str)
}

fn message_id(message: &Value) -> Option<&str> {
    text_at(message, "/info/id")
}

/// What the person typed in a message: its text parts, less the ones OpenCode added itself.
fn prompt_text(message: &Value) -> String {
    message
        .get("parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|part| {
            part.get("type").and_then(Value::as_str) == Some("text")
                && part.get("synthetic").and_then(Value::as_bool) != Some(true)
        })
        .filter_map(|part| text_at(part, "/text"))
        .collect::<Vec<_>>()
        .join("")
}

/// A message's first line, short enough for a notice.
fn first_line(text: &str) -> String {
    text.trim()
        .lines()
        .next()
        .unwrap_or("")
        .chars()
        .take(80)
        .collect()
}

/// The last `most` characters of `text`.
fn tail(text: &str, most: usize) -> &str {
    let count = text.chars().count();
    if count <= most {
        return text;
    }
    let start = text
        .char_indices()
        .nth(count - most)
        .map_or(0, |(at, _)| at);
    &text[start..]
}

/// A name as one URL path segment: anything but unreserved characters percent-encoded.
fn path_segment(name: &str) -> String {
    name.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}
