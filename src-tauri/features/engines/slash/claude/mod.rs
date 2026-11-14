//! The claude commands Misty lists and runs (see `slash/mod.rs`).
//!
//! Claude Code run headless (`-p`) runs its local commands (`/context`, `/config`, `/compact`,
//! …) inside a turn, so those are listed as `Runs::Turn`, with the names, descriptions and hints
//! its `initialize` answer gives (2.1.322), for the menu before Claude has run once. Its dialogs
//! (`/status`, `/hooks`, `/memory`, …) exist only in its terminal app; Misty asks a short-lived
//! Claude Code process for the same facts over its control protocol (`claude_control.rs`), which
//! makes no model call, and shows them. Its claude.ai pages open in Misty's browser.

use std::path::PathBuf;

use serde_json::{json, Value};

use super::{misty, row, turn, Command, Context, Output, Row, Section};
use crate::engines::claude::control::{self, Control, ANSWER};
use crate::engines::claude::{self, BackgroundTask};

mod about;
mod dialogs;
mod mcp;
mod session;
mod tasks;

use about::{doctor, help, version};
use dialogs::{context_usage, hooks, memory, permissions, plan, sandbox, skills, status};
use mcp::mcp;
use session::{branch, feedback, rename, side_question};
use tasks::tasks;

pub const COMMANDS: &[Command] = &[
    // Run by Claude Code itself inside the turn.
    turn("advisor", "Let Claude consult a stronger model at key moments")
        .hint("[fable|opus|sonnet|off]"),
    turn(
        "auto-mode-setup",
        "Teach auto mode about your environment, plus optional rule tweaks",
    )
    .hint("[--request-id <uuid>] (--wizard posture=… scope=… depth=… --propose | --expect-sha256 <64-hex> --apply-file <path>)"),
    turn("autocompact", "Configure the auto-compact window size").hint("[auto|<tokens>]"),
    turn(
        "compact",
        "Free up context by summarizing the conversation so far",
    )
    .hint("<optional custom summarization instructions>"),
    turn("config", "Set a setting by key").hint("key=value"),
    turn("output-style", "List output styles or switch to one").hint("[style]"),
    turn(
        "heapdump",
        "Dump the JS heap to the Desktop; on Linux with no Desktop folder, the home directory",
    ),
    turn(
        "init",
        "Initialize a new CLAUDE.md file with codebase documentation",
    ),
    turn("import", "Import config from another AI coding agent"),
    turn(
        "reload-skills",
        "Pick up skills added or changed on disk during this session",
    ),
    turn(
        "ultrareview",
        "Start a cloud agent that finds and verifies bugs in your branch (~5-15 min, $5-$25 USD) · Runs in a cloud session. See https://code.claude.com/docs/en/claude-code-on-the-web",
    ),
    turn(
        "security-review",
        "Complete a security review of the pending changes on the current branch",
    ),
    turn(
        "usage-credits",
        "Configure usage credits or request them from your admin when you hit a limit",
    ),
    turn(
        "insights",
        "Generate a report analyzing your Claude Code sessions",
    ),
    turn("recap", "Generate a one-line session recap now"),
    turn(
        "skill-doctor",
        "Show which loaded skills are unused and costing context",
    ),
    turn("goal", "Set a goal — keep working until the condition is met"),
    turn(
        "design-consent",
        "Grant Claude agent access to your Design projects",
    ),
    turn(
        "design-revoke",
        "Revoke Claude agent access to your Design projects",
    ),
    turn(
        "list-agents",
        "List subagents, teammates, and other Claude sessions you can message",
    ),
    turn(
        "team-onboarding",
        "Help teammates ramp on Claude Code with a guide from your usage",
    ),
    // Its terminal app's dialogs, answered over the control protocol.
    misty(
        "status",
        "Show Claude Code status including version, model, account, API connectivity, and tool statuses",
    ),
    misty("context", "Show current context usage"),
    misty("memory", "Show CLAUDE.md files and saved memories"),
    misty("hooks", "View hook configurations for tool events"),
    misty("permissions", "Show the allow, ask and deny tool permission rules"),
    misty("sandbox", "Show the sandbox's settings and restrictions"),
    misty("skills", "List available skills"),
    misty("plan", "View the current session plan"),
    misty(
        "tasks",
        "View and manage everything running in the background",
    )
    .hint("[stop <id>]"),
    misty("bashes", "View and manage everything running in the background (/tasks)")
        .hint("[stop <id>]"),
    misty("mcp", "Manage MCP servers").hint("[reconnect|enable|disable [<server>|all]]"),
    misty("rename", "Rename the current conversation").hint("<name>"),
    misty(
        "branch",
        "Create a branch of the current conversation at this point",
    )
    .hint("[name]"),
    misty(
        "fork",
        "Continue in a new chat that inherits the full conversation",
    )
    .hint("<directive>"),
    misty(
        "btw",
        "Ask a quick side question without interrupting the main conversation",
    )
    .hint("<question>"),
    misty("feedback", "Send feedback to Anthropic or report a bug").hint("<feedback>"),
    misty("bug", "Report a bug to Anthropic").hint("<what went wrong>"),
    misty("help", "List Claude Code's commands"),
    misty("version", "Show the Claude Code version"),
    misty(
        "doctor",
        "Check Claude Code's setup: account, MCP servers and sandbox",
    ),
    // Its claude.ai and documentation pages.
    misty("release-notes", "View release notes"),
    misty(
        "upgrade",
        "Upgrade your plan for higher rate limits and more Opus",
    ),
    misty("privacy-settings", "View and update your privacy settings"),
    misty(
        "install-github-app",
        "Set up Claude GitHub Actions for a repository",
    ),
    misty("install-slack-app", "Install the Claude Slack app"),
    misty("remote-control", "Open Claude Code on the web"),
    misty("mobile", "Get the Claude mobile app"),
    misty(
        "web-setup",
        "Set up cloud sessions with your GitHub account",
    ),
    misty("desktop", "Get Claude Desktop"),
    misty("teleport", "Resume a cloud session from claude.ai"),
    // Terminal-only (Claude Code's `terminal_slash_commands`): what they mean in Misty.
    misty("color", "Set the prompt bar color for this session"),
    misty(
        "focus",
        "Toggle focus view: just your prompt, summary, and response",
    ),
    misty(
        "reload-plugins",
        "Activate pending plugin changes in the current session",
    ),
];

/// The pages Claude Code's own commands open, as its 2.1.322 build names them.
const PAGES: &[(&str, &str)] = &[
    ("release-notes", "https://code.claude.com/docs/en/changelog"),
    ("upgrade", "https://claude.ai/upgrade/max"),
    (
        "privacy-settings",
        "https://claude.ai/settings/data-privacy-controls",
    ),
    (
        "install-github-app",
        "https://github.com/apps/claude/installations/new",
    ),
    (
        "install-slack-app",
        "https://slack.com/marketplace/A08SF47R6P4-claude",
    ),
    ("remote-control", "https://claude.ai/code"),
    ("mobile", "https://claude.ai/mobile"),
    ("web-setup", "https://claude.ai/connect-github"),
    ("desktop", "https://clau.de/desktop"),
    ("teleport", "https://claude.ai/code"),
];

pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    if let Some((_, url)) = PAGES.iter().find(|(page, _)| *page == name) {
        return Ok(Output::open(format!("url:{url}")));
    }
    match name {
        "status" => status(&context).await,
        "context" => context_usage(&context).await,
        "memory" => memory(&context).await,
        "hooks" => hooks(&context).await,
        "permissions" => permissions(&context).await,
        "sandbox" => sandbox(&context).await,
        "skills" => skills(&context).await,
        "plan" => plan(&context).await,
        "tasks" | "bashes" => tasks(&context).await,
        "mcp" => mcp(&context).await,
        "rename" => rename(&context).await,
        "branch" => branch(&context, false).await,
        "fork" => branch(&context, true).await,
        "btw" => side_question(&context).await,
        "feedback" | "bug" => feedback(&context).await,
        "help" => help(&context).await,
        "version" => version(&context).await,
        "doctor" => doctor(&context).await,
        "color" => Ok(Output::done(
            "Misty has no prompt bar to color. /color only changes Claude Code's terminal.",
        )),
        "focus" => Ok(Output::done(
            "Misty's chat already shows your prompts and Claude's replies, with its steps in the side panel.",
        )),
        "reload-plugins" => Ok(Output::done(
            "Each message starts Claude Code afresh, so your next one uses the plugins as they are now.",
        )),
        _ => Err(format!("Misty doesn't run /{name} for Claude Code.")),
    }
}

// ── the control process ──────────────────────────────────────────────────────

/// Where the process runs: the chat's folder, or the home folder for a chat with none (then it
/// has no session either, and answers for Claude Code as a whole).
fn folder(context: &Context) -> PathBuf {
    context
        .folder
        .clone()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
}

async fn ask(context: &Context, request: Value) -> Result<Value, String> {
    control::ask(
        &folder(context),
        context.session.as_deref(),
        request,
        ANSWER,
    )
    .await
}

fn session(context: &Context) -> Result<&str, String> {
    context
        .session
        .as_deref()
        .ok_or_else(|| "Send Claude a message in this chat first.".to_string())
}

// ── reading answers ──────────────────────────────────────────────────────────

fn text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Bool(true) => "Yes".into(),
        Value::Bool(false) => "No".into(),
        other => other.to_string(),
    }
}

fn field(value: &Value, key: &str) -> String {
    text(value.get(key).unwrap_or(&Value::Null))
}

fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

/// A token count as Claude Code writes it: 940, 26.6k, 1m.
fn tokens(count: u64) -> String {
    let short = |value: f64, unit: &str| {
        let text = format!("{value:.1}");
        format!("{}{unit}", text.trim_end_matches(".0"))
    };
    match count {
        0..=999 => count.to_string(),
        1_000..=999_999 => short(count as f64 / 1_000.0, "k"),
        _ => short(count as f64 / 1_000_000.0, "m"),
    }
}

/// A description's first sentence or line, at most 160 characters: skills' descriptions are
/// written for the model and can run to a paragraph.
fn brief(description: &str) -> String {
    const MOST: usize = 160;
    let line = description.trim().lines().next().unwrap_or_default().trim();
    let sentence = match line.find(". ") {
        Some(end) => &line[..=end],
        None => line,
    };
    if sentence.chars().count() <= MOST {
        return sentence.to_string();
    }
    let cut: String = sentence.chars().take(MOST - 1).collect();
    format!("{}…", cut.trim_end())
}

fn section(heading: &str, rows: Vec<Row>) -> Section {
    Section {
        heading: Some(heading.to_string()),
        rows,
        text: None,
    }
}

fn note(heading: Option<&str>, text: impl Into<String>) -> Section {
    Section {
        heading: heading.map(str::to_string),
        rows: Vec::new(),
        text: Some(text.into()),
    }
}

/// Claude Code's names for where a setting came from.
fn source_name(source: &str) -> String {
    match source {
        "userSettings" => "User settings".into(),
        "projectSettings" => "Project settings".into(),
        "localSettings" => "Local settings".into(),
        "policySettings" => "Managed settings".into(),
        "flagSettings" | "cliArg" => "Launch flag".into(),
        "session" => "This session".into(),
        other => other.into(),
    }
}

/// `get_status`'s sections, as its terminal dialog shows them, less what describes the
/// short-lived process rather than the chat: its socket (`Peer address`), its kind (always
/// `interactive`, though it runs headless) and, in a chat Claude hasn't run in, the id of the
/// throwaway session it opened, which is never saved.
fn status_sections(answer: &Value, session: Option<&str>) -> Vec<Section> {
    list(answer, "sections")
        .iter()
        .map(|part| Section {
            heading: Some(field(part, "title")).filter(|title| !title.is_empty()),
            rows: list(part, "rows")
                .iter()
                .filter(|item| match field(item, "label").as_str() {
                    "Peer address" | "Session kind" => false,
                    "Session ID" => session.is_some(),
                    _ => true,
                })
                .map(|item| {
                    let label = field(item, "label");
                    // Its one lowercase label, in the words the rest of the dialog uses.
                    let label = if label == "cwd" {
                        "Folder".to_string()
                    } else {
                        label
                    };
                    row(label, field(item, "value"))
                })
                .collect(),
            text: None,
        })
        .collect()
}

/// Runs Misty's out-of-turn Claude Code commands against the installed CLI, signed in, and
/// prints each Output to read. They make no model call: each command is a control request,
/// and the scratch session is made by a local command (`/context`), which runs no turn.
/// `cargo test --lib engines::slash::claude::live_tests -- --ignored --nocapture --test-threads 1`
#[cfg(all(test, unix))]
mod live_tests;
