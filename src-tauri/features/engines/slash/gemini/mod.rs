use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde_json::{json, Value};

use super::files::{self, display_path};
use super::{misty, row, turn, Command, Context, Output, Row, Section};
use crate::engines::gemini as adapter;
use crate::engines::acp_session::{self as acp, AcpLine};

mod chat;
mod cli;
mod qwen;
mod restore;
use chat::chat;
use cli::{
    bug, custom_commands, encode_component, hooks, permissions, policies, privacy_url, upgrade,
    user_settings_path, DOCS_URL,
};
use qwen::run_qwen;
use restore::restore;

pub fn commands(engine: &str) -> &'static [Command] {
    match engine {
        "gemini" => GEMINI,
        "qwen" => QWEN,
        _ => &[],
    }
}

const GEMINI: &[Command] = &[
    turn("about", "Show version and environment info"),
    turn("help", "Show available commands"),
    turn(
        "init",
        "Analyzes the project and creates a tailored GEMINI.md file",
    ),
    turn("memory", "Manage memory").hint("[show|refresh|list|inbox]"),
    turn("extensions", "Manage extensions")
        .hint("[list|explore|enable|disable|install|link|uninstall|restart|update]"),
    misty(
        "restore",
        "Restore to a previous checkpoint, or list available checkpoints to restore",
    )
    .hint("[list|<checkpoint>|enable]"),
    misty("commands", "List custom slash commands from .toml files"),
    misty("chat", "List or delete saved conversation checkpoints").hint("list | delete <tag>"),
    misty("bug", "Submit a bug report").hint("<description>"),
    misty("docs", "Open full Gemini CLI documentation in your browser"),
    misty("privacy", "Display the privacy notice"),
    misty(
        "upgrade",
        "Upgrade your Gemini Code Assist tier for higher limits",
    ),
    misty(
        "permissions",
        "Manage folder trust settings and other permissions",
    )
    .hint("[trust [<directory-path>]]"),
    misty("hooks", "Manage hooks"),
    misty("policies", "List all active policies"),
];

const QWEN: &[Command] = &[
    turn(
        "init",
        "Analyzes the project and creates a tailored QWEN.md file.",
    ),
    turn(
        "compress",
        "Compresses the context by replacing it with a summary.",
    ),
    turn(
        "compress-fast",
        "Fast context compression without AI. Strips old tool outputs and thinking parts.",
    ),
    turn(
        "summary",
        "Generate a project summary and save it to .qwen/PROJECT_SUMMARY.md",
    )
    .hint("[path]"),
    turn(
        "btw",
        "Ask a quick side question without affecting the main conversation",
    ),
    turn("goal", "Set or control a session goal")
        .hint("[<objective> | set <objective> | edit <objective> | pause | resume | clear]"),
    turn("remember", "Save a durable memory to the memory system.").hint("<text to remember>"),
    turn(
        "forget",
        "Remove matching entries from managed auto-memory.",
    )
    .hint("<memory text to remove>"),
    turn("dream", "Consolidate managed auto-memory topic files."),
    turn(
        "learn",
        "Create a reusable skill from a knowledge source (file, URL, conversation, or text).",
    )
    .hint("<path|URL|text> [focus]"),
    turn(
        "insight",
        "generate personalized programming insights from your chat history",
    ),
    turn("pr", "Bind a GitHub pull request to this session").hint("[number | url]"),
    turn("hooks", "Manage Qwen Code hooks"),
    turn("tasks", "List background tasks"),
    turn(
        "workflows",
        "List workflow runs or cooperatively pause/resume a live run",
    ),
    turn("doctor", "Run installation and environment diagnostics")
        .hint("[memory|cpu-profile|rollback] [--sample] [--snapshot] [--duration]"),
    turn("language", "View or change the language setting").hint("ui|output <language>"),
    turn("config", "Get or set any setting by dot-path key").hint("<key>[=<value>] or --help"),
    turn("advisor", "Configure the Advisor model").hint("[<model-id>|off|review [focus]]"),
    turn("import-config", "Import MCP servers from Claude configs")
        .hint("[all|claude-code|claude-desktop] [--scope user|project]"),
    misty("extensions", "Manage extensions").hint("[list|explore [Gemini|ClaudeCode]|install|...]"),
    misty("branch", "Fork the current conversation into a new session").hint("[name]"),
    misty(
        "agents",
        "Manage subagents for specialized task delegation.",
    ),
    misty("memory", "Show the QWEN.md and AGENTS.md files in use"),
    misty("permissions", "Manage permission rules"),
    misty("upgrade", "Open Qwen subscription plans"),
    misty("setup-github", "Set up GitHub Actions"),
    misty("commit", "Create a git commit with an AI-drafted message").hint("[instructions]"),
    misty("recap", "Generate a one-line session recap now"),
];

pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    if context.engine == "qwen" {
        return run_qwen(context, name).await;
    }
    let args = context.args.as_str();
    match name {
        "commands" => Ok(custom_commands(context.folder.as_deref())),
        "chat" => chat(context.folder.as_deref(), args),
        "bug" => Ok(bug(args)),
        "docs" => Ok(Output::open(format!("url:{DOCS_URL}"))),
        "privacy" => Ok(Output::open(format!("url:{}", privacy_url()))),
        "upgrade" => Ok(upgrade()),
        "permissions" => permissions(context.folder.as_deref(), args),
        "hooks" => Ok(hooks(context.folder.as_deref())),
        "policies" => Ok(policies(context.folder.as_deref())),
        "restore" => restore(context.folder.as_deref(), args),
        _ => Err(format!("Misty doesn't run /{name} for Gemini CLI.")),
    }
}

#[cfg(test)]
mod tests;

#[cfg(all(test, unix))]
mod live_tests;
