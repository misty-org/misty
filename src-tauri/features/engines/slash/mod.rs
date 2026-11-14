//! The engines' own commands that Misty runs for them. An engine run headless (or over ACP, an
//! app-server or an HTTP server) skips the commands its terminal app runs itself — `/cost`,
//! `/status`, `/rename`, `/fork` and the like — so each engine's module here lists the commands
//! it has that Misty must run, and runs them:
//!
//! - `Runs::Turn`: the composer sends the text as the chat's next message and the adapter turns
//!   it into the engine's own call inside that turn (Codex's `native_command`, for one).
//! - `Runs::Misty`: the composer calls `engine_command_run`, and the engine's module answers out
//!   of turn, through the engine's own protocol or files, with something to show or do.
//!
//! The composer lists every one under the engine's `/` menu (`catalog.rs`), next to what the
//! engine itself reports, so nothing the terminal app offers is missing.

use std::path::PathBuf;

use serde::Serialize;

use database::store::Store;

pub mod acp;
pub mod agy;
pub mod claude;
pub mod codebuddy;
pub mod codex;
pub mod dsh;
pub mod files;
pub mod gemini;
pub mod opencode;
pub mod pi;
pub mod qoder;

/// Where a listed command runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Runs {
    /// Sent as the chat's next message; the engine (or its adapter, in the turn) runs it.
    Turn,
    /// Run by Misty out of turn through `engine_command_run`.
    Misty,
}

/// One command an engine has that Misty lists and, for `Runs::Misty`, runs.
#[derive(Clone, Copy, Debug)]
pub struct Command {
    pub name: &'static str,
    pub description: &'static str,
    pub argument_hint: Option<&'static str>,
    pub runs: Runs,
}

pub const fn turn(name: &'static str, description: &'static str) -> Command {
    Command {
        name,
        description,
        argument_hint: None,
        runs: Runs::Turn,
    }
}

pub const fn misty(name: &'static str, description: &'static str) -> Command {
    Command {
        name,
        description,
        argument_hint: None,
        runs: Runs::Misty,
    }
}

impl Command {
    pub const fn hint(mut self, hint: &'static str) -> Self {
        self.argument_hint = Some(hint);
        self
    }
}

/// What running a command out of turn gives the composer.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Output {
    /// Facts to show the person, in sections (`/status`, `/stats`, `/hooks`).
    Info {
        title: String,
        sections: Vec<Section>,
    },
    /// Text the composer sends as the chat's next message instead.
    Send { text: String },
    /// Done; a short line to show, if any.
    Done { notice: Option<String> },
    /// A Misty surface to open instead:
    /// - `settings:<section>` — a Settings block (`engine-mcp`, `engine-usage`, `engine-clis`,
    ///   `engine-skills`, `appearance`, `shortcuts`, `voice`, `agents-permissions`, …);
    /// - `panel:<tab>` — the chat's side panel (`session`, `steps`, `files`, `changes`,
    ///   `terminal`, `preview`);
    /// - `history` — the engine's past sessions;
    /// - `picker:<model|effort|mode|fast|folder>` — a composer control, opened;
    /// - `url:<https link>` — a page, in Misty's browser.
    Open { target: String },
    /// A new engine session copied from this one (`/fork`, `/branch`): the composer opens a new
    /// chat on it, and sends `prompt` there when there is one.
    Fork {
        session: String,
        title: Option<String>,
        prompt: Option<String>,
    },
    /// The engine renamed its session; the composer gives the chat the same title.
    Rename { title: String },
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<Row>,
    /// Plain or Markdown text under the rows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Row {
    pub label: String,
    pub value: String,
}

pub fn row(label: impl Into<String>, value: impl Into<String>) -> Row {
    Row {
        label: label.into(),
        value: value.into(),
    }
}

impl Output {
    pub fn info(title: impl Into<String>, sections: Vec<Section>) -> Self {
        Self::Info {
            title: title.into(),
            sections,
        }
    }
    pub fn done(notice: impl Into<String>) -> Self {
        Self::Done {
            notice: Some(notice.into()),
        }
    }
    pub fn open(target: impl Into<String>) -> Self {
        Self::Open {
            target: target.into(),
        }
    }
    pub fn send(text: impl Into<String>) -> Self {
        Self::Send { text: text.into() }
    }
}

/// What a command runs with: the chat, its folder and the engine's session for it.
pub struct Context {
    pub engine: String,
    pub account: String,
    pub conversation: String,
    /// The chat's linked folder; None when it has none.
    pub folder: Option<PathBuf>,
    /// The engine's own session (thread) id for this chat, once it has run here.
    pub session: Option<String>,
    /// What followed the command's name, trimmed.
    pub args: String,
    pub db: Store,
}

/// The commands `engine` has that Misty lists and runs for it.
pub fn commands(engine: &str) -> &'static [Command] {
    match engine {
        "claude" => claude::COMMANDS,
        "codex" => codex::COMMANDS,
        "opencode" => opencode::COMMANDS,
        "gemini" | "qwen" => gemini::commands(engine),
        "qoder" | "qoder-cn" => qoder::COMMANDS,
        "codebuddy" => codebuddy::COMMANDS,
        "dsh" => dsh::COMMANDS,
        "agy" => agy::COMMANDS,
        "pi" | "omp" => pi::commands(engine),
        "kimi" | "grok" | "minimax" | "hermes" => acp::commands(engine),
        _ => &[],
    }
}

/// Runs one of `engine`'s `Runs::Misty` commands.
pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    let known = commands(&context.engine)
        .iter()
        .any(|command| command.name == name && command.runs == Runs::Misty);
    if !known {
        return Err(format!("Misty doesn't run /{name} for this engine."));
    }
    match context.engine.as_str() {
        "claude" => claude::run(context, name).await,
        "codex" => codex::run(context, name).await,
        "opencode" => opencode::run(context, name).await,
        "gemini" | "qwen" => gemini::run(context, name).await,
        "qoder" | "qoder-cn" => qoder::run(context, name).await,
        "codebuddy" => codebuddy::run(context, name).await,
        "dsh" => dsh::run(context, name).await,
        "agy" => agy::run(context, name).await,
        "pi" | "omp" => pi::run(context, name).await,
        _ => acp::run(context, name).await,
    }
}
