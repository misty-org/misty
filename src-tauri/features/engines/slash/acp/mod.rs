//! The Kimi, Grok, MiniMax and Hermes commands Misty lists and runs (see `slash/mod.rs`).
//!
//! All four run over ACP, one process per turn (`grok_acp.rs`, `minimax_acp.rs`), and each sends
//! the commands its ACP server runs in `available_commands_update` (`reported.rs`). The
//! `Runs::Turn` rows here are the ones each server runs from a prompt, with its own descriptions,
//! so the menu has them before the engine's first run. The `Runs::Misty` rows are ACP calls Misty
//! makes out of turn on a short-lived process opened on the chat's session (`OutOfTurn`).
//!
//! What each engine is:
//! - Kimi is Kimi Code (`@moonshot-ai/kimi-code`, `~/.kimi-code`), not the archived kimi-cli. Its
//!   ACP server runs `compact`, `status`, `usage`, `mcp`, `tasks`, `help` and its skills; its
//!   TUI's `init`, `export`, `import`, `title` and `yolo` answer "Unknown ACP command" over ACP.
//! - Grok is xai-org/grok-build. Its ACP prompt runs its own built-ins; `/plan`, `/auto`,
//!   `/fork`, `/rename` and `/model` are the terminal app's and reach the model as plain text, so
//!   fork and rename are its `_x.ai/session/*` calls here.
//! - MiniMax Code's ACP prompt runs ten commands itself; every other `/word` (`goal`, `review`,
//!   `init`, …) reaches the model as plain text.
//! - Hermes Agent runs `hermes acp` on its gateway: its adapter answers a few commands and sends
//!   the rest to the gateway's `slash.exec`, which refuses `save`, `bg`, `btw`, `agents`,
//!   `rollback`, `stop`, `reload-mcp`, `reload-skills`, `update`, `resume` and `sessions` and
//!   refuses `/branch` in favor of ACP `session/fork`. Misty runs the refused ones it can reach:
//!   `btw` in a fork it deletes after, `bg` as a fork opened as a new chat, `save` through
//!   `hermes sessions export`, `rollback`'s list from Hermes's checkpoint store, `agents` from
//!   its `processes.json`; `reload-mcp` and `reload-skills` say why they can't run here. `stop`,
//!   `resume`, `sessions` and `update` are the composer's and Settings'.
//!
//! Left out on purpose: Hermes's `/yolo` and Grok's `/always-approve`, which turn off the
//! engine's own asks with no sandbox holding it in its folder (`modes.rs`); the commands the
//! composer answers for every engine (`help`, `model`, `new`, `diff`, `voice`, `approvals`, …);
//! Grok's `usage` (its totals reset in each new process, and every turn is one); and renames for
//! Kimi, MiniMax and Hermes, which have no ACP call for it (Hermes's `/title` is a turn).

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use serde_json::{json, Value};

use super::{misty, row, turn, Command, Context, Output, Section};
use crate::engines::qoder_session::{
    answer_agent_request, initialize_params, jsonrpc_error_response, jsonrpc_result_response,
    spawn_piped_acp, teardown, AcpLine, SpawnedAcp, JSONRPC_METHOD_NOT_FOUND,
    RPC_HANDSHAKE_TIMEOUT, SESSION_NEW_TIMEOUT, SESSION_RESUME_TIMEOUT,
};
use crate::engines::{BuiltCommand, SendRequest};

mod grok;
mod hermes;
mod out_of_turn;
use grok::{grok_fork, grok_rename, grok_status};
use hermes::{
    hermes_agents, hermes_btw, hermes_reload, hermes_rollback, hermes_save, hermes_save_usage,
};
use out_of_turn::OutOfTurn;

/// Kimi Code's ACP built-ins (`acp-server/src/builtin-commands.ts`). Its skills come in its own
/// report, as `skill:<name>` (or a built-in skill's bare name).
const KIMI: &[Command] = &[
    turn("compact", "Compact the conversation context")
        .hint("<optional custom summarization instructions>"),
    turn("status", "Show current session status"),
    turn("mcp", "Show MCP server status"),
    turn("tasks", "List background tasks"),
    misty("fork", "Fork this session into a new chat").hint("[title]"),
];

/// Grok's built-ins that every session has (`session/slash_commands.rs`, `BuiltinGate::AlwaysOn`).
/// The ones behind a feature (memory, hooks, plugins, goal, workflows, `/loop`, `/feedback`)
/// come in its own report when that feature is on.
const GROK: &[Command] = &[
    turn(
        "compact",
        "Compress conversation history to save context window",
    ),
    turn("context", "Show context window usage and session stats"),
    turn(
        "session-info",
        "Show session details (model, turns, context usage)",
    ),
    misty(
        "status",
        "Show session details (model, turns, context usage)",
    ),
    misty("fork", "Branch the current session into a new chat").hint("[title]"),
    misty("rename", "Rename the current session").hint("<title>"),
];

/// The commands MiniMax Code's ACP prompt runs itself (its `ur` table), but `help`, `new` (which
/// only says to start a new thread) and `model` (the composer's picker).
const MINIMAX: &[Command] = &[
    turn("status", "Show account and model status"),
    turn("doctor", "Check the local config file"),
    turn("context", "Show the Runtime-owned context snapshot"),
    turn("skills", "List built-in and user Skills").hint("[filter]"),
    turn("mcp", "Inspect MCP capabilities and project configuration").hint("[filter]"),
    turn("usage", "Show session usage"),
    turn("compact", "Shorten the active conversation").hint("[instructions]"),
    misty("fork", "Fork this session into a new chat").hint("[title]"),
];

/// The Hermes commands its ACP adapter or gateway runs (`hermes_cli/commands.py`,
/// `gateway/session_commands.py`), with its own descriptions. Hints are trimmed to what the
/// gateway accepts over ACP (`/usage reset` and `/voice tts` are refused there).
const HERMES: &[Command] = &[
    turn("status", "Show session, model, token, and context info"),
    turn(
        "context",
        "Show detailed context window view with usage gauge, category breakdown, compression stats, and throughput",
    )
    .hint("[all]"),
    turn("usage", "Show token usage and rate limits"),
    turn(
        "compress",
        "Compress conversation context (add 'here [N]' to keep recent N turns; --preview shows what would happen)",
    )
    .hint("[here [N] | focus topic | --preview|--dry-run]"),
    turn("title", "Set a title for the current session").hint("[name]"),
    turn("undo", "Back up N user turns and re-prompt (default 1)").hint("[N]"),
    turn("retry", "Retry the last message (resend to agent)"),
    turn("tools", "List available tools"),
    turn("version", "Show Hermes Agent version"),
    turn(
        "goal",
        "Set a standing goal Hermes works on across turns until achieved",
    )
    .hint("[text | -- <text> | draft <text> | show | gate add <cmd> | pause | resume | clear | status | wait <pid> | unwait]"),
    turn("subgoal", "Add or manage extra criteria on the active goal")
        .hint("[text | remove N | clear]"),
    turn(
        "heartbeat",
        "Set a recurring prompt that re-enters this session when idle",
    )
    .hint("[every <interval> <prompt> | status | pause | resume | clear]"),
    turn("loop", "Re-run a prompt on a recurring interval in this session")
        .hint("[interval] <prompt> [--times N] [--until <condition>] | status | pause | resume | stop"),
    turn(
        "review",
        "Spawn an independent subagent to review the work just discussed (PR, code, docs)",
    )
    .hint("[review instructions]"),
    turn(
        "refine",
        "Review this conversation now and save lessons to memory/skills",
    )
    .hint("[focus instructions]"),
    turn(
        "plan",
        "Write a markdown implementation plan to .hermes/plans/ without executing anything",
    )
    .hint("[task]"),
    turn(
        "moa",
        "Run one prompt through the default Mixture of Agents preset, then restore your model",
    )
    .hint("<prompt>"),
    turn(
        "init",
        "Generate or update AGENTS.md project instructions from a repo scan",
    )
    .hint("[notes]"),
    turn(
        "learn",
        "Learn a reusable skill from anything you describe (dirs, URLs, this chat, notes)",
    )
    .hint("<what to learn from>"),
    turn("insights", "Show usage insights and analytics").hint("[days]"),
    turn(
        "memory",
        "Review pending memory writes / toggle the approval gate",
    )
    .hint("[pending|approve|reject|approval] [id|on|off]"),
    turn("reasoning", "Manage reasoning effort and display")
        .hint("[level|show|hide|full|clamp] [--global]"),
    turn(
        "fast",
        "Fast mode — OpenAI Priority Processing / Anthropic Fast Mode (normal/fast/auto/cold/ultrafast)",
    )
    .hint("[normal|fast|auto|cold|ultrafast|status] [--global]"),
    turn("busy", "Control how messages behave while Hermes is working")
        .hint("[queue|steer|interrupt|status]"),
    turn("personality", "Set a predefined personality").hint("[name]"),
    turn(
        "footer",
        "Toggle gateway runtime-metadata footer on final replies",
    )
    .hint("[on|off|status]"),
    turn(
        "autoprune",
        "Turn automatic pruning of old sessions on or off",
    )
    .hint("[on|off|later|status]"),
    turn(
        "kanban",
        "Multi-profile collaboration board (tasks, links, comments)",
    )
    .hint("[subcommand]"),
    turn(
        "curator",
        "Background skill maintenance (status, run, pin, archive, list-archived)",
    )
    .hint("[subcommand]"),
    turn("blueprint", "Set up an automation from a blueprint template")
        .hint("[name] [slot=value ...]"),
    turn("suggestions", "Review suggested automations (accept/dismiss)"),
    turn(
        "bundles",
        "List skill bundles (aliases /<name> for multiple skills)",
    ),
    turn("whoami", "Show your slash command access (admin / user)"),
    turn("profile", "Show active profile name and home directory"),
    turn(
        "topup",
        "Show your Nous balance and manage billing on the portal",
    ),
    turn(
        "debug",
        "Debug report (versions, config keys, error counts; no log text): shows the privacy notice; /debug upload shares links",
    )
    .hint("[upload|nous upload|local]"),
    turn(
        "codex-runtime",
        "Toggle codex app-server runtime for OpenAI/Codex models",
    )
    .hint("[auto|codex_app_server]"),
    turn("egress", "Show Docker egress proxy status").hint("[status]"),
    misty("fork", "Fork this session into a new chat").hint("[title]"),
    misty(
        "btw",
        "Ask a side question about the current conversation without interrupting it",
    )
    .hint("<question>"),
    misty("bg", "Run a prompt in a separate background session").hint("<prompt>"),
    misty(
        "save",
        "Export the current conversation (bare /save shows usage)",
    )
    .hint("<json|md|html> [filename] [redact]"),
    misty(
        "rollback",
        "List or restore filesystem checkpoints (restores keep your hand-edits; --all overrides)",
    )
    .hint("[number] [--all]"),
    misty("agents", "Show active agents and running tasks"),
    misty("reload-mcp", "Reload MCP servers from config"),
    misty(
        "reload-skills",
        "Re-scan ~/.hermes/skills/ for newly installed or removed skills",
    ),
];

/// Commands an engine reports that the menu leaves out (see the module's note): Grok's
/// `/always-approve`, which its ACP prompt runs and which turns off every ask with no sandbox
/// holding Grok in its folder, and Hermes's `/yolo`.
pub fn withheld(engine: &str) -> &'static [&'static str] {
    match engine {
        "grok" => &["always-approve"],
        "hermes" => &["yolo"],
        _ => &[],
    }
}

pub fn commands(engine: &str) -> &'static [Command] {
    match engine {
        "kimi" => KIMI,
        "grok" => GROK,
        "minimax" => MINIMAX,
        "hermes" => HERMES,
        _ => &[],
    }
}

pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    if context.engine == "hermes" {
        match name {
            "reload-mcp" | "reload-skills" => return Ok(hermes_reload(name)),
            "agents" => return hermes_agents(),
            "save" if context.args.is_empty() => return Ok(hermes_save_usage()),
            "btw" if context.args.is_empty() => return Err("Usage: /btw <question>".into()),
            "bg" if context.args.is_empty() => return Err("Usage: /bg <prompt>".into()),
            _ => {}
        }
    }
    let folder = context
        .folder
        .clone()
        .ok_or("Link this chat to a folder first.")?;
    let session = context
        .session
        .clone()
        .ok_or("This chat has no session yet. Send a message first.")?;
    match (context.engine.as_str(), name) {
        ("grok", "fork") => grok_fork(&context, &folder, &session).await,
        ("grok", "rename") => grok_rename(&context, &folder, &session).await,
        ("grok", "status") => grok_status(&context, &folder, &session).await,
        ("kimi" | "minimax" | "hermes", "fork") => {
            fork(&context, &folder, &session, fork_title(&context), None).await
        }
        ("hermes", "bg") => {
            let prompt = Some(context.args.clone());
            fork(&context, &folder, &session, None, prompt).await
        }
        ("hermes", "btw") => hermes_btw(&context, &folder, &session).await,
        ("hermes", "save") => hermes_save(&context, &folder, &session).await,
        ("hermes", "rollback") => hermes_rollback(&context, &folder).await,
        _ => Err(format!("Misty doesn't run /{name} for this engine.")),
    }
}

/// The chat's title for a fork, when the command named one.
fn fork_title(context: &Context) -> Option<String> {
    Some(context.args.clone()).filter(|title| !title.is_empty())
}

/// ACP `session/fork`, which Kimi Code, MiniMax Code and Hermes each advertise
/// (`sessionCapabilities.fork`) and answer with the new session's `sessionId`. The session is
/// opened first, so an engine that forks only what it has open (MiniMax inherits the open
/// session's servers) finds it.
///
/// Hermes's `/bg` runs a prompt in a separate session beside this one; here that is a fork,
/// opened as a new chat that sends the prompt, since the new chat shows this one's turns.
async fn fork(
    context: &Context,
    folder: &Path,
    session: &str,
    title: Option<String>,
    prompt: Option<String>,
) -> Result<Output, String> {
    let mut live = OutOfTurn::open(context, folder).await?;
    let params = json!({ "sessionId": session, "cwd": live.cwd(), "mcpServers": [] });
    let result = async {
        if !live.can("fork") {
            return Err("This version of the engine can't fork a session.".to_string());
        }
        live.attach(session).await?;
        live.call("session/fork", params, SESSION_NEW_TIMEOUT).await
    }
    .await;
    live.close().await;
    let forked =
        text(&result.map_err(fork_refusal)?, "sessionId").ok_or("The engine forked no session.")?;
    Ok(Output::Fork {
        session: forked,
        title,
        prompt,
    })
}

/// MiniMax Code forks only at a finished reply, and says so in its own terms
/// (`Invalid params: message-boundary-not-found`, mcode 0.7.7).
fn fork_refusal(error: String) -> String {
    if error.contains("message-boundary-not-found") || error.contains("message-boundary-invalid") {
        "MiniMax Code forks a session only after a reply has finished.".into()
    } else {
        error
    }
}

/// A string field, trimmed, when it has one.
fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// Grok wraps some answers in `{result, error}` (`ExtMethodResult`) and not others.
fn unwrapped(value: &Value) -> &Value {
    value
        .get("result")
        .filter(|result| result.is_object())
        .unwrap_or(value)
}

#[cfg(test)]
mod tests;

/// The Hermes commands Misty runs, against the installed Hermes on a scratch home: set
/// `MISTY_TEST_HERMES_HOME` to a Hermes home whose `config.yaml` names a model on a closed
/// localhost port (`provider: custom`, `base_url: http://127.0.0.1:9/v1`), so a session opens
/// and nothing can reach a model. `/btw` is left out: it is a model turn. Run with
/// `--ignored --test-threads=1 --nocapture`.
#[cfg(test)]
#[path = "live_tests.rs"]
mod live;
