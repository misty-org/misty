//! The pi and Oh My Pi commands Misty lists and runs (see `slash/mod.rs`).
//!
//! Oh My Pi runs most of its built-in commands from a prompt in rpc mode: they print their text
//! (`command_output`) and answer `agentInvoked: false`, which the adapter turns into the reply
//! and the turn's end (`pi_family.rs`). They are listed here as `Runs::Turn`, so the menu has them
//! before omp first reports its own list. Its branching flows have no prompt form, only rpc
//! calls.
//!
//! omp's TUI-only flows (`handleTui`, which rpc mode never runs; a typed `/btw` there would reach
//! the model as plain text) are ported here: `/btw` and `/omfg` ask in a throwaway `--fork` with
//! no tools, as the TUI's ephemeral turn does; `/tan` opens a fork as a new chat with the TUI's
//! context-switch notice; `/cleanse` runs `omp cleanse`. `/goal`, `/guided-goal` and `/loop` are
//! run by Misty's own goal runner, which sends the next turns as omp's TUI would. `/vibe` swaps
//! the session's tools in the TUI's input loop with no rpc command, so it only says so.
//!
//! pi's rpc prompt runs none of its built-in commands, only extension commands, prompt templates
//! and skills. Its built-ins are rpc calls, which Misty makes out of turn on a short-lived pi
//! process opened on the chat's session (`pi_family::RpcSession`); `/compact` is the adapter's,
//! inside the turn.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

use super::{misty, row, turn, Command, Context, Output, Row, Section};
use crate::engines::pi_family::RpcSession;

mod omfg;
mod omp;
mod session;
use omfg::{omfg, omfg_args};
use omp::{btw, cleanse, omp_tui_only, omp_usage, side_reply, tan};
use session::{clone, export, fork, rename, session_info, tree, Flavor};

/// How long a side question or rule forge may take: one model reply, no tools.
const SIDE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// `omp cleanse` runs checkers and a swarm of subagents until the project is clean.
const CLEANSE_TIMEOUT: Duration = Duration::from_secs(60 * 60);

const PI: &[Command] = &[
    turn("compact", "Manually compact the session context").hint("[instructions]"),
    misty("session", "Show session info and stats"),
    misty("name", "Set session display name").hint("<name>"),
    misty("rename", "Set session display name").hint("<name>"),
    misty("fork", "Create a new fork from a previous user message").hint("[list | <number>]"),
    misty(
        "clone",
        "Duplicate the current session at the current position",
    ),
    misty("tree", "Show the session tree and its branches"),
    misty("export", "Export session to an HTML file").hint("[path]"),
];

/// omp's commands with a prompt form (those its rpc mode runs), with omp's own descriptions and
/// hints. Left out: `model` and `fast` (the composer's pickers), `stats` (it serves a dashboard
/// from the turn's process, which exits when the turn ends).
const OMP: &[Command] = &[
    turn("context", "Show context usage"),
    turn("compact", "Compact the conversation").hint("[soft|remote|snapcompact] [focus]"),
    turn("session", "Show or configure the current session").hint("[info|delete|pin [account]]"),
    turn("usage", "Show token usage").hint("[show|reset [account|active]]"),
    turn("jobs", "Show background jobs"),
    turn("tools", "Show available tools"),
    turn("todo", "Manage todos").hint("<subcommand>"),
    turn("dirs", "List this session's workspace directories"),
    turn("add-dir", "Add a workspace directory to this session").hint("<path>"),
    turn(
        "remove-dir",
        "Remove a workspace directory from this session",
    )
    .hint("<path>"),
    turn("move", "Move the current session to a different directory").hint("[<path>]"),
    turn("memory", "Manage memory").hint("<subcommand>"),
    turn("mcp", "Manage MCP servers").hint("<subcommand>"),
    turn("plugins", "Manage plugins").hint("[list|enable|disable]"),
    turn("marketplace", "Manage plugins from marketplaces").hint("<subcommand>"),
    turn("reload-plugins", "Reload all plugins"),
    turn("export", "Export session to HTML file").hint("[--themes] [path]"),
    turn(
        "dump",
        "Return full transcript as plain text, with LLM request JSON path",
    ),
    turn(
        "share",
        "Share session via an encrypted link (share server or secret gist)",
    ),
    turn("changelog", "Show changelog").hint("[full]"),
    turn(
        "security",
        "Plan, run, inspect, import, and compare OMP-native security scans",
    )
    .hint("<plan|scan|status|cancel|scans|show|import|export|validate|compare|disposition>"),
    turn("ssh", "Manage SSH connections").hint("<subcommand>"),
    turn("rename", "Rename the current session").hint("<title>"),
    turn(
        "pin",
        "Pin or unpin a session at the top of the resume list",
    )
    .hint("[session id]"),
    turn("retry", "Retry the last failed agent turn"),
    turn(
        "fresh",
        "Reset provider stream state without changing the local transcript",
    ),
    turn(
        "shake",
        "Shake heavy content out of the conversation context",
    )
    .hint("[elide|images|thinking]"),
    turn(
        "handoff",
        "Summarize the session into a handoff document and compact in place",
    )
    .hint("[focus instructions]"),
    turn("force", "Force next turn to use a specific tool").hint("<tool-name> [prompt]"),
    turn("extended-context", "Toggle extended context").hint("[on|off|status]"),
    turn("computer", "Toggle computer use").hint("[on|off|status]"),
    turn("vision", "Toggle vision delegation").hint("[on|off|auto|status]"),
    turn("prewalk", "Prewalk at the next action"),
    turn("advisor", "Toggle advisor").hint("[on|off|status|dump [raw]|configure]"),
    turn("browser", "Toggle browser headless vs visible mode").hint("[headless|visible]"),
    misty("branch", "Create a new branch from a previous message").hint("[list | <number>]"),
    misty("fork", "Create a new fork from a previous message").hint("[list | <number>]"),
    misty("tree", "Show the messages this session can branch from"),
    misty(
        "btw",
        "Ask an ephemeral side question using the current session context",
    )
    .hint("<question>"),
    misty("tan", "Run a full background agent on tangential work").hint("<work>"),
    misty(
        "omfg",
        "Forge a TTSR rule from a complaint to stop a recurring behavior",
    )
    .hint("[--global] <complaint>"),
    misty(
        "cleanse",
        "Detect and fix project diagnostics with weighted parallel subagents",
    )
    .hint("[request] [--all] [--tests] [-n <agents>] [-m <model>]"),
    // goal, guided-goal and loop are run by Misty's own goal runner, which re-sends the turns
    // omp's terminal app would (`mistyCommands.ts`), so they have no row here.
    misty(
        "vibe",
        "Toggle vibe mode (direct persistent fast/good worker sessions; read-only toolset)",
    )
    .hint("[prompt]"),
];

pub fn commands(engine: &str) -> &'static [Command] {
    match engine {
        "pi" => PI,
        "omp" => OMP,
        _ => &[],
    }
}

pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    // Arguments are checked before a process is started for nothing.
    let args = context.args.as_str();
    match name {
        "name" | "rename" if args.is_empty() => {
            return Err(format!("Give the session a name: /{name} <name>"));
        }
        "export" if args.ends_with(".jsonl") => {
            return Err("pi's rpc mode exports HTML only.".into());
        }
        _ => {}
    }
    if context.engine == "omp" {
        if let Some(output) = omp_tui_only(name) {
            return Ok(output);
        }
        if let Some(usage) = omp_usage(name, args) {
            return Err(usage);
        }
        if name == "cleanse" {
            let folder = context
                .folder
                .as_deref()
                .ok_or("Link this chat to a folder first.")?;
            return cleanse(folder, args).await;
        }
    }
    let (Some(folder), Some(session)) = (context.folder.as_deref(), context.session.as_deref())
    else {
        return Err("This chat has no session yet. Send a message first.".into());
    };
    match (context.engine.as_str(), name) {
        ("omp", "btw") => return btw(folder, session, args).await,
        ("omp", "tan") => return tan(folder, session, args).await,
        ("omp", "omfg") => return omfg(folder, session, args).await,
        _ => {}
    }
    let mut rpc = RpcSession::open(&context.engine, folder, session).await?;
    let result = match (context.engine.as_str(), name) {
        ("pi", "session") => session_info(&mut rpc).await,
        ("pi", "name" | "rename") => rename(&mut rpc, args).await,
        ("pi", "fork") => fork(&mut rpc, Flavor::PI, args).await,
        ("pi", "clone") => clone(&mut rpc).await,
        ("pi", "tree") => tree(&mut rpc).await,
        ("pi", "export") => export(&mut rpc, folder, args).await,
        ("omp", "branch" | "fork") => fork(&mut rpc, Flavor::OMP, args).await,
        ("omp", "tree") => fork(&mut rpc, Flavor::OMP, "list").await,
        _ => Err(format!("Misty doesn't run /{name} for this engine.")),
    };
    rpc.close().await;
    result
}

#[cfg(test)]
mod tests;

/// The ported commands run against the installed pi and Oh My Pi, on a scratch agent folder
/// (`PI_CODING_AGENT_DIR`) whose only model is a provider on a closed localhost port: the one
/// prompt that makes the session fails to connect, so nothing reaches a model and nothing is
/// spent. Run with `--ignored --test-threads=1 --nocapture`.
#[cfg(test)]
#[path = "live_tests.rs"]
mod live;
